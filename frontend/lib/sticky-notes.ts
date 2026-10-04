import { useCallback, useEffect, useSyncExternalStore } from 'react'

export const STICKY_COLORS = ['blue', 'green', 'yellow', 'pink'] as const
export type StickyColor = typeof STICKY_COLORS[number]
const isStickyColor = (value: unknown): value is StickyColor => STICKY_COLORS.includes(value as StickyColor)

export interface StickyNote {
  id: string
  date: string
  content: string
  color: StickyColor
  revision: number
  createdAt: string
  updatedAt: string
}

interface BridgeResult { ok: boolean; error?: string }
export interface StickyBridge {
  detach_sticky: (id: string) => Promise<BridgeResult>
  drag_sticky: (id: string, screen_x?: number, screen_y?: number) => Promise<BridgeResult>
  return_sticky: (id: string) => Promise<BridgeResult>
  get_sticky_windows: () => Promise<string[]>
  set_sticky_size: (id: string, size: number) => Promise<BridgeResult & { size?: number }>
  resize_sticky: (id: string, corner: 'top-left' | 'bottom-left', screen_x?: number, screen_y?: number) => Promise<BridgeResult>
  set_sticky_dock: (id: string, bounds: { x: number; y: number; width: number; height: number } | null) => Promise<BridgeResult>
}

declare global {
  interface Window {
    pywebview?: { api: StickyBridge }
    smartNotesFlushSticky?: () => Promise<boolean>
  }
}

export class StickyRequestError extends Error {
  constructor(message: string, public status = 0) { super(message) }
}

export async function stickyRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(path, {
      method, cache: 'no-store', signal: controller.signal,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new StickyRequestError(typeof data?.detail === 'string' ? data.detail : '便签暂时无法保存，请重试。', response.status)
    return data as T
  } catch (error) {
    if (error instanceof StickyRequestError) throw error
    throw new StickyRequestError('无法连接便签服务，内容仍保留在当前便签中。')
  } finally { clearTimeout(timeout) }
}

type DraftState = { note: StickyNote; text: string; color: StickyColor; status: 'saved' | 'pending' | 'saving' | 'error' | 'conflict'; error: string; loadingLatest: boolean; draftExported: boolean; deleting: boolean; deleted: boolean }
type DraftSnapshot = { key: string; raw: string; text: string; color: StickyColor; revision: number; conflict: boolean; updatedAt: number }
type DraftEntry = {
  state: DraftState
  // Recovery must retain its original base revision, even when a newer server
  // note was fetched. Rebasing a conflict would silently authorize an overwrite.
  baseRevision: number
  ownSnapshot?: DraftSnapshot
  recoveredSnapshot?: DraftSnapshot
  listeners: Set<() => void>
  timer?: ReturnType<typeof setTimeout>
  saving?: Promise<boolean>
  loadingLatest?: Promise<void>
}
const isDirty = (entry: DraftEntry) => entry.state.text !== entry.state.note.content || entry.state.color !== entry.state.note.color
// The queue lives beyond a calendar render so switching tabs/dates cannot cancel a save.
const drafts = new Map<string, DraftEntry>()
const deletions = new Map<string, Promise<void>>()
const deletedIds = new Set<string>()
const draftPrefix = (id: string) => `smart-notes:sticky-draft:${id}`
const deletedKey = (id: string) => `smart-notes:sticky-deleted:${id}`
let draftOwner: string | undefined

function isDeleted(id: string) {
  if (deletedIds.has(id)) return true
  try { return localStorage.getItem(deletedKey(id)) === 'true' } catch { return false }
}

function finishDeletion(id: string) {
  const alreadyKnown = deletedIds.has(id)
  deletedIds.add(id)
  try {
    // Keep a small tombstone so other live windows cannot recreate a recovery
    // draft after this window has cleared it. Server IDs are never recycled.
    localStorage.setItem(deletedKey(id), 'true')
  } catch { /* Memory and the server still prevent this window from restoring it. */ }
  try {
    const prefix = draftPrefix(id)
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key && (key === prefix || key.startsWith(`${prefix}:`))) keys.push(key)
    }
    keys.forEach(key => localStorage.removeItem(key))
  } catch { /* The server deletion remains authoritative if storage is unavailable. */ }
  const entry = drafts.get(id)
  if (entry) {
    clearTimeout(entry.timer)
    entry.ownSnapshot = undefined
    entry.recoveredSnapshot = undefined
    if (!entry.state.deleted) publish(entry, { deleted: true, deleting: false, status: 'saved', error: '' })
  }
  if (!alreadyKnown) window.dispatchEvent(new Event('sticky-notes-changed'))
}

