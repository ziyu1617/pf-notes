"use client"

import { Note } from '@/hooks/use-notes'

interface DeleteViewProps {
  note: Note | null
  onDelete: (id: string) => void
  onCancel: () => void
}

export function DeleteView({ note, onDelete, onCancel }: DeleteViewProps) {
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

  const handleDelete = () => {
    if (confirm(`确定要删除笔记 "${note.title}" 吗？\n\n此操作不可撤销！`)) {
      onDelete(note.id)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-[#ece9d8]">
      <div className="p-4 bg-[#d4d0c8] win-border max-w-md w-full">
        <div className="text-[12px] font-bold mb-3">确认删除以下笔记：</div>
        <div className="bg-white p-3 win-inset mb-4">
          <div className="text-[12px] font-bold">{note.title}</div>
          <div className="text-[10px] text-[#404040] mt-1">
            分类: {note.category}
          </div>
          <div className="text-[11px] mt-2 text-[#404040] max-h-20 overflow-auto">
            {note.content.substring(0, 200)}
            {note.content.length > 200 && '...'}
          </div>
        </div>
        <div className="text-[11px] text-[#c00000] mb-4">
          删除后将无法恢复！
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="win-button text-[11px] px-4 py-1">
            取消
          </button>
          <button 
            onClick={handleDelete} 
            className="win-button text-[11px] px-4 py-1"
            style={{ color: '#c00000' }}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}
