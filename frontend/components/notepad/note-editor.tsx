"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { imageFilesFrom, uploadImageAsMarkdown } from '@/lib/images'
import { readClipboard, writeClipboardText } from '@/lib/clipboard'
import { ContextMenu, ContextMenuItem } from './context-menu'
import { NoteAutosave, type FlushNoteDraft, type SavedNoteDraft } from '@/lib/note-autosave'

interface NoteEditorProps {
  initialTitle?: string
  initialContent?: string
  initialCategory?: string
  diaryDate?: string
  categories: string[]
  onSave: (title: string, content: string, category: string, noteId?: string | null, draftId?: string) => void | SavedNoteDraft | Promise<void | SavedNoteDraft>
  onCancel: () => void
  onSaved?: (noteId: string) => void
  onBeginAction?: () => boolean
  onEndAction?: () => void
  isEditing?: boolean
  autoSave?: boolean
  onAutosaveReady?: (flush: FlushNoteDraft | null) => void
}

export function NoteEditor({
  initialTitle = '',
  initialContent = '',
  initialCategory = '',
  diaryDate,
  categories,
  onSave,
  onCancel,
  onSaved,
  onBeginAction,
  onEndAction,
  isEditing = false,
  autoSave = false,
  onAutosaveReady,
}: NoteEditorProps) {
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const [autosave] = useState(() => {
    if (!autoSave) return null
    let recovery
    try {
      recovery = { storage: window.sessionStorage, key: `smart-notes:new-note:${diaryDate ?? 'ordinary'}` }
    } catch { /* Saving to the API still works without browser storage. */ }
    return new NoteAutosave({ title: initialTitle, content: initialContent, category: initialCategory || '未分类' },
      async (draft, id, draftId) => {
        const saved = await onSaveRef.current(draft.title, draft.content, draft.category, id, draftId)
        if (!saved?.id) throw new Error('笔记保存未完成，请重试。')
        return saved
      }, recovery)
  })
  const autosaveState = useSyncExternalStore(
    autosave?.subscribe ?? (() => () => {}),
    autosave?.getSnapshot ?? (() => null),
    () => null,
  )
  const [title, setTitle] = useState(() => autosave?.getDraft().title ?? initialTitle)
  const [content, setContent] = useState(() => autosave?.getDraft().content ?? initialContent)
  const [category, setCategory] = useState(() => autosave?.getDraft().category ?? initialCategory)
  const [newCategory, setNewCategory] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [composing, setComposing] = useState(false)
  const [autosaveReady, setAutosaveReady] = useState(!autosave)
  const savingRef = useRef(false)
  const autosaveFlushRef = useRef<FlushNoteDraft | null>(null)
  const categoryOptions = Array.from(new Set([...categories, initialCategory, category].filter(Boolean)))
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const currentDraftRef = useRef({ title, content, category })
  currentDraftRef.current = { title, content, category: showNewCategory ? newCategory.trim() || category : category }
  const pausedRef = useRef(composing || uploading)
  pausedRef.current = composing || uploading
  // 右键时先捕获选区，之后焦点移到菜单也不会丢失
  const selRef = useRef({ start: 0, end: 0 })

  useEffect(() => {
    if (!autosave) return
    const recovered = autosave.restoreRecovery()
    setTitle(recovered.title)
    setContent(recovered.content)
    setCategory(recovered.category)
    setAutosaveReady(true)
  }, [autosave])

  useEffect(() => {
    if (!autosave || !autosaveReady) return
    autosave.setPaused(composing || uploading)
    autosave.update({ title, content, category: showNewCategory ? newCategory.trim() || category : category })
  }, [autosave, autosaveReady, title, content, category, showNewCategory, newCategory, composing, uploading])

  useEffect(() => {
    if (!autosave || !autosaveReady) return
    const flush: FlushNoteDraft = async leaving => {
      // Navigation/pagehide can happen before the input's effect runs.
      autosave.setPaused(pausedRef.current)
      autosave.update(currentDraftRef.current)
      if (pausedRef.current) return false
      const saved = await autosave.flush()
      if (saved && leaving) autosave.forgetRecovery()
      return saved
    }
    autosaveFlushRef.current = flush
    onAutosaveReady?.(flush)
    const save = () => { void flush() }
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') save() }
    const onSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (event.isComposing || event.repeat) return
      save()
    }
    window.addEventListener('pagehide', save)
    window.addEventListener('online', save)
    window.addEventListener('keydown', onSaveShortcut)
    document.addEventListener('visibilitychange', onVisibilityChange)
    // Recover an interrupted draft without creating another note after its first save.
    if (autosave.getSnapshot().status === 'pending') void autosave.flush()
    return () => {
      autosaveFlushRef.current = null
      onAutosaveReady?.(null)
      window.removeEventListener('pagehide', save)
      window.removeEventListener('online', save)
      window.removeEventListener('keydown', onSaveShortcut)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void flush()
    }
  }, [autosave, autosaveReady, onAutosaveReady])

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
    autosave?.setPaused(true)
    setUploading(true)
    try {
      for (const file of files) {
        const md = await uploadImageAsMarkdown(file)
        insertAtCursor(`\n${md}\n`)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '图片上传失败')
    } finally {
      autosave?.setPaused(composing)
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
      autosave?.setPaused(true)
      setUploading(true)
      try {
        const mds: string[] = []
        for (const file of images) mds.push(await uploadImageAsMarkdown(file))
        replaceRange(start, end, `\n${mds.join('\n')}\n`)
      } catch (err) {
        alert(err instanceof Error ? err.message : '图片粘贴失败')
      } finally {
        autosave?.setPaused(composing)
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
    if (savingRef.current || uploading || composing || (autoSave && !autosaveReady)) return
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
    if (onBeginAction && !onBeginAction()) return
    savingRef.current = true
    setSaving(true)
    setMenu(null)
    try {
      if (autosave) {
        // Manual and automatic saves share the same queue and note id.
        if (!await autosaveFlushRef.current?.(true)) return
        const noteId = autosave.getNoteId()
        if (noteId) onSaved?.(noteId)
      } else {
        await onSave(title.trim(), content.trim(), finalCategory)
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '笔记保存失败，请稍后重试。')
    } finally {
      savingRef.current = false
      setSaving(false)
      onEndAction?.()
    }
  }

  const handleCancel = async () => {
    if (!autosave) {
      onCancel()
      return
    }
    if (savingRef.current || pausedRef.current || !autosaveReady) return
    if (onBeginAction && !onBeginAction()) return
    savingRef.current = true
    setSaving(true)
    setMenu(null)
    try {
      // Leave the editor without discarding content already being autosaved.
      if (await autosaveFlushRef.current?.(true)) onCancel()
    } finally {
      savingRef.current = false
      setSaving(false)
      onEndAction?.()
    }
  }

  return (
    <div className="fv-secondary fv-editor flex-1 flex flex-col overflow-hidden" aria-busy={saving || autosaveState?.status === 'saving'}>
      <div className="fv-section-bar p-2 bg-[#d4d0c8] border-b border-[#808080] text-[11px] font-bold">
        {diaryDate ? (isEditing ? '编辑日记' : '写日记') : (isEditing ? '编辑笔记' : '新建笔记')}
      </div>
      
      <fieldset disabled={saving} onCompositionStartCapture={() => { autosave?.setPaused(true); setComposing(true) }} onCompositionEndCapture={() => setComposing(false)} className="fv-workspace flex-1 min-w-0 flex flex-col p-2 gap-2 border-0 bg-[#ece9d8] overflow-auto">
        {diaryDate && (
          <div className="fv-diary-banner win-inset bg-[#fff5fa] px-3 py-2 text-[11px] text-[#80405f]">
            日记日期：<time dateTime={diaryDate} className="font-bold">{diaryDate}</time>
            <span className="ml-2 text-[10px]">{autoSave ? '自动保存到这一天' : '保存后归入这一天'}</span>
          </div>
        )}
        {/* 标题输入 */}
        <div className="flex items-center gap-2">
          <label className="fv-field-label text-[11px] w-16">标题：</label>
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
          <label className="fv-field-label text-[11px] w-16">分类：</label>
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
        <textarea
          ref={textareaRef}
          aria-label="内容"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onContextMenu={openMenu}
          className="fv-editor-paper flex-1 min-w-0 p-2 text-[12px] win-input resize-none font-mono leading-relaxed min-h-[300px]"
          placeholder="输入笔记内容...（右键可选中/复制/粘贴）"
        />
        
        {saveError && <p role="alert" className="fv-error text-[11px] text-[#a00000]">{saveError}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 text-[11px]">
          {autoSave && <span role={autosaveState?.status === 'error' ? 'alert' : 'status'} className={`mr-auto ${autosaveState?.status === 'error' ? 'fv-error text-[#a00000]' : 'fv-muted text-[#606060]'}`}>
            {uploading ? '图片上传中…' : autosaveState?.status === 'saved' ? '已保存' :
              autosaveState?.status === 'saving' ? '保存中…' : autosaveState?.status === 'pending' ? '等待保存…' :
              autosaveState?.status === 'error' ? autosaveState.error : '输入后自动保存'}
          </span>}
          {autosaveState?.status === 'error' && <button type="button" className="win-button text-[11px] px-2" onClick={() => { void autosaveFlushRef.current?.() }}>重试保存</button>}
          <button type="button" onClick={() => { void handleCancel() }} disabled={saving || (autoSave && (uploading || composing || !autosaveReady))} className="win-button shrink-0 text-[11px] px-4 py-1">
            取消
          </button>
          <button type="button" onClick={() => { void handleSave() }} disabled={saving || uploading || composing || (autoSave && !autosaveReady)} className="fv-primary-action win-button shrink-0 text-[11px] px-4 py-1">
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
