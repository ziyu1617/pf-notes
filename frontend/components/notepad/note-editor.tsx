"use client"

import { useRef, useState } from 'react'
import { imageFilesFrom, uploadImageAsMarkdown } from '@/lib/images'
import { readClipboard, writeClipboardText } from '@/lib/clipboard'
import { ContextMenu, ContextMenuItem } from './context-menu'

interface NoteEditorProps {
  initialTitle?: string
  initialContent?: string
  initialCategory?: string
  diaryDate?: string
  categories: string[]
  onSave: (title: string, content: string, category: string) => void | Promise<void>
  onCancel: () => void
  isEditing?: boolean
}

export function NoteEditor({
  initialTitle = '',
  initialContent = '',
  initialCategory = '',
  diaryDate,
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
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const savingRef = useRef(false)
  const categoryOptions = Array.from(new Set([...categories, initialCategory].filter(Boolean)))
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

  const handleSave = async () => {
    if (savingRef.current || uploading) return
    setSaveError('')
    if (!title.trim() || !content.trim()) {
      setSaveError('标题和内容不能为空！')
      return
    }
    const finalCategory = showNewCategory ? newCategory.trim() : category
    if (!finalCategory) {
      setSaveError('请选择或输入分类！')
      return
    }
    savingRef.current = true
    setSaving(true)
    setMenu(null)
    try {
      await onSave(title.trim(), content.trim(), finalCategory)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '笔记保存失败，请稍后重试。')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" aria-busy={saving}>
      <div className="p-2 bg-[#d4d0c8] border-b border-[#808080] text-[11px] font-bold">
        {diaryDate ? (isEditing ? '编辑日记' : '写日记') : (isEditing ? '编辑笔记' : '新建笔记')}
      </div>
      
      <fieldset disabled={saving} className="flex-1 min-w-0 flex flex-col p-2 gap-2 border-0 bg-[#ece9d8] overflow-auto">
        {diaryDate && (
          <div className="win-inset bg-[#fff5fa] px-3 py-2 text-[11px] text-[#80405f]">
            日记日期：<time dateTime={diaryDate} className="font-bold">{diaryDate}</time>
            <span className="ml-2 text-[10px]">保存后归入这一天</span>
          </div>
        )}
        {/* 标题输入 */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] w-16">标题：</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 p-1 text-[12px] win-input"
            placeholder="输入笔记标题..."
          />
        </div>
        
        {/* 分类选择 */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] w-16">分类：</label>
          {!showNewCategory ? (
            <>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="flex-1 p-1 text-[12px] win-input"
              >
                <option value="">选择分类...</option>
                {categoryOptions.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <button
                onClick={() => setShowNewCategory(true)}
                className="win-button text-[11px] px-2"
              >
                + 新分类
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="flex-1 p-1 text-[12px] win-input"
                placeholder="输入新分类名称..."
              />
              <button
                onClick={() => setShowNewCategory(false)}
                className="win-button text-[11px] px-2"
              >
                取消
              </button>
            </>
          )}
        </div>
        
        {/* 内容编辑 */}
        <div className="flex-1 flex flex-col gap-1 min-h-0">
          <div className="flex items-center gap-2">
            <label className="text-[11px]">内容：</label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving || uploading}
              className="win-button text-[11px] px-2"
            >
              📷 插入图片
            </button>
            <span className="text-[10px] text-[#606060]">
              {uploading ? '图片上传中…' : '可直接粘贴或拖入图片'}
            </span>
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
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onContextMenu={openMenu}
            className="flex-1 p-2 text-[12px] win-input resize-none font-mono leading-relaxed min-h-[300px]"
            placeholder="输入笔记内容...（右键可选中/复制/粘贴；图片可直接粘贴或拖入）"
          />
        </div>
        
        {saveError && <p role="alert" className="text-[11px] text-[#a00000]">{saveError}</p>}
        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="win-button text-[11px] px-4 py-1">
            取消
          </button>
          <button onClick={() => { void handleSave() }} disabled={saving || uploading} className="win-button text-[11px] px-4 py-1">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </fieldset>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
