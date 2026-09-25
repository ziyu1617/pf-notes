"use client"

import { useRef, useState } from 'react'
import { Note } from '@/hooks/use-notes'
import { stripImageMarkdown } from '@/lib/images'

interface DeleteViewProps {
  note: Note | null
  onDelete: (id: string) => void | Promise<void>
  onCancel: () => void
}

export function DeleteView({ note, onDelete, onCancel }: DeleteViewProps) {
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deletingRef = useRef(false)

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#ece9d8]">
        <div className="text-center p-4 bg-[#d4d0c8] win-border">
          <div className="text-[12px] mb-4">请先从"所有笔记"中选择要删除的笔记</div>
          <button onClick={onCancel} className="win-button text-[11px] px-4 py-1">
            确定
          </button>
        </div>
      </div>
    )
  }

  const handleDelete = async () => {
    if (deletingRef.current) return
    if (!confirm(`确定要删除笔记 "${note.title}" 吗？\n\n此操作不可撤销！`)) return
    deletingRef.current = true
    setDeleting(true)
    setDeleteError('')
    try {
      await onDelete(note.id)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '笔记删除失败，请稍后重试。')
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-[#ece9d8]" aria-busy={deleting}>
      <div className="p-4 bg-[#d4d0c8] win-border max-w-md w-full">
        <div className="text-[12px] font-bold mb-3">确认删除以下笔记：</div>
        <div className="bg-white p-3 win-inset mb-4">
          <div className="text-[12px] font-bold">{note.title}</div>
          <div className="text-[10px] text-[#404040] mt-1">
            分类: {note.category}
          </div>
          <div className="text-[11px] mt-2 text-[#404040] max-h-20 overflow-auto">
            {stripImageMarkdown(note.content).substring(0, 200)}
            {stripImageMarkdown(note.content).length > 200 && '...'}
          </div>
        </div>
        <div className="text-[11px] text-[#c00000] mb-4">
          删除后将无法恢复！
        </div>
        {deleteError && <p role="alert" className="text-[11px] text-[#a00000] mb-4">{deleteError}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={deleting} className="win-button text-[11px] px-4 py-1">
            取消
          </button>
          <button 
            onClick={() => { void handleDelete() }}
            disabled={deleting}
            className="win-button text-[11px] px-4 py-1"
            style={{ color: '#c00000' }}
          >
            {deleting ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  )
}