function getDraftOwner() {
  if (draftOwner) return draftOwner
  const ownerKey = 'smart-notes:sticky-draft-owner'
  try {
    const stored = sessionStorage.getItem(ownerKey)
    if (stored && /^[a-zA-Z0-9-]{8,100}$/.test(stored)) draftOwner = stored
  } catch { /* A memory-only owner still isolates this window when storage is blocked. */ }
  if (!draftOwner) {
    draftOwner = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    try { sessionStorage.setItem(ownerKey, draftOwner) } catch { /* Storage may be disabled. */ }
  }
  return draftOwner
}

const draftKey = (id: string) => `${draftPrefix(id)}:${getDraftOwner()}`

function readSnapshot(key: string, note: StickyNote): DraftSnapshot | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return
    const value = JSON.parse(raw)
    if (!value || typeof value.text !== 'string' || [...value.text].length > 20000 ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      (value.date !== undefined && value.date !== note.date) ||
      (value.createdAt !== undefined && value.createdAt !== note.createdAt) ||
      (value.color !== undefined && !isStickyColor(value.color))) return
    return {
      key, raw, text: value.text, color: value.color ?? note.color, revision: value.revision, conflict: value.conflict === true,
      updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    }
  } catch { /* Ignore damaged or inaccessible recovery data. */ }
}

function removeSnapshot(snapshot?: DraftSnapshot) {
  if (!snapshot) return
  try {
    // Another window may have edited its recovery record since we read it.
    if (localStorage.getItem(snapshot.key) === snapshot.raw) localStorage.removeItem(snapshot.key)
  } catch { /* A saved note remains persisted even if an old recovery record cannot be removed. */ }
}

function clearSavedDraft(entry: DraftEntry) {
  removeSnapshot(entry.ownSnapshot)
  removeSnapshot(entry.recoveredSnapshot)
  entry.ownSnapshot = undefined
  entry.recoveredSnapshot = undefined
}

function publish(entry: DraftEntry, patch: Partial<DraftState>) {
  entry.state = { ...entry.state, ...patch }
  entry.listeners.forEach(listener => listener())
}

function keepDraft(entry: DraftEntry) {
  if (isDeleted(entry.state.note.id)) return
  try {
    const key = draftKey(entry.state.note.id)
    const value = {
      text: entry.state.text, color: entry.state.color, revision: entry.baseRevision, conflict: entry.state.status === 'conflict',
      date: entry.state.note.date, createdAt: entry.state.note.createdAt, updatedAt: Date.now(),
    }
    const raw = JSON.stringify(value)
    localStorage.setItem(key, raw)
    entry.ownSnapshot = { key, raw, ...value }
    // Do not remove an unchanged-looking draft here: an earlier PUT may still
    // be saving a different text while the user has just undone that edit.
  } catch { /* API autosave remains available if local storage is full or disabled. */ }
}

function getDraft(note: StickyNote): DraftEntry {
  note = { ...note, color: isStickyColor(note.color) ? note.color : 'yellow' }
  const existing = drafts.get(note.id)
  if (existing) return existing
  const ownKey = draftKey(note.id)
  const ownSnapshot = readSnapshot(ownKey, note)
  let recovered = ownSnapshot && (ownSnapshot.text !== note.content || ownSnapshot.color !== note.color) ? ownSnapshot : undefined
  try {
    if (!recovered) {
      const prefix = draftPrefix(note.id)
      const otherSnapshots: DraftSnapshot[] = []
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)
        // Include the old unscoped key so existing drafts survive this upgrade.
        if (key && key !== ownKey && (key === prefix || key.startsWith(`${prefix}:`))) {
          const snapshot = readSnapshot(key, note)
          if (snapshot && (snapshot.text !== note.content || snapshot.color !== note.color)) otherSnapshots.push(snapshot)
        }
      }
      recovered = otherSnapshots.sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))[0]
    }
  } catch { /* No recoverable local draft. */ }
  const text = recovered?.text ?? note.content
  const color = recovered?.color ?? note.color
  // Foreign/legacy recovery is deliberately never autosaved over the server.
  // It may still belong to another active window, or be an older leftover.
  const conflict = !!recovered && (recovered.key !== ownKey || recovered.conflict || recovered.revision !== note.revision)
  const entry: DraftEntry = { state: {
    note, text, color, loadingLatest: false, draftExported: false, deleting: false, deleted: isDeleted(note.id),
    status: conflict ? 'conflict' : text === note.content && color === note.color ? 'saved' : 'pending',
    error: conflict ? '已恢复未保存内容，可先导出草稿，再读取最新版本。' : '',
  }, baseRevision: recovered?.revision ?? note.revision, ownSnapshot, recoveredSnapshot: recovered, listeners: new Set() }
  drafts.set(note.id, entry)
  return entry
}

