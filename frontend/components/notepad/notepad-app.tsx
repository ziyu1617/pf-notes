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
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [calendarDate, setCalendarDate] = useState<string | undefined>()
  const [draftDiaryDate, setDraftDiaryDate] = useState<string | null>(null)
  const [noteOrigin, setNoteOrigin] = useState<'list' | 'calendar'>('list')
  
  const windowRef = useRef<HTMLDivElement>(null)

  // 处理菜单操作 - 直接切换视图
  const handleMenuAction = useCallback((action: string) => {
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
      setDraftDiaryDate(null)
      setNoteOrigin('list')
      setCurrentView(viewMap[action])
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

  const handleOpenCalendarNote = (note: Note) => {
    setCalendarDate(getNoteDate(note))
    setDraftDiaryDate(null)
    setNoteOrigin('calendar')
    setSelectedNote(note)
    setCurrentView('view')
  }

  const handleCreateDiary = (date: string) => {
    setCalendarDate(date)
    setDraftDiaryDate(date)
    setNoteOrigin('calendar')
    setSelectedNote(null)
    setCurrentView('new')
  }

  // 保存新笔记
  const handleSaveNewNote = async (title: string, content: string, category: string) => {
    const newNote = await addNote({ title, content, category, ...(draftDiaryDate ? { diaryDate: draftDiaryDate } : {}) })
    setDraftDiaryDate(null)
    setSelectedNote(newNote)
    setCurrentView('view')
  }

  // 保存编辑的笔记
  const handleSaveEditedNote = async (noteId: string, title: string, content: string, category: string) => {
    const updated = await updateNote(noteId, { title, content, category })
    setSelectedNote(updated ?? null)
    setCurrentView('view')
  }

  // 删除笔记
  const handleDeleteNote = async (id: string) => {
    await deleteNote(id)
    if (selectedNote?.id === id) {
      setSelectedNote(null)
    }
    setCurrentView(noteOrigin)
  }

  // 退出确认
  const handleExitConfirm = () => {
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
        <MenuBar onAction={handleMenuAction} currentView={currentView} />
        
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

          {currentView === 'list' && (
            <DirectoryView
              notesByDate={getNotesByDate()}
              notesByCategory={getNotesByCategory}
              categories={categories}
              onSelectNote={handleOpenNote}
            />
          )}
          
          {currentView === 'new' && (
            <NoteEditor
              key={draftDiaryDate ?? 'new-note'}
              initialCategory={draftDiaryDate ? '日记' : ''}
              diaryDate={draftDiaryDate ?? undefined}
              categories={categories}
              onSave={handleSaveNewNote}
              onCancel={() => { setDraftDiaryDate(null); setCurrentView(noteOrigin) }}
            />
          )}
          
          {currentView === 'view' && selectedNote && (
            <NoteViewer
              note={selectedNote}
              onEdit={() => setCurrentView('edit')}
              onDelete={() => setCurrentView('delete')}
              onBack={() => setCurrentView(noteOrigin)}
              backLabel={noteOrigin === 'calendar' ? '返回日历' : undefined}
            />
          )}
          
          {currentView === 'edit' && selectedNote && (
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
              onCancel={() => setCurrentView('view')}
              isEditing
            />
          )}
          
          {currentView === 'search' && (
            <SearchView
              onSearch={searchNotes}
              onSelectNote={handleSelectNote}
              onViewNote={handleOpenNote}
            />
          )}
          
          {currentView === 'delete' && selectedNote && (
            <DeleteView
              note={selectedNote}
              onDelete={handleDeleteNote}
              onCancel={() => setCurrentView(noteOrigin)}
            />
          )}
          
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
