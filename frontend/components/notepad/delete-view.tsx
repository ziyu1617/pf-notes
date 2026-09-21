"use client"

import { Note } from '@/hooks/use-notes'
import { stripImageMarkdown } from '@/lib/images'
import { useEffect, useRef } from 'react'
import { FileText, Trash2 } from 'lucide-react'

interface DeleteViewProps {
  note: Note | null
  onDelete: (id: string) => void
  onCancel: () => void
}

export function DeleteView({ note, onDelete, onCancel }: DeleteViewProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  if (!note) {
    return (
      <div className="glass-delete-view">
        <div className="glass-dialog glass-delete-card">
          <div className="glass-dialog-icon" aria-hidden="true"><FileText size={25} strokeWidth={1.5} /></div>
          <h2>还没有选择笔记</h2>
          <p>先到“所有笔记”选择你想删除的内容。</p>
          <div className="glass-dialog-actions"><button ref={cancelRef} onClick={onCancel} className="glass-button-primary">返回笔记</button></div>
        </div>
      </div>
    )
  }

  const handleDelete = () => {
    if (confirm(`确定要删除笔记 "${note.title}" 吗？\n\n此操作不可撤销！`)) {
      onDelete(note.id)
    }
  }

  return (
    <div className="glass-delete-view">
      <div className="glass-dialog glass-delete-card">
        <div className="glass-dialog-icon glass-dialog-icon-danger" aria-hidden="true"><Trash2 size={25} strokeWidth={1.5} /></div>
        <h2>删除这条笔记？</h2>
        <p>删除后无法恢复，请确认是否继续。</p>
        <div className="glass-delete-preview">
          <h3>{note.title || '无标题笔记'}</h3>
          <span className="glass-chip">{note.category}</span>
          <div className="glass-delete-excerpt">
            {stripImageMarkdown(note.content).substring(0, 200)}
            {stripImageMarkdown(note.content).length > 200 && '...'}
          </div>
        </div>
        <div className="glass-dialog-actions">
          <button ref={cancelRef} onClick={onCancel} className="glass-button">保留笔记</button>
          <button onClick={handleDelete} className="glass-button glass-button-danger">确认删除</button>
        </div>
      </div>
    </div>
  )
}
