"use client"

import { useState, useEffect, useCallback } from 'react'
import { Search, PanelLeft, Plus, Leaf, LogOut, LockKeyhole } from 'lucide-react'
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
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
      'search': 'search',
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
      'view': '阅读笔记',
      'edit': '编辑笔记',
      'search': '搜索笔记',
      'delete': '删除笔记',
      'strawberry': '草莓',
    }
    return titles[currentView]
  }

  const subtitles: Record<ViewType, string> = {
    calendar: '让计划有序，让日常有迹可循。',
    list: '一些想法，一些日常，慢慢写成自己的故事。',
    new: '从一个念头开始，留住此刻。',
    view: '回到文字里，也回到自己。',
    edit: '再添一笔，让记忆更完整。',
    search: '找回那些写下过的片刻。',
    delete: '给你的笔记留一点整理的空间。',
    strawberry: '不必想好怎么说，我都愿意听。',
  }
  const headerDate = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  if (!isLoaded) {
    return <div className="app-scene"><div className="app-loading"><div className="app-loading-orb" />正在打开你的空间…</div></div>
  }

  return (
    <div className="app-scene">
      <div className="app-window" data-collapsed={sidebarCollapsed}>
        <aside className="app-sidebar">
          <TitleBar title="记事本 · Smart Notes" />
          <div className="app-nav-label">你的空间</div>
          <MenuBar onAction={handleMenuAction} currentView={currentView} />
          <div className="app-sidebar-bottom">
            <div className="app-sidebar-note">
              <Leaf size={17} strokeWidth={1.3} className="mb-2" />
              <p>把生活写下来，<br />也把自己找回来。</p>
              <div className="app-local"><span className="app-local-dot" />只保存在本机</div>
            </div>
            <button className="glass-button app-sidebar-new" onClick={() => handleMenuAction('new')}><Plus size={14} />记录此刻</button>
          </div>
        </aside>
        <main className="app-main">
          <div className="app-topbar">
            <div className="app-topbar-left">
              <button className="glass-icon-button app-quiet-button app-collapse-button" aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(value => !value)}><PanelLeft size={17} strokeWidth={1.5} /></button>
              <span className="app-topbar-date">{headerDate}</span>
            </div>
            <div className="app-topbar-right">
              <button className="app-search-shortcut" onClick={() => handleMenuAction('search')} aria-label="搜索笔记"><Search size={13} /><span>搜索你的笔记</span></button>
              <div className="app-avatar" aria-label="我的本地空间">我</div>
              <button className="glass-icon-button app-quiet-button" onClick={() => setShowExitDialog(true)} aria-label="退出记事本"><LogOut size={14} /></button>
            </div>
          </div>
          <header className="app-page-heading">
            <div><h1>{getViewTitle()}</h1><p>{subtitles[currentView]}</p></div>
            {(currentView === 'list' || currentView === 'search') && <button className="glass-button app-heading-action" onClick={() => handleMenuAction('new')}><Plus size={14} />新建笔记</button>}
          </header>
          <div className="app-content">
            <div className="app-view" key={currentView}>
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
          </div>
          <footer className="app-footer"><span><LockKeyhole size={10} />本地空间 · {notes.length} 篇笔记</span><span className="app-footer-secondary">慢一点，也很好。</span></footer>
        </main>
      </div>
      {showExitDialog && <ExitDialog onConfirm={handleExitConfirm} onCancel={() => setShowExitDialog(false)} />}
    </div>
  )
}
