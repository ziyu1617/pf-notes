"use client"

import { useState } from 'react'

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
          <label className="text-[11px]">内容：</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 p-2 text-[12px] win-input resize-none font-mono leading-relaxed min-h-[300px]"
            placeholder="输入笔记内容..."
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
