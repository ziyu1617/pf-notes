'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pin, Plus, StickyNote as StickyIcon } from 'lucide-react'
import { refreshStickyDraft, StickyRequestError, stickyRequest, type StickyNote } from '@/lib/sticky-notes'
import { clampStickySize, saveStickySize, useStickySize } from '@/lib/sticky-layout'
import { StickyNoteCard } from './sticky-note'

function StickySlot({ note, pinned, autoFocus, detach }: {
  note: StickyNote
  pinned: boolean
  autoFocus: boolean
  detach: (id: string, dragging: boolean, point?: { x: number; y: number }) => Promise<void>
}) {
  const slot = useRef<HTMLDivElement>(null)
  const [size, setSize] = useStickySize(note.id)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = slot.current
    if (!element) return
    let frame = 0
    let previous = ''
    let stopped = false
    const report = () => {
      frame = 0
      if (stopped) return
      const bridge = window.pywebview?.api
      if (!bridge?.set_sticky_dock) return
      const rect = element.getBoundingClientRect()
      let left = Math.max(0, rect.left)
      let top = Math.max(0, rect.top)
      let right = Math.min(window.innerWidth, rect.right)
      let bottom = Math.min(window.innerHeight, rect.bottom)
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor)
        if (style.display === 'none' || style.visibility === 'hidden') { right = left; break }
        const bounds = ancestor.getBoundingClientRect()
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
      }
      // A clipped or off-screen home must not capture a desktop note behind the sidebar edge.
      const fullyVisible = right - left >= rect.width - 1 && bottom - top >= rect.height - 1
      const bounds = !document.hidden && element.getClientRects().length && rect.width >= 40 && rect.height >= 40 && fullyVisible
        ? { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
        : null
      const encoded = JSON.stringify(bounds)
      if (encoded === previous) return
      previous = encoded
      void bridge.set_sticky_dock(note.id, bounds).catch(() => { previous = '' })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(report) }
    const bridgeReady = () => { previous = ''; schedule() }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    if (element.parentElement) observer.observe(element.parentElement)
    const intersection = new IntersectionObserver(schedule)
    intersection.observe(element)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('pywebviewready', bridgeReady)
    window.addEventListener('sticky-windows-changed', schedule)
    document.addEventListener('visibilitychange', schedule)
    schedule()
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      intersection.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('pywebviewready', bridgeReady)
      window.removeEventListener('sticky-windows-changed', schedule)
      document.removeEventListener('visibilitychange', schedule)
      void window.pywebview?.api?.set_sticky_dock?.(note.id, null).catch(() => {})
    }
  }, [note.id])

  const pin = async (dragging: boolean, point?: { x: number; y: number }) => {
    const bridge = window.pywebview?.api
    if (bridge?.set_sticky_size && !pinned) {
      const next = clampStickySize(slot.current?.getBoundingClientRect().width || size)
      const result = await bridge.set_sticky_size(note.id, next)
      if (!result.ok) throw new Error(result.error || '暂时无法展开便签。')
      saveStickySize(note.id, next)
    }
    await detach(note.id, dragging, point)
  }

  return <div ref={slot} data-sticky-dock-id={note.id} className="sticky-dock-slot" style={{ width: size }}>
    {pinned ? <button type="button" className="sticky-note-home" aria-label={`${note.date} 便签已置顶，点击查看或将便签拖回此处`} title="拖回这里收起便签 · 点击查看" onClick={() => { void pin(false).catch(error => setError(error.message)) }}><Pin size={23} strokeWidth={1.5} aria-hidden="true" /></button>
      : <StickyNoteCard note={note} size={size} onResize={setSize} autoFocus={autoFocus} onPin={pin} />}
    {error && <div className="sticky-dock-error" role="alert">{error}</div>}
  </div>
}

export function StickyDock({ date }: { date: string }) {
  const [notes, setNotes] = useState<StickyNote[]>([])
  const [pinned, setPinned] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [newId, setNewId] = useState<string>()
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const request = useRef(0)
  const creatingRequest = useRef(false)

  const reload = useCallback(async () => {
    const token = ++request.current
    try {
      const data = await stickyRequest<StickyNote[]>(`/api/sticky-notes?date=${date}`)
      const bridge = window.pywebview?.api
      const detached = bridge?.get_sticky_windows ? await bridge.get_sticky_windows() : []
      if (mounted.current && token === request.current) {
        data.forEach(refreshStickyDraft)
        setNotes(data)
        setPinned(detached.map(String))
        setLoaded(true)
        setError('')
      }
    } catch (error) { if (mounted.current && token === request.current) setError((error as Error).message) }
  }, [date])

  useEffect(() => {
    mounted.current = true
    void reload()
    const refresh = () => { void reload() }
    const visibility = () => { if (!document.hidden) refresh() }
    window.addEventListener('pywebviewready', refresh)
    window.addEventListener('sticky-windows-changed', refresh)
    window.addEventListener('sticky-notes-changed', refresh)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      mounted.current = false
      ++request.current
      window.removeEventListener('pywebviewready', refresh)
      window.removeEventListener('sticky-windows-changed', refresh)
      window.removeEventListener('sticky-notes-changed', refresh)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [reload])

  const addNote = async () => {
    if (creatingRequest.current || !loaded || notes.length > 0) return
    creatingRequest.current = true
    setCreating(true)
    setError('')
    try {
      const note = await stickyRequest<StickyNote>('/api/sticky-notes', 'POST', { date })
      if (mounted.current) {
        ++request.current
        setNotes(previous => [...previous.filter(existing => existing.id !== note.id), note])
        setNewId(note.id)
        void reload()
      }
    } catch (error) {
      if (mounted.current) {
        if (error instanceof StickyRequestError && error.status === 409) await reload()
        else setError((error as Error).message)
      }
    } finally { creatingRequest.current = false; if (mounted.current) setCreating(false) }
  }

  const detach = async (id: string, dragging: boolean, point?: { x: number; y: number }) => {
    const bridge = window.pywebview?.api
    if (!bridge) throw new Error('桌面置顶需要在 Smart Notes 桌面版中使用。')
    const result = await (dragging ? bridge.drag_sticky(id, point?.x, point?.y) : bridge.detach_sticky(id))
    if (!result.ok) throw new Error(result.error || '暂时无法打开桌面便签，请重试。')
    if (mounted.current) {
      setPinned(previous => [...new Set([...previous, id])])
      void reload()
    }
  }

  return <section className="sticky-dock" aria-label="当日便签">
    {notes.length > 0 && <div className="sticky-dock-notes">
      {notes.map(note => <StickySlot key={note.id} note={note} pinned={pinned.includes(note.id)} autoFocus={newId === note.id} detach={detach} />)}
    </div>}
    {error && <div className="sticky-dock-error" role="alert">{error}<button onClick={() => { void reload() }}>重试</button></div>}
    {loaded && notes.length === 0 && <button type="button" className="sticky-add-button" aria-label="新增便签" title="新增便签" disabled={creating} onClick={() => { void addNote() }}>
      <StickyIcon size={24} strokeWidth={1.5} aria-hidden="true" />
      <Plus className="sticky-add-plus" size={12} strokeWidth={2.5} aria-hidden="true" />
    </button>}
  </section>
}
