"use client"

import { useRef, useState } from 'react'
import { Check, ChevronDown, ImagePlus, Leaf, Plus, X } from 'lucide-react'
import { imageFilesFrom, uploadImageAsMarkdown } from '@/lib/images'
import { readClipboard, writeClipboardText } from '@/lib/clipboard'
import { ContextMenu, ContextMenuItem } from './context-menu'

interface NoteEditorProps {
  initialTitle?: string
  initialContent?: string
  initialCategory?: string
  categories: string[]
  onSave: (title: string, content: string, category: string) => void
  onCancel: () => void
  isEditing?: boolean
}

export function NoteEditor({
  initialTitle = '',
  initialContent = '',
  initialCategory = '',
  categories,
  onSave,
  onCancel,
  isEditing = false,
}: NoteEditorProps) {
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  const [category, setCategory] = useState(initialCategory)
  const [newCategory, setNewCategory] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 右键时先捕获选区，之后焦点移到菜单也不会丢失
  const selRef = useRef({ start: 0, end: 0 })

  // 用文本替换 [start, end) 区间，并把光标移到插入内容之后
  const replaceRange = (start: number, end: number, text: string) => {
    const el = textareaRef.current
    setContent(prev => {
      const next = prev.slice(0, start) + text + prev.slice(end)
      requestAnimationFrame(() => {
        if (el) {
          const pos = start + text.length
          el.selectionStart = el.selectionEnd = pos
          el.focus()
        }
      })
      return next
    })
  }

  // 在当前光标处插入文本
  const insertAtCursor = (text: string) => {
    const el = textareaRef.current
    if (!el) {
      setContent(prev => prev + text)
      return
    }
    replaceRange(el.selectionStart, el.selectionEnd, text)
  }

  const uploadAndInsert = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        const md = await uploadImageAsMarkdown(file)
        insertAtCursor(`\n${md}\n`)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '图片上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = imageFilesFrom(e.clipboardData)
    if (images.length > 0) {
      e.preventDefault()
      void uploadAndInsert(images)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    const images = imageFilesFrom(e.dataTransfer)
    if (images.length > 0) {
      e.preventDefault()
      void uploadAndInsert(images)
    }
  }

  // ── 右键菜单：选中 / 剪切 / 复制 / 粘贴 / 全选 ──────────────
  const openMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const el = textareaRef.current
    if (el) selRef.current = { start: el.selectionStart, end: el.selectionEnd }
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const copySelection = async () => {
    const { start, end } = selRef.current
    if (end > start) await writeClipboardText(content.slice(start, end))
  }

  const cutSelection = async () => {
    const { start, end } = selRef.current
    if (end <= start) return
    await writeClipboardText(content.slice(start, end))
    replaceRange(start, end, '')
  }

  const pasteFromClipboard = async () => {
    const { start, end } = selRef.current
    const { text, images } = await readClipboard()
    if (images.length > 0) {
      setUploading(true)
      try {
        const mds: string[] = []
        for (const file of images) mds.push(await uploadImageAsMarkdown(file))
        replaceRange(start, end, `\n${mds.join('\n')}\n`)
      } catch (err) {
        alert(err instanceof Error ? err.message : '图片粘贴失败')
      } finally {
        setUploading(false)
      }
    } else if (text) {
      replaceRange(start, end, text)
    } else {
      alert('剪贴板为空，或浏览器未授予读取权限')
    }
  }

  const selectAll = () => {
    const el = textareaRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }

  const hasSelection = selRef.current.end > selRef.current.start
  const menuItems: ContextMenuItem[] = [
    { label: '剪切', shortcut: 'Ctrl+X', disabled: !hasSelection, onClick: () => void cutSelection() },
    { label: '复制', shortcut: 'Ctrl+C', disabled: !hasSelection, onClick: () => void copySelection() },
    { label: '粘贴', shortcut: 'Ctrl+V', onClick: () => void pasteFromClipboard() },
    'separator',
    { label: '全选', shortcut: 'Ctrl+A', disabled: content.length === 0, onClick: selectAll },
  ]

  const handleSave = () => {
    if (!title.trim() || !content.trim()) {
      alert('标题和内容不能为空！')
      return
    }
    const finalCategory = showNewCategory ? newCategory.trim() : category
    if (!finalCategory) {
      alert('请选择或输入分类！')
      return
    }
    onSave(title.trim(), content.trim(), finalCategory)
  }

  return (
    <div className="notes-editor">
      <div className="notes-editor-scroll">
        <div className="notes-writing-canvas glass-card">
          <div className="notes-writing-eyebrow"><Leaf size={15} strokeWidth={1.5} /><span>{isEditing ? '让想法继续生长' : '给今天，留一点文字'}</span></div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="notes-title-input"
            aria-label="笔记标题"
            placeholder="给这一刻起个名字"
          />

          <div className="notes-editor-meta">
            <label className="notes-meta-label" htmlFor="note-category">分类</label>
            {!showNewCategory ? (
              <>
                <div className="notes-category-select-wrap">
                  <select id="note-category" value={category} onChange={(e) => setCategory(e.target.value)} className="notes-category-select">
                    <option value="">选择分类</option>
                    {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
                </div>
                <button onClick={() => setShowNewCategory(true)} className="notes-text-button"><Plus size={14} strokeWidth={1.8} /> 新分类</button>
              </>
            ) : (
              <>
                <input id="note-category" type="text" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="glass-input notes-new-category" placeholder="新分类名称" autoFocus />
                <button onClick={() => setShowNewCategory(false)} className="glass-icon-button" aria-label="取消新分类"><X size={15} /></button>
              </>
            )}
            <span className="notes-editor-meta-dot" />
            <span className="notes-meta-hint">慢慢写，不必着急。</span>
          </div>

          <div className="notes-writing-divider" />
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onContextMenu={openMenu}
            className="notes-writing-input"
            aria-label="笔记内容"
            placeholder="从一个念头开始，写下你想记住的事…"
          />

          <div className="notes-writing-tools">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="notes-text-button">
              <ImagePlus size={17} strokeWidth={1.5} /> 插入图片
            </button>
            <span className="notes-meta-hint" role="status">{uploading ? '图片上传中…' : '支持粘贴或拖入图片'}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void uploadAndInsert(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </div>

      <div className="notes-editor-footer">
        <span className="notes-word-count">{content.length.toLocaleString()} 字<span>每一段文字，都值得被记住</span></span>
        <div className="notes-editor-actions">
          <button onClick={onCancel} className="glass-button">取消</button>
          <button onClick={handleSave} className="glass-button glass-button-primary"><Check size={15} strokeWidth={1.9} /> 保存笔记</button>
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
}