export function refreshStickyDraft(note: StickyNote) {
  note = { ...note, color: isStickyColor(note.color) ? note.color : 'yellow' }
  const entry = drafts.get(note.id)
  if (!entry || entry.saving || entry.loadingLatest || entry.state.deleting || isDeleted(note.id) || entry.state.status !== 'saved') return
  if (note.revision >= entry.state.note.revision) {
    entry.baseRevision = note.revision
    publish(entry, { note, text: note.content, color: note.color, draftExported: false })
  }
}

export async function saveStickyDraft(id: string): Promise<boolean> {
  return flushStickyDraft(id)
}

async function flushStickyDraft(id: string, forDeletion = false): Promise<boolean> {
  if (!forDeletion && deletions.has(id)) {
    try { await deletions.get(id); return true } catch { return false }
  }
  if (isDeleted(id)) { finishDeletion(id); return true }
  const entry = drafts.get(id)
  if (!entry) return true
  if (entry.loadingLatest) {
    try { await entry.loadingLatest } catch { return false }
  }
  clearTimeout(entry.timer)
  if (entry.saving) return entry.saving
  if (entry.state.status === 'conflict') return false
  entry.saving = (async () => {
    while (isDirty(entry)) {
      if (isDeleted(id)) { finishDeletion(id); return true }
      const text = entry.state.text
      const color = entry.state.color
      const revision = entry.state.note.revision
      publish(entry, { status: 'saving', error: '' })
      try {
        const note = await stickyRequest<StickyNote>(`/api/sticky-notes/${id}`, 'PUT', { content: text, color, revision })
        if (isDeleted(id)) { finishDeletion(id); return true }
        entry.baseRevision = note.revision
        publish(entry, { note, status: entry.state.text === note.content && entry.state.color === note.color ? 'saved' : 'pending' })
        if (isDirty(entry)) keepDraft(entry)
      } catch (error) {
        if ((error instanceof StickyRequestError && error.status === 404) || isDeleted(id)) {
          finishDeletion(id)
          return true
        }
        const conflict = error instanceof StickyRequestError && error.status === 409
        publish(entry, { status: conflict ? 'conflict' : 'error', error: conflict ? '另一窗口已更新此便签。当前草稿已保留，可先导出，再读取最新版本。' : (error as Error).message })
        keepDraft(entry)
        return false
      }
    }
    publish(entry, { status: 'saved', error: '' })
    clearSavedDraft(entry)
    return true
  })().finally(() => { entry.saving = undefined })
  return entry.saving
}

export async function saveAllStickyDrafts(): Promise<boolean> {
  // Recheck every draft: one card may be edited while another request is in flight.
  while (true) {
    const ids = new Set([...drafts.keys(), ...deletions.keys()])
    const results = await Promise.all([...ids].map(saveStickyDraft))
    if (!results.every(Boolean)) return false
    if (!deletions.size && [...drafts.values()].every(entry => entry.state.deleted || (!isDirty(entry) && !entry.saving && !entry.loadingLatest))) return true
  }
}

export function deleteStickyNote(id: string): Promise<void> {
  const inFlight = deletions.get(id)
  if (inFlight) return inFlight
  if (isDeleted(id)) { finishDeletion(id); return Promise.resolve() }
  let entry = drafts.get(id)
  if (entry) publish(entry, { deleting: true, error: '' })
  const deleting = (async () => {
    try {
      if (!entry) {
        entry = getDraft(await stickyRequest<StickyNote>(`/api/sticky-notes/${id}`))
        publish(entry, { deleting: true, error: '' })
      }
      // Freeze input before awaiting either queue. A conflict draft is not
      // written over the server just to delete it; DELETE still checks revision.
      if (entry.loadingLatest) await entry.loadingLatest
      if (entry.saving) await entry.saving
      const saved = entry.state.status === 'conflict' ? true : await flushStickyDraft(id, true)
      if (!saved && entry.state.status !== 'conflict') throw new StickyRequestError(entry.state.error || '请先完成便签保存后再删除。')
      if (isDeleted(id)) { finishDeletion(id); return }
      await stickyRequest(`/api/sticky-notes/${id}`, 'DELETE', { revision: entry.state.note.revision })
      finishDeletion(id)
    } catch (error) {
      if (error instanceof StickyRequestError && error.status === 404) { finishDeletion(id); return }
      let message = (error as Error).message
      const conflict = error instanceof StickyRequestError && error.status === 409
      if (conflict && entry) {
        // Do not automatically retry a destructive action at a newer revision.
        // Preserve the draft and require a second explicit user action.
        try {
          const current = await stickyRequest<StickyNote>(`/api/sticky-notes/${id}`)
          publish(entry, { note: current })
          message = '便签已在其他窗口更新。已读取最新版本，请核对后重试删除；当前草稿仍保留。'
        } catch (refreshError) {
          if (refreshError instanceof StickyRequestError && refreshError.status === 404) { finishDeletion(id); return }
        }
      }
      if (entry) {
        publish(entry, { status: conflict || entry.state.status === 'conflict' ? 'conflict' : 'error', error: message })
        keepDraft(entry)
      }
      throw new StickyRequestError(message, error instanceof StickyRequestError ? error.status : 0)
    } finally {
      deletions.delete(id)
      if (entry && !entry.state.deleted) publish(entry, { deleting: false })
    }
  })()
  deletions.set(id, deleting)
  return deleting
}

