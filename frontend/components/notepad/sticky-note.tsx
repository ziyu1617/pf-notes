'use client'

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Check, GripHorizontal, LoaderCircle, StickyNote as StickyIcon, Trash2, X } from 'lucide-react'
import { useStickyDraft, type StickyColor, type StickyNote } from '@/lib/sticky-notes'
import { clampStickySize, resizeStickySize, STICKY_DEFAULT_SIZE, STICKY_MAX_SIZE } from '@/lib/sticky-layout'

const STICKY_COLORS: { value: StickyColor; label: string }[] = [
  { value: 'blue', label: '蓝色' },
  { value: 'green', label: '绿色' },
  { value: 'yellow', label: '黄色' },
  { value: 'pink', label: '粉色' },
]

interface StickyNoteProps {
  note: StickyNote
  desktop?: boolean
  autoFocus?: boolean
  size?: number
  onResize?: (size: number) => void
  onPin?: (dragging: boolean, point?: { x: number; y: number }) => Promise<void>
  onReturn?: () => Promise<void>
}

export function StickyNoteCard({ note, desktop = false, autoFocus = false, size = STICKY_DEFAULT_SIZE, onResize, onPin, onReturn }: StickyNoteProps) {
  const draft = useStickyDraft(note)
  const [moving, setMoving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [hint, setHint] = useState('')
  const [menu, setMenu] = useState<{ kind: 'delete' | 'color'; x: number; y: number } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [resizing, setResizing] = useState(false)
  const card = useRef<HTMLElement>(null)
  const menuElement = useRef<HTMLDivElement>(null)
  const menuAction = useRef<HTMLButtonElement>(null)
  const deletePending = useRef(false)
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null)
  const dragPoint = useRef<{ x: number; y: number } | undefined>(undefined)
  const returning = useRef(false)
  const resizeCleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => resizeCleanup.current?.(), [])

  const closeMenu = () => setMenu(null)

  useEffect(() => {
    if (!menu) return
    const previous = document.activeElement as HTMLElement | null
    menuAction.current?.focus({ preventScroll: true })
    const outside = (event: globalThis.PointerEvent) => {
      if (!menuElement.current?.contains(event.target as Node)) closeMenu()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
        previous?.focus({ preventScroll: true })
      } else if (event.key === 'Tab') closeMenu()
    }
    const dismiss = () => closeMenu()
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('blur', dismiss)
    }
  }, [menu])

  const showMenu = (event: MouseEvent<HTMLElement>, doubleClick = false) => {
    if (doubleClick && (event.target as Element).closest('textarea, button, [role="menu"]')) return
    event.preventDefault()
    event.stopPropagation()
    if (moving || removing || draft.deleting || draft.deleted || draft.loadingLatest) return
    pointer.current = null
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX || bounds.left + 24
    const y = event.clientY || bounds.top + 38
    setMenu({ kind: 'delete', x: Math.max(8, Math.min(x, window.innerWidth - 164)), y: Math.max(8, Math.min(y, window.innerHeight - 56)) })
  }

  const showColors = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    pointer.current = null
    if (menu?.kind === 'color') { closeMenu(); return }
    const bounds = event.currentTarget.getBoundingClientRect()
    setMenu({ kind: 'color', x: Math.max(8, Math.min(bounds.right - 208, window.innerWidth - 216)), y: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 100)) })
  }

  const removeNote = async () => {
    if (deletePending.current) return
    deletePending.current = true
    closeMenu()
    setRemoving(true)
    setActionError('')
    try {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      await new Promise(resolve => setTimeout(resolve, reducedMotion ? 0 : 180))
      await draft.remove()
      if (desktop && onReturn) await onReturn()
    } catch (error) { setActionError((error as Error).message) }
    finally { setRemoving(false); deletePending.current = false }
  }

  const returnToCalendar = async () => {
    if (!onReturn || returning.current || deletePending.current) return
    returning.current = true
    setMoving(true)
    if (!draft.deleted && !await draft.flush()) { returning.current = false; setMoving(false); return }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    await new Promise(resolve => setTimeout(resolve, reducedMotion ? 0 : 180))
    try { await onReturn() } catch (error) { setActionError((error as Error).message); setMoving(false) }
    returning.current = false
  }

  useEffect(() => {
    if (!desktop) return
    window.smartNotesFlushSticky = draft.flush
    const handleReturn = () => { void returnToCalendar() }
    window.addEventListener('sticky-return-requested', handleReturn)
    return () => {
      delete window.smartNotesFlushSticky
      window.removeEventListener('sticky-return-requested', handleReturn)
    }
  })

  const pin = async (dragging = false) => {
    if (moving || removing || draft.deleting || draft.deleted || !onPin) return
    if (!window.pywebview?.api?.detach_sticky) {
      setHint('在 Smart Notes 桌面版中，可将便签拖出并置顶。')
      return
    }
    setMoving(true)
    setActionError('')
    const track = (event: globalThis.PointerEvent) => { dragPoint.current = { x: event.screenX, y: event.screenY } }
    if (dragging) {
      window.addEventListener('pointermove', track, true)
      window.addEventListener('pointerup', track, true)
    }
    try {
      if (await draft.flush()) await onPin(dragging, dragging ? dragPoint.current : undefined)
    } catch (error) { setActionError((error as Error).message) }
    finally {
      window.removeEventListener('pointermove', track, true)
      window.removeEventListener('pointerup', track, true)
      setMoving(false)
    }
  }

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (desktop || event.button !== 0 || moving || removing || draft.deleting || draft.deleted) return
    pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 9) return
    dragPoint.current = { x: event.screenX, y: event.screenY }
    pointer.current = null
    void pin(true)
  }

  const resizeNote = async (next: number) => {
    const maximum = desktop ? STICKY_MAX_SIZE : card.current?.parentElement?.parentElement?.clientWidth || STICKY_MAX_SIZE
    const nextSize = clampStickySize(next, maximum)
    if (desktop && window.pywebview?.api?.set_sticky_size) {
      const result = await window.pywebview.api.set_sticky_size(note.id, nextSize)
      if (!result.ok) { setActionError(result.error || '暂时无法调整便签大小。'); return }
      onResize?.(result.size ?? nextSize)
    } else {
      onResize?.(nextSize)
    }
  }

  const startResize = (event: PointerEvent<HTMLButtonElement>, corner: 'top-left' | 'bottom-left') => {
    if (event.button !== 0 || moving || removing || draft.deleting || draft.deleted) return
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
    pointer.current = null
    resizeCleanup.current?.()
    if (desktop) {
      const bridge = window.pywebview?.api
      if (!bridge?.resize_sticky) return
      setActionError('')
      void bridge.resize_sticky(note.id, corner, event.screenX, event.screenY).then(result => {
        if (!result.ok) setActionError(result.error || '暂时无法调整便签大小。')
      }).catch(error => setActionError((error as Error).message))
      return
    }
    const target = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const startSize = card.current?.offsetWidth || size
    const maximum = Math.min(STICKY_MAX_SIZE, card.current?.parentElement?.parentElement?.clientWidth || STICKY_MAX_SIZE)
    let nextSize = startSize
    let frame = 0
    setResizing(true)
    target.setPointerCapture(pointerId)
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return
      nextSize = resizeStickySize(startSize, next.clientX - startX, next.clientY - startY, corner, maximum)
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; onResize?.(nextSize) })
    }
    const finish = (next?: globalThis.PointerEvent) => {
      if (next && next.pointerId !== pointerId) return
      if (frame) cancelAnimationFrame(frame)
      onResize?.(nextSize)
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', cancel)
      resizeCleanup.current = null
      setResizing(false)
    }
    const cancel = () => finish()
    resizeCleanup.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', cancel)
  }

  return (
    <article ref={card} tabIndex={0} data-sticky-color={draft.color} className={`sticky-note-card ${desktop ? 'sticky-note-desktop' : ''} ${moving ? 'sticky-note-moving' : ''} ${removing ? 'sticky-note-removing' : ''} ${resizing ? 'sticky-note-resizing' : ''}`} aria-label={`${note.date} 便签`} onContextMenu={showMenu} onDoubleClick={event => showMenu(event, true)} onKeyDown={event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        if (moving || removing || draft.deleting || draft.deleted || draft.loadingLatest) return
        const bounds = event.currentTarget.getBoundingClientRect()
        setMenu({ kind: 'delete', x: Math.max(8, Math.min(bounds.left + 24, window.innerWidth - 164)), y: Math.max(8, Math.min(bounds.top + 38, window.innerHeight - 56)) })
      }
    }}>
      <header className="sticky-note-header">
        <div className={`sticky-note-grip ${desktop ? 'pywebview-drag-region' : ''}`} title="拖动便签到桌面" onPointerDown={startDrag} onPointerMove={drag} onPointerUp={() => { pointer.current = null }} onPointerCancel={() => { pointer.current = null }}>
          <StickyIcon size={15} aria-hidden="true" />
          <span>{Number(note.date.slice(5, 7))} 月 {Number(note.date.slice(8))} 日</span>
        </div>
        <button className="sticky-icon-button sticky-color-button" aria-label="更改便签颜色" title="更改便签颜色" aria-haspopup="menu" aria-expanded={menu?.kind === 'color'} disabled={moving || removing || draft.deleting || draft.deleted || draft.loadingLatest} onClick={showColors}><GripHorizontal size={18} aria-hidden="true" /></button>
        {desktop ? (
          <button className="sticky-icon-button" aria-label="收回便签到日历" title="关闭并收回日历" disabled={moving} onClick={() => { void returnToCalendar() }}><X size={17} /></button>
        ) : (
          <button className="sticky-icon-button" aria-label="置顶便签到桌面" title="置顶到桌面，也可拖动顶部移出" disabled={moving} onClick={() => { void pin() }}><ArrowUpRight size={17} /></button>
        )}
      </header>
      {draft.deleted ? <div className="sticky-note-deleted" role="status">便签已删除</div> : <textarea className="sticky-note-content" aria-label="便签内容" placeholder="记下此刻的小事…" maxLength={20000} value={draft.text} autoFocus={autoFocus} disabled={moving || removing || draft.loadingLatest || draft.deleting} onChange={event => draft.setText(event.target.value)} onBlur={() => { void draft.flush() }} spellCheck={false} />}
      {(draft.error || actionError || hint) && <div className="sticky-note-message" role={draft.error || actionError ? 'alert' : 'status'}>
        {draft.error || actionError || hint}
        {draft.status === 'conflict' ? <>
          <button disabled={draft.loadingLatest} onClick={() => { try { draft.exportDraft(); setHint('已发起草稿下载。') } catch (error) { setActionError((error as Error).message) } }}>导出草稿</button>
          <button disabled={draft.loadingLatest} onClick={() => {
            if (!window.confirm('读取最新版本会替换当前未保存的内容和颜色。如需保留当前草稿，请先导出。继续读取吗？')) return
            void draft.loadLatest({ discardDraft: true }).then(() => { setHint(''); setActionError('') }).catch(error => setActionError(error.message))
          }}>{draft.loadingLatest ? '读取中…' : '读取最新'}</button>
        </> : draft.status === 'error' ? <button onClick={() => { void draft.flush() }}>重试保存</button> : null}
      </div>}
      {!draft.deleted && <footer className="sticky-note-footer">
        <span className="sticky-note-save-state" role="status">{draft.status === 'saving' ? <><LoaderCircle size={11} className="sticky-spinner" /> 保存中</> : draft.status === 'saved' ? <><Check size={11} /> 已保存</> : draft.status === 'pending' ? '正在记录…' : '未保存'}</span>
      </footer>}
      {(['top-left', 'bottom-left'] as const).map(corner => <button key={corner} type="button" className={`sticky-resize-handle sticky-resize-${corner}`} aria-label={`从${corner === 'top-left' ? '左上' : '左下'}角调整便签大小`} title="拖动调整便签大小" disabled={moving || removing || draft.deleting || draft.deleted} onPointerDown={event => startResize(event, corner)} onKeyDown={event => {
        const delta = event.key === 'ArrowLeft' || event.key === '+' ? 12 : event.key === 'ArrowRight' || event.key === '-' ? -12 : event.key === 'ArrowUp' ? (corner === 'top-left' ? 12 : -12) : event.key === 'ArrowDown' ? (corner === 'top-left' ? -12 : 12) : 0
        if (!delta) return
        event.preventDefault()
        event.stopPropagation()
        void resizeNote((card.current?.offsetWidth || size) + delta).catch(error => setActionError((error as Error).message))
      }} />)}
      {menu && createPortal(<div ref={menuElement} className={`sticky-note-context-menu ${menu.kind === 'color' ? 'sticky-color-menu' : ''}`} role="menu" aria-label={menu.kind === 'color' ? '便签颜色' : '便签操作'} data-sticky-color={draft.color} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()}>
        {menu.kind === 'color' ? <>
          <span className="sticky-color-menu-title">便签颜色</span>
          <div className="sticky-color-options">{STICKY_COLORS.map(color => <button key={color.value} ref={draft.color === color.value ? menuAction : undefined} type="button" role="menuitemradio" aria-label={color.label} aria-checked={draft.color === color.value} title={color.value === 'yellow' ? '黄色（默认）' : color.label} className="sticky-color-swatch" data-sticky-color={color.value} onClick={() => { draft.setColor(color.value); closeMenu() }}>{draft.color === color.value && <Check size={16} strokeWidth={2} aria-hidden="true" />}</button>)}</div>
        </> : <button ref={menuAction} type="button" role="menuitem" onClick={() => { void removeNote() }}><Trash2 size={15} aria-hidden="true" />删除便签</button>}
      </div>, document.body)}
    </article>
  )
}
