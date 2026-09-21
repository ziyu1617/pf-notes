"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNotes, Note } from '@/hooks/use-notes'
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
  const [currentView, setCurrentView] = useState<ViewType>('list')
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [showExitDialog, setShowExitDialog] = useState(false)
  
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
    setSelectedNote(note)
    setCurrentView('view')
  }

  // 保存新笔记
  const handleSaveNewNote = async (title: string, content: string, category: string) => {
    const newNote = await addNote({ title, content, category })
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
    setCurrentView('list')
  }

  // 退出确认
  const handleExitConfirm = () => {
    setShowExitDialog(false)
    alert('感谢使用！您的笔记已保存。刷新页面可重新打开应用。')
  }

  // 获取视图标题
  const getViewTitle = () => {
    const titles: Record<ViewType, string> = {
      'calendar': '日历',
      'list': '所有笔记',
      'new': '新建笔记',
      'view': selectedNote ? `查看: ${selectedNote.title}` : '查看笔记',
      'edit': selectedNote ? `编辑: ${selectedNote.title}` : '编辑笔记',
      'search': '搜索笔记',
      'delete': '删除笔记',
      'strawberry': '🍓 草莓',
    }
    return titles[currentView]
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#008080] flex items-center justify-center">
        <div className="bg-[#d4d0c8] p-4 win-border text-[12px]">
          正在加载...
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen bg-[#008080] flex flex-col overflow-hidden">
      {/* 主窗口 - 铺满整个原生窗口 */}
      <div
        ref={windowRef}
        className="bg-[#d4d0c8] flex flex-col win-border relative select-none flex-1 min-h-0"
      >

        {/* 标题栏 */}
        <TitleBar 
          title="记事本 - 本地笔记应用" 
          onClose={() => setShowExitDialog(true)}
        />
        
        {/* 菜单栏 - 4 个主要功能按钮 */}
        <MenuBar onAction={handleMenuAction} currentView={currentView} />
        
        {/* 当前视图标题栏 */}
        <div className="px-3 py-2 bg-[#ece9d8] border-b border-[#808080] flex items-center justify-between">
          <span className="text-[12px] font-bold">{getViewTitle()}</span>
          {selectedNote && currentView !== 'list' && currentView !== 'calendar' && currentView !== 'new' && currentView !== 'strawberry' && (
            <span className="text-[10px] text-[#808080]">
              当前笔记: {selectedNote.title} [{selectedNote.category}]
            </span>
          )}
        </div>
        
        {/* 内容区域 */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {currentView === 'calendar' && <CalendarView notes={notes} />}

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
              categories={categories}
              onSave={handleSaveNewNote}
              onCancel={() => setCurrentView('list')}
            />
          )}
          
          {currentView === 'view' && selectedNote && (
            <NoteViewer
              note={selectedNote}
              onEdit={() => setCurrentView('edit')}
              onDelete={() => setCurrentView('delete')}
              onBack={() => setCurrentView('list')}
            />
          )}
          
          {currentView === 'edit' && selectedNote && (
            <NoteEditor
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
              onCancel={() => setCurrentView('list')}
            />
          )}
          
          {currentView === 'strawberry' && (
            <StrawberryChatView />
          )}
        </div>
        
        {/* 底部状态栏 */}
        <div className="h-6 bg-[#d4d0c8] border-t border-[#808080] flex items-center px-2 text-[10px] shrink-0">
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
