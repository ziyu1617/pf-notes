"use client"

import { useEffect, useId, useRef } from 'react'
import { LogOut, X } from 'lucide-react'

interface ExitDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

export function ExitDialog({ onConfirm, onCancel }: ExitDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [onCancel])

  return (
    <div className="glass-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div ref={dialogRef} className="glass-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <button onClick={onCancel} className="glass-icon-button glass-dialog-close" aria-label="关闭退出确认"><X size={18} /></button>
        <div className="glass-dialog-icon" aria-hidden="true"><LogOut size={25} strokeWidth={1.5} /></div>
        <h2 id={titleId}>暂时合上笔记？</h2>
        <p id={descriptionId}>笔记会自动保存到本地。<br />下次回来，继续记录你的想法。</p>
        <div className="glass-dialog-actions">
          <button ref={cancelRef} onClick={onCancel} className="glass-button">继续记录</button>
          <button onClick={onConfirm} className="glass-button-primary">退出记事本</button>
        </div>
      </div>
    </div>
  )
}
