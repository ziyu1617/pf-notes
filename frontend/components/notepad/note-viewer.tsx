"use client"

import { useState } from 'react'
import { Note } from '@/hooks/use-notes'
import { AIChatView } from './ai-chat-view'
import { NoteContent } from './note-content'

interface NoteViewerProps {
  note: Note
  onEdit: () => void
  onDelete?: () => void
  onBack: () => void
}

export function NoteViewer({ note, onEdit, onDelete, onBack }: NoteViewerProps) {
  const [aiOpen, setAiOpen] = useState(false)

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 工具栏 */}
      <div className="p-2 bg-[#d4d0c8] border-b border-[#808080] flex items-center gap-2">
        <button onClick={onBack} className="win-button text-[10px] px-2">
          返回列表
        </button>
        <div className="w-px h-4 bg-[#808080]" />
        <button onClick={onEdit} className="win-button text-[10px] px-2">
          编辑
        </button>
        {onDelete && (
          <button onClick={onDelete} className="win-button text-[10px] px-2">
            删除
          </button>
        )}
        <div className="w-px h-4 bg-[#808080]" />
        <button
          onClick={() => setAiOpen(v => !v)}
          className={`win-button text-[10px] px-2 ${aiOpen ? 'bg-[#000080] text-white' : ''}`}
        >
          💬 AI 建议
        </button>
      </div>

      {/* 主体：笔记（左 7）+ 可选的 AI 建议分栏（右 3） */}
      <div className="flex-1 flex overflow-hidden">
        {/* 笔记区 */}
        <div className={`flex flex-col p-2 gap-2 bg-[#ece9d8] overflow-auto ${aiOpen ? 'flex-[7] min-w-0' : 'flex-1'}`}>
          {/* 笔记信息 */}
          <div className="bg-[#d4d0c8] p-2 win-border">
            <h2 className="text-[14px] font-bold mb-2">{note.title}</h2>
            <div className="flex gap-4 text-[10px] text-[#404040]">
              <span>分类: {note.category}</span>
              <span>创建: {formatDate(note.createdAt)}</span>
              <span>更新: {formatDate(note.updatedAt)}</span>
            </div>
          </div>

          {/* 笔记内容 */}
          <div className="flex-1 bg-white p-3 win-inset overflow-auto min-h-[200px]">
            <NoteContent content={note.content} />
          </div>
        </div>

        {/* AI 建议分栏 */}
        {aiOpen && (
          <div className="flex-[3] min-w-0 flex flex-col border-l-2 border-[#808080] overflow-hidden">
            <AIChatView note={note} embedded onClose={() => setAiOpen(false)} />
          </div>
        )}
      </div>
    </div>
  )
}
