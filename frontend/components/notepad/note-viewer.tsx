"use client"

import { useRef, useState } from 'react'
import { ArrowLeft, CalendarDays, PenLine, Sparkles, Trash2 } from 'lucide-react'
import { Note } from '@/hooks/use-notes'
import { AIChatView } from './ai-chat-view'
import { NoteContent } from './note-content'
import { ContextMenu, ContextMenuItem } from './context-menu'
import { writeClipboardText } from '@/lib/clipboard'

interface NoteViewerProps {
  note: Note
  onEdit: () => void
  onDelete?: () => void
  onBack: () => void
}

export function NoteViewer({ note, onEdit, onDelete, onBack }: NoteViewerProps) {
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
    <div className="notes-viewer">
      <div className="notes-viewer-toolbar">
        <button onClick={onBack} className="notes-back-button"><ArrowLeft size={16} strokeWidth={1.7} /> 所有笔记</button>
        <div className="notes-viewer-actions">
          <button onClick={onEdit} className="glass-button"><PenLine size={15} strokeWidth={1.7} /> 编辑</button>
          {onDelete && <button onClick={onDelete} className="glass-icon-button notes-delete-button" aria-label="删除笔记" title="删除笔记"><Trash2 size={15} strokeWidth={1.7} /></button>}
          <span className="notes-toolbar-divider" />
          <button onClick={() => setAiOpen(v => !v)} aria-pressed={aiOpen} className={`glass-button ${aiOpen ? 'glass-button-primary' : ''}`}>
            <Sparkles size={15} strokeWidth={1.7} /> AI 建议
          </button>
        </div>
      </div>

      <div className={`notes-viewer-split ${aiOpen ? 'has-ai' : ''}`}>
        <div className="notes-reading-scroll">
          <article className="notes-reading-canvas glass-card">
            <header className="notes-reading-header">
              <span className="notes-note-category">{note.category}</span>
              <h2>{note.title}</h2>
              <div className="notes-reading-meta"><CalendarDays size={14} strokeWidth={1.5} /><span>{formatDate(note.createdAt)}</span><span className="notes-reading-updated">更新于 {formatDate(note.updatedAt)}</span></div>
            </header>
            <div
              ref={contentRef}
              tabIndex={0}
              onKeyDown={onKeyDown}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY })
              }}
              className="notes-reading-body"
              aria-label="笔记正文"
            >
              <NoteContent content={note.content} />
            </div>
            <div className="notes-reading-end"><span /><span className="notes-reading-end-dot" /><span /></div>
          </article>
        </div>

        {aiOpen && (
          <div className="notes-ai-panel glass-card">
            <AIChatView note={note} embedded onClose={() => setAiOpen(false)} />
          </div>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
}
