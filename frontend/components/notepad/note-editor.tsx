"use client"

import { useRef, useState } from 'react'
import { imageFilesFrom, uploadImageAsMarkdown } from '@/lib/images'

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 在光标处插入文本，并把光标移到插入内容之后
  const insertAtCursor = (text: string) => {
    const el = textareaRef.current
    if (!el) {
      setContent(prev => prev + text)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    setContent(prev => {
      const next = prev.slice(0, start) + text + prev.slice(end)
      // 等 React 更新后恢复光标位置
      requestAnimationFrame(() => {
        const pos = start + text.length
        el.selectionStart = el.selectionEnd = pos
        el.focus()
      })
      return next
    })
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
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-2 bg-[#d4d0c8] border-b border-[#808080] text-[11px] font-bold">
        {isEditing ? '编辑笔记' : '新建笔记'}
      </div>
      
      <div className="flex-1 flex flex-col p-2 gap-2 bg-[#ece9d8] overflow-auto">
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
                {categories.map(cat => (
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
            className="flex-1 p-2 text-[12px] win-input resize-none font-mono leading-relaxed min-h-[300px]"
            placeholder="输入笔记内容...（图片可直接 Ctrl/⌘+V 粘贴或拖入）"
          />
        </div>
        
        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="win-button text-[11px] px-4 py-1">
            取消
          </button>
          <button onClick={handleSave} className="win-button text-[11px] px-4 py-1">
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
