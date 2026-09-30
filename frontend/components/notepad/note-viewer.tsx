"use client"

import { useRef, useState } from 'react'
import { Note } from '@/hooks/use-notes'
import { AIChatView } from './ai-chat-view'
import { NoteContent } from './note-content'
import { ContextMenu, ContextMenuItem } from './context-menu'
import { writeClipboardText } from '@/lib/clipboard'

interface NoteViewerProps {
  note: Note
  onEdit: () => void
  onDelete?: () => void
  onBack?: () => void
  backLabel?: string
}

export function NoteViewer({ note, onEdit, onDelete, onBack, backLabel = '返回列表' }: NoteViewerProps) {
  const [aiOpen, setAiOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // 选中正文区域（含图片）的全部内容
  const selectAll = () => {
    const el = contentRef.current
    if (!el) return
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  // 复制：有选区就复制选中文本，否则复制整篇正文
  const copy = async () => {
    const selected = window.getSelection()?.toString() ?? ''
    await writeClipboardText(selected || contentRef.current?.innerText || '')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      selectAll()
    }
  }

  const hasSelection = () => (window.getSelection()?.toString().length ?? 0) > 0
  const menuItems: ContextMenuItem[] = [
    { label: '复制', shortcut: 'Ctrl+C', disabled: !hasSelection(), onClick: () => void copy() },
    { label: '复制全文', onClick: () => void writeClipboardText(contentRef.current?.innerText || '') },
    'separator',
    { label: '全选', shortcut: 'Ctrl+A', onClick: selectAll },
  ]

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
    <div className="fv-secondary fv-viewer min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden">
      {/* 工具栏 */}
      <div className="fv-toolbar p-2 bg-[#d4d0c8] border-b border-[#808080] flex flex-wrap items-center gap-2">
        {onBack && (
          <>
            <button onClick={onBack} className="win-button text-[10px] px-2">
              {backLabel}
            </button>
            <div className="fv-divider w-px h-4 bg-[#808080]" />
          </>
        )}
        <button onClick={onEdit} className="win-button text-[10px] px-2">
          编辑
        </button>
        {onDelete && (
          <button onClick={onDelete} className="win-button text-[10px] px-2">
            删除
          </button>
        )}
        <div className="fv-divider w-px h-4 bg-[#808080]" />
        <button
          onClick={() => setAiOpen(v => !v)}
          className={`fv-ai-toggle win-button text-[10px] px-2 ${aiOpen ? 'fv-is-active bg-[#000080] text-white' : ''}`}
        >
          💬 AI 建议
        </button>
      </div>

      {/* 主体：笔记（左 7）+ 可选的 AI 建议分栏（右 3） */}
      <div className="flex-1 flex overflow-hidden">
        {/* 笔记区 */}
        <div className={`fv-workspace flex flex-col p-2 gap-2 bg-[#ece9d8] overflow-auto ${aiOpen ? 'flex-[7] min-w-0' : 'flex-1'}`}>
          {/* 笔记信息 */}
          <div className="fv-note-metadata bg-[#d4d0c8] p-2 win-border">
            <h2 className="text-[14px] font-bold mb-2">{note.title}</h2>
            <div className="fv-muted flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#404040]">
              {note.diaryDate && <span>日记日期: <time dateTime={note.diaryDate}>{note.diaryDate}</time></span>}
              <span>分类: {note.category}</span>
              <span>创建: {formatDate(note.createdAt)}</span>
              <span>更新: {formatDate(note.updatedAt)}</span>
            </div>
          </div>

          {/* 笔记内容 */}
          <div
            ref={contentRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY })
            }}
            className="fv-reader-paper flex-1 bg-white p-3 win-inset overflow-auto min-h-[200px] outline-none select-text"
          >
            <NoteContent content={note.content} />
          </div>
        </div>

        {/* AI 建议分栏 */}
        {aiOpen && (
          <div className="fv-ai-split flex-[3] min-w-0 flex flex-col border-l-2 border-[#808080] overflow-hidden">
            <AIChatView note={note} embedded onClose={() => setAiOpen(false)} />
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
