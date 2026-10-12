"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNotes, getNoteDate, type Note } from '@/hooks/use-notes'
import { TitleBar } from './title-bar'
import { MenuBar } from './menu-bar'
import { DirectoryView } from './directory-view'
import { CalendarView } from './calendar-view'
import { NoteEditor } from './note-editor'
import { NoteViewer } from './note-viewer'
import { SearchView } from './search-view'
import { DeleteView } from './delete-view'
import { StrawberryChatView } from './strawberry-chat-view'
import { ExitDialog } from './exit-dialog'
import { saveAllStickyDrafts } from '@/lib/sticky-notes'
import type { FlushNoteDraft } from '@/lib/note-autosave'

// 视图类型
type ViewType = 'calendar' | 'list' | 'new' | 'view' | 'edit' | 'search' | 'delete' | 'strawberry'

export function NotepadApp() {
  const {
    notes,
    isLoaded,
    addNote,
    updateNote,
    deleteNote,
    categories,
    getNotesByCategory,
    getNotesByDate,
    searchNotes,
  } = useNotes()

  // 当前视图
  const [currentView, setCurrentView] = useState<ViewType>('calendar')
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [directoryNoteId, setDirectoryNoteId] = useState<string | null>(null)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [calendarDate, setCalendarDate] = useState<string | undefined>()
  const [draftDiaryDate, setDraftDiaryDate] = useState<string | null>(null)
  const [noteOrigin, setNoteOrigin] = useState<'list' | 'calendar' | 'directory'>('list')
  
  const windowRef = useRef<HTMLDivElement>(null)
  const newNoteFlushRef = useRef<FlushNoteDraft | null>(null)
  const navigationPendingRef = useRef(false)
  const [newNoteSession, setNewNoteSession] = useState(0)
  const registerNewNoteAutosave = useCallback((flush: FlushNoteDraft | null) => {
    newNoteFlushRef.current = flush
  }, [])

  useEffect(() => {
    window.smartNotesFlushSticky = async () => {
      if (!await saveAllStickyDrafts()) return false
      return newNoteFlushRef.current ? newNoteFlushRef.current() : true
    }
    return () => { delete window.smartNotesFlushSticky }
  }, [])

  // Leave a new-note draft only after its latest input is saved.
  const handleMenuAction = useCallback(async (action: string) => {
    if (action === 'exit') {
      setShowExitDialog(true)
      return
    }
    
    const viewMap: Record<string, ViewType> = {
      'calendar': 'calendar',
      'list': 'list',
      'new': 'new',
      'strawberry': 'strawberry',
    }
    
    if (viewMap[action]) {
      if (navigationPendingRef.current) return
      navigationPendingRef.current = true
      try {
        if (newNoteFlushRef.current && !await newNoteFlushRef.current(true)) return
        if (action === 'new') setNewNoteSession(session => session + 1)
        setDraftDiaryDate(null)
        setNoteOrigin('list')
        setCurrentView(viewMap[action])
      } finally {
        navigationPendingRef.current = false
      }
    }
  }, [])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
        return
      }
      if (e.target instanceof Element && (
        e.target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="checkbox"], [role="dialog"]') ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      )) {
        return
      }
      
      const keyMap: Record<string, string> = {
        '1': 'calendar',
        '2': 'list',
        '3': 'new',
        '4': 'strawberry',
      }
      
      if (keyMap[e.key]) {
        e.preventDefault()
        handleMenuAction(keyMap[e.key])
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleMenuAction])

  // 选择笔记
  const handleSelectNote = (note: Note) => {
    setSelectedNote(note)
  }

  // 打开查看笔记
  const handleOpenNote = (note: Note) => {
    setDraftDiaryDate(null)
    setNoteOrigin('list')
    setSelectedNote(note)
    setCurrentView('view')
  }

  const handleSelectDirectoryNote = (note: Note) => {
    setDirectoryNoteId(note.id)
    setSelectedNote(note)
    setDraftDiaryDate(null)
    setNoteOrigin('directory')
    setCurrentView('list')
  }

  const handleOpenCalendarNote = (note: Note) => {
    setCalendarDate(getNoteDate(note))
    handleSelectDirectoryNote(note)
  }

  const handleCreateDiary = (date: string) => {
    setCalendarDate(date)
    setDraftDiaryDate(date)
    setNoteOrigin('calendar')
    setSelectedNote(null)
    setCurrentView('new')
  }

  // Autosave creates once, then updates that note while the editor stays open.
  const handleSaveNewNote = async (title: string, content: string, category: string, noteId?: string | null, draftId?: string) => {
    const newNote = noteId ? await updateNote(noteId, { title, content, category }) :
      await addNote({ title, content, category, draftId, ...(draftDiaryDate ? { diaryDate: draftDiaryDate } : {}) })
    setSelectedNote(newNote)
    return newNote
  }

  // 保存编辑的笔记
  const handleSaveEditedNote = async (noteId: string, title: string, content: string, category: string) => {
    const updated = await updateNote(noteId, { title, content, category })
    setSelectedNote(updated ?? null)
    if (noteOrigin === 'directory') {
      setDirectoryNoteId(updated?.id ?? null)
      setCurrentView('list')
    } else {
      setCurrentView('view')
    }
  }

  // 删除笔记
  const handleDeleteNote = async (id: string) => {
    await deleteNote(id)
    if (selectedNote?.id === id) {
      setSelectedNote(null)
    }
    if (directoryNoteId === id) {
      setDirectoryNoteId(null)
    }
    setCurrentView(noteOrigin === 'calendar' ? 'calendar' : 'list')
  }

  // 退出确认
  const handleExitConfirm = async () => {
    if (newNoteFlushRef.current && !await newNoteFlushRef.current()) {
      setShowExitDialog(false)
      return
    }
    setShowExitDialog(false)
    alert('感谢使用！您的笔记已保存。刷新页面可重新打开应用。')
  }

  if (!isLoaded) {
    return (
      <div className="glass-desktop min-h-screen bg-[#008080] flex items-center justify-center">
        <div className="bg-[#d4d0c8] p-4 win-border text-[12px]">
          正在加载...
        </div>
      </div>
    )
  }

  const originView = noteOrigin === 'calendar' ? 'calendar' : 'list'
  const showDirectory = currentView === 'list' || (
    noteOrigin === 'directory' && (currentView === 'edit' || currentView === 'delete')
  )
  const directoryNote = notes.find(note => note.id === directoryNoteId) ??
    Object.values(getNotesByDate())[0]?.[0] ?? null

  const handleDirectoryAction = (view: 'edit' | 'delete') => {
    if (!directoryNote) return
    setDirectoryNoteId(directoryNote.id)
    setSelectedNote(directoryNote)
    setNoteOrigin('directory')
    setCurrentView(view)
  }

  const editView = selectedNote && (
    <NoteEditor
      key={selectedNote.id}
      diaryDate={selectedNote.diaryDate ?? undefined}
      initialTitle={selectedNote.title}
      initialContent={selectedNote.content}
      initialCategory={selectedNote.category}
      categories={categories}
      onSave={(title, content, category) =>
        handleSaveEditedNote(selectedNote.id, title, content, category)
      }
      onCancel={() => setCurrentView(noteOrigin === 'directory' ? 'list' : 'view')}
      isEditing
    />
  )

  const deleteView = selectedNote && (
    <DeleteView
      note={selectedNote}
      onDelete={handleDeleteNote}
      onCancel={() => setCurrentView(originView)}
    />
  )

  return (
    <div className="glass-desktop h-screen w-screen bg-[#008080] flex flex-col overflow-hidden">
      {/* 主窗口 - 铺满整个原生窗口 */}
      <div
        ref={windowRef}
        className="glass-window bg-[#d4d0c8] flex flex-col win-border relative select-none flex-1 min-h-0"
      >

        {/* 标题栏 */}
        <TitleBar 
          title="记事本 - 本地笔记应用" 
          onClose={() => setShowExitDialog(true)}
        />
        
        {/* 菜单栏 - 4 个主要功能按钮 */}
        <MenuBar onAction={handleMenuAction} currentView={showDirectory ? 'list' : currentView} />
        
        {/* 内容区域 */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {currentView === 'calendar' && (
            <CalendarView
              notes={notes}
              initialDate={calendarDate}
              onDateChange={setCalendarDate}
              onCreateDiary={handleCreateDiary}
              onOpenNote={handleOpenCalendarNote}
            />
          )}

          {showDirectory && (
            <DirectoryView
              notesByCategory={getNotesByCategory}
              categories={categories}
              selectedNote={directoryNote}
              onSelectNote={handleSelectDirectoryNote}
              selectionDisabled={currentView !== 'list'}
            >
              {currentView === 'edit' ? editView : currentView === 'delete' ? deleteView : directoryNote && (
                <NoteViewer
                  key={directoryNote.id}
                  note={directoryNote}
                  onEdit={() => handleDirectoryAction('edit')}
                  onDelete={() => handleDirectoryAction('delete')}
                />
              )}
            </DirectoryView>
          )}
          
          {currentView === 'new' && (
            <NoteEditor
              key={`${draftDiaryDate ?? 'new-note'}:${newNoteSession}`}
              initialCategory={draftDiaryDate ? '日记' : '未分类'}
              diaryDate={draftDiaryDate ?? undefined}
              categories={categories}
              onSave={handleSaveNewNote}
              onSaved={(noteId) => {
                // A recovered, already-saved draft need not issue a new request.
                setSelectedNote(current => current?.id === noteId ? current : notes.find(note => note.id === noteId) ?? null)
                setDraftDiaryDate(null)
                setCurrentView('view')
              }}
              onBeginAction={() => {
                if (navigationPendingRef.current) return false
                navigationPendingRef.current = true
                return true
              }}
              onEndAction={() => { navigationPendingRef.current = false }}
              onCancel={() => { setDraftDiaryDate(null); setCurrentView(originView) }}
              autoSave
              onAutosaveReady={registerNewNoteAutosave}
            />
          )}
          
          {currentView === 'view' && selectedNote && (
            <NoteViewer
              note={selectedNote}
              onEdit={() => setCurrentView('edit')}
              onDelete={() => setCurrentView('delete')}
              onBack={() => setCurrentView(originView)}
              backLabel={noteOrigin === 'calendar' ? '返回日历' : undefined}
            />
          )}
          
          {currentView === 'edit' && !showDirectory && editView}
          
          {currentView === 'search' && (
            <SearchView
              onSearch={searchNotes}
              onSelectNote={handleSelectNote}
              onViewNote={handleOpenNote}
            />
          )}
          
          {currentView === 'delete' && !showDirectory && deleteView}
          
          {currentView === 'strawberry' && (
            <StrawberryChatView />
          )}
        </div>
        
        {/* 底部状态栏 */}
        <div className="glass-statusbar h-6 bg-[#d4d0c8] border-t border-[#808080] flex items-center px-2 text-[10px] shrink-0">
          <div className="flex-1 win-inset px-2 py-0.5 mr-1">
            笔记总数: {notes.length} | 分类: {categories.length}
          </div>
          <div className="w-24 win-inset px-2 py-0.5 mr-1">
            API 模式
          </div>
          <div className="w-28 win-inset px-2 py-0.5 mr-1">
            实时同步
          </div>
          <div className="w-32 win-inset px-2 py-0.5">
            桌面版
          </div>
        </div>
      </div>
      
      {/* 退出确认对话框 */}
      {showExitDialog && (
        <ExitDialog
          onConfirm={handleExitConfirm}
          onCancel={() => setShowExitDialog(false)}
        />
      )}
    </div>
  )
}
