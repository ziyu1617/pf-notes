'use client'

import { useEffect, useState } from 'react'
import { StickyNoteCard } from '@/components/notepad/sticky-note'
import { stickyRequest, type StickyNote } from '@/lib/sticky-notes'
import { useStickySize } from '@/lib/sticky-layout'

function DesktopStickyEditor({ note, onReturn }: { note: StickyNote; onReturn: () => Promise<void> }) {
  const [size, setSize] = useStickySize(note.id)
  return <StickyNoteCard note={note} desktop autoFocus size={size} onResize={setSize} onReturn={onReturn} />
}

export default function DesktopStickyPage() {
  const [note, setNote] = useState<StickyNote | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    document.documentElement.classList.add('sticky-window')
    document.title = 'smart notes · 便签'
    const id = new URLSearchParams(window.location.search).get('id') || ''
    if (!/^[1-9]\d*$/.test(id)) setError('未找到这张便签。')
    else stickyRequest<StickyNote>(`/api/sticky-notes/${id}`).then(data => {
        if (!cancelled) { setNote(data); setError('') }
      }).catch(error => { if (!cancelled) setError(error.message) })
    return () => { cancelled = true; document.documentElement.classList.remove('sticky-window') }
  }, [attempt])

  const returnNote = async () => {
    const id = note?.id || new URLSearchParams(window.location.search).get('id') || ''
    const bridge = window.pywebview?.api
    if (!bridge) { setError('请在桌面应用中收回便签。'); return }
    const result = await bridge.return_sticky(id)
    if (!result.ok) throw new Error(result.error || '收回便签失败，请重试。')
  }

  useEffect(() => {
    if (note) return
    // Loading/error windows have no editor yet, but their native close must work.
    const close = () => { void returnNote().catch(error => setError(error.message)) }
    window.addEventListener('sticky-return-requested', close)
    return () => window.removeEventListener('sticky-return-requested', close)
  }, [note])

  return <main className="sticky-window-root">
    {note ? <DesktopStickyEditor note={note} onReturn={returnNote} /> : <div className="sticky-window-loading" role="status">
      <span>{error || '正在展开便签…'}</span>
      {error && <div><button onClick={() => setAttempt(value => value + 1)}>重新加载</button><button onClick={() => { void returnNote().catch(error => setError(error.message)) }}>收回</button></div>}
    </div>}
  </main>
}
