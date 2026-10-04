"use client"

import { useEffect, useRef, type ReactNode } from 'react'
import { compareNotesByDateDescending, type Note } from '@/hooks/use-notes'

interface DirectoryViewProps {
  notesByCategory: (category: string) => Note[]
  categories: string[]
  selectedNote: Note | null
  onSelectNote: (note: Note) => void
  selectionDisabled?: boolean
  children: ReactNode
}

export function DirectoryView({ 
  notesByCategory, 
  categories, 
  selectedNote,
  onSelectNote,
  selectionDisabled = false,
  children,
}: DirectoryViewProps) {
  const selectedNoteRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedNoteRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  }, [selectedNote?.id, selectedNote?.category])

  return (
    <div className="fv-secondary fv-directory min-h-0 flex-1 flex overflow-hidden">
      {/* 左侧分类列表 */}
      <nav aria-label="分类目录" className="fv-directory-sidebar w-36 shrink-0 border-r border-[#808080] bg-white win-inset overflow-auto sm:w-48">
        <div className="fv-section-bar p-2 bg-[#d4d0c8] border-b border-[#808080] text-[11px] font-bold">
          📁 分类目录
        </div>
        <div className="p-1">
          {categories.map(category => (
            <div key={category} className="mb-2">
              <div className="fv-directory-category text-[11px] font-bold px-2 py-1 bg-[#d4d0c8]">
                📂 {category}
              </div>
              <div className="pl-2">
                {notesByCategory(category).slice().sort(compareNotesByDateDescending).map(note => (
                  <button
                    key={note.id}
                    ref={selectedNote?.id === note.id ? selectedNoteRef : undefined}
                    onClick={() => onSelectNote(note)}
                    aria-current={selectedNote?.id === note.id ? 'page' : undefined}
                    disabled={selectionDisabled}
                    title={note.title}
                    className={`fv-directory-link w-full text-left text-[11px] px-2 py-0.5 hover:bg-[#000080] hover:text-white truncate disabled:cursor-default ${selectedNote?.id === note.id ? 'bg-[#000080] text-white' : ''}`}
                  >
                    📄 {note.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      
      {/* 只切换右侧阅读区，保留左侧目录与滚动位置。 */}
      <section aria-label="笔记内容" className="fv-directory-reader min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden">
        {children || (
          <div className="fv-muted p-4 text-center text-[11px] text-[#808080]">
            暂无笔记，请点击 [3] 新建笔记 创建
          </div>
        )}
      </section>
    </div>
  )
}