export function useStickyDraft(note: StickyNote) {
  const entry = getDraft(note)
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener)
    return () => { entry.listeners.delete(listener) }
  }, [entry])
  const state = useSyncExternalStore(subscribe, () => entry.state, () => entry.state)
  useEffect(() => {
    refreshStickyDraft(note)
    if (entry.state.status === 'pending' || entry.state.status === 'conflict') keepDraft(entry)
    if (entry.state.status === 'pending') void saveStickyDraft(note.id)
    const save = () => { void saveStickyDraft(note.id) }
    const deleted = (event: StorageEvent) => {
      if (event.key === deletedKey(note.id) && event.newValue === 'true') finishDeletion(note.id)
    }
    window.addEventListener('pagehide', save)
    window.addEventListener('storage', deleted)
    return () => { window.removeEventListener('pagehide', save); window.removeEventListener('storage', deleted); save() }
  }, [entry, note.id, note.revision])
  const setText = (text: string) => {
    if (entry.state.loadingLatest || entry.state.deleting || isDeleted(note.id)) return
    const conflict = entry.state.status === 'conflict'
    publish(entry, { text, draftExported: false, status: conflict ? 'conflict' : 'pending', error: conflict ? entry.state.error : '' })
    keepDraft(entry)
    clearTimeout(entry.timer)
    if (!conflict) entry.timer = setTimeout(() => { void saveStickyDraft(note.id) }, 450)
  }
  const setColor = (color: StickyColor) => {
    if (!isStickyColor(color) || entry.state.loadingLatest || entry.state.deleting || isDeleted(note.id) || entry.state.color === color) return
    const conflict = entry.state.status === 'conflict'
    publish(entry, { color, draftExported: false, status: conflict ? 'conflict' : 'pending', error: conflict ? entry.state.error : '' })
    keepDraft(entry)
    clearTimeout(entry.timer)
    if (!conflict) entry.timer = setTimeout(() => { void saveStickyDraft(note.id) }, 450)
  }
  const exportDraft = () => {
    if (entry.state.deleting || isDeleted(note.id)) throw new StickyRequestError('便签正在删除或已删除，无法导出。')
    const url = URL.createObjectURL(new Blob([entry.state.text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    try {
      link.href = url
      link.download = `${entry.state.note.date}-便签草稿.txt`
      document.body.appendChild(link)
      link.click()
      publish(entry, { draftExported: true })
    } finally {
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    // Downloading is not a server save: leave revision, conflict and recovery
    // untouched until the user explicitly requests the latest server version.
  }
  const loadLatest = (options: { discardDraft?: boolean } = {}): Promise<void> => {
    if (entry.state.deleting || isDeleted(note.id)) return Promise.reject(new StickyRequestError('便签正在删除或已删除，无法读取。'))
    if (entry.loadingLatest) return entry.loadingLatest
    if ((isDirty(entry) || entry.state.status === 'conflict') && options.discardDraft !== true) {
      return Promise.reject(new StickyRequestError('读取最新版本会替换当前草稿，请先导出并明确确认放弃当前草稿。'))
    }
    clearTimeout(entry.timer)
    publish(entry, { loadingLatest: true })
    entry.loadingLatest = (async () => {
      if (entry.saving) await entry.saving
      const current = await stickyRequest<StickyNote>(`/api/sticky-notes/${note.id}`)
      entry.baseRevision = current.revision
      publish(entry, { note: current, text: current.content, color: current.color, status: 'saved', error: '', draftExported: false })
      clearSavedDraft(entry)
      window.dispatchEvent(new Event('sticky-notes-changed'))
    })().finally(() => { entry.loadingLatest = undefined; publish(entry, { loadingLatest: false }) })
    return entry.loadingLatest
  }
  return { ...state, setText, setColor, flush: () => saveStickyDraft(note.id), exportDraft, loadLatest, remove: () => deleteStickyNote(note.id) }
}
