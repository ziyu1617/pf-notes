export interface NoteDraft {
  title: string
  content: string
  category: string
}

export type NoteSaveState = { status: 'empty' | 'pending' | 'saving' | 'saved' | 'error'; error: string }
export type SavedNoteDraft = NoteDraft & { id: string }
export type FlushNoteDraft = (leaving?: boolean) => Promise<boolean>
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type SaveNote = (draft: NoteDraft, id: string | null, draftId: string) => Promise<SavedNoteDraft>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function newDraftId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // Older embedded WebViews may lack randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16)
    return (char === 'x' ? value : (value & 3) | 8).toString(16)
  })
}

/** One serial queue per editor: the first request creates, later requests update. */
export class NoteAutosave {
  private draft: NoteDraft
  private id: string | null = null
  private draftId = newDraftId()
  private saved = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<boolean> | null = null
  private paused = false
  private listeners = new Set<() => void>()
  private state: NoteSaveState = { status: 'empty', error: '' }

  constructor(
    initial: NoteDraft,
    private save: SaveNote,
    private recovery?: { storage: RecoveryStorage; key: string },
    private delay = 500,
  ) {
    this.draft = { ...initial }
    this.state = { status: this.needsSave() ? 'pending' : 'empty', error: '' }
  }

  /** Read after mount so server and first client render use the same fields. */
  restoreRecovery() {
    try {
      const record = JSON.parse(this.recovery?.storage.getItem(this.recovery.key) || 'null')
      if (record && typeof record.title === 'string' && typeof record.content === 'string' &&
        typeof record.category === 'string' && (record.id === null ||
          (typeof record.id === 'string' && /^\d+$/.test(record.id)))) {
        this.draft = { title: record.title, content: record.content, category: record.category }
        this.id = record.id
        this.saved = typeof record.saved === 'string' ? record.saved : ''
        if (typeof record.draftId === 'string' && uuidPattern.test(record.draftId)) this.draftId = record.draftId
      }
    } catch { /* Autosave works even when recovery storage is unavailable. */ }
    this.publish(this.needsSave() ? 'pending' : this.id ? 'saved' : 'empty')
    return this.draft
  }

  getDraft = () => this.draft
  getNoteId = () => this.id
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private payload(): NoteDraft {
    return { title: this.draft.title.trim() || '未命名笔记', content: this.draft.content,
      category: this.draft.category.trim() || '未分类' }
  }

  private needsSave() {
    if (!this.id && !this.draft.title.trim() && !this.draft.content.trim()) return false
    return JSON.stringify(this.payload()) !== this.saved
  }

  private publish(status: NoteSaveState['status'], error = '') {
    this.state = { status, error }
    this.listeners.forEach(listener => listener())
  }

  private persist() {
    try {
      if (this.id || this.draft.title.trim() || this.draft.content.trim()) {
        this.recovery?.storage.setItem(this.recovery.key, JSON.stringify({ ...this.draft, id: this.id, draftId: this.draftId, saved: this.saved }))
      } else this.forgetRecovery()
    } catch { /* A full storage must not block saving to the local API. */ }
  }

  forgetRecovery() {
    try { this.recovery?.storage.removeItem(this.recovery.key) } catch { /* Best effort. */ }
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule() {
    this.clearTimer()
    if (!this.paused && this.needsSave()) this.timer = setTimeout(() => { void this.flush() }, this.delay)
  }

  update(draft: NoteDraft) {
    if (JSON.stringify(this.draft) === JSON.stringify(draft)) return
    this.draft = { ...draft }
    this.persist()
    this.publish(this.needsSave() ? this.saving ? 'saving' : 'pending' : this.id ? 'saved' : 'empty')
    this.schedule()
  }

  setPaused(paused: boolean) {
    this.paused = paused
    if (paused) this.clearTimer()
    else this.schedule()
  }

  flush = (): Promise<boolean> => {
    this.clearTimer()
    if (this.saving) return this.saving
    if (this.paused) return Promise.resolve(!this.needsSave())
    this.saving = this.drain().finally(() => { this.saving = null })
    return this.saving
  }

  private async drain(): Promise<boolean> {
    while (this.needsSave()) {
      if (this.paused) {
        this.publish('pending')
        return false
      }
      const payload = this.payload()
      this.publish('saving')
      try {
        const note = await this.save(payload, this.id, this.draftId)
        this.id = note.id
        // A retry of an interrupted create can return the original snapshot.
        // Compare its actual fields so newer typing is still updated next.
        this.saved = JSON.stringify({ title: note.title, content: note.content, category: note.category })
        this.persist()
      } catch (error) {
        this.publish('error', error instanceof Error ? error.message : '笔记保存失败，请重试。')
        return false
      }
    }
    this.publish(this.id ? 'saved' : 'empty')
    return true
  }
}
