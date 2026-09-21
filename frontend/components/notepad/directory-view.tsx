"use client"

import { Note } from '@/hooks/use-notes'
import { stripImageMarkdown } from '@/lib/images'

interface DirectoryViewProps {
  notesByDate: Record<string, Note[]>
  notesByCategory: (category: string) => Note[]
  categories: string[]
  onSelectNote: (note: Note) => void
}

export function DirectoryView({ 
  notesByDate, 
  notesByCategory, 
  categories, 
  onSelectNote 
}: DirectoryViewProps) {
  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左侧分类列表 */}
      <div className="w-36 shrink-0 border-r border-[#808080] bg-white win-inset overflow-auto sm:w-48">
        <div className="p-2 bg-[#d4d0c8] border-b border-[#808080] text-[11px] font-bold">
          📁 分类目录
        </div>
        <div className="p-1">
          {categories.map(category => (
            <div key={category} className="mb-2">
              <div className="text-[11px] font-bold px-2 py-1 bg-[#d4d0c8]">
                📂 {category}
              </div>
              <div className="pl-2">
                {notesByCategory(category).map(note => (
                  <button
                    key={note.id}
                    onClick={() => onSelectNote(note)}
                    className="w-full text-left text-[11px] px-2 py-0.5 hover:bg-[#000080] hover:text-white truncate"
                  >
                    📄 {note.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* 右侧时间线 */}
      <div className="min-w-0 flex-1 bg-white win-inset overflow-auto">
        <div className="p-2 bg-[#d4d0c8] border-b border-[#808080] text-[11px] font-bold">
          📅 按时间查看
        </div>
        <div className="p-2">
          {Object.keys(notesByDate).length === 0 && (
            <div className="p-4 text-center text-[11px] text-[#808080]">
              暂无笔记，请点击 [3] 新建笔记 创建
            </div>
          )}
          {Object.entries(notesByDate).map(([date, notes]) => (
            <div key={date} className="mb-3">
              <div className="text-[11px] font-bold px-2 py-1 bg-[#ece9d8] border border-[#808080] mb-1">
                📅 {date}
              </div>
              <div className="pl-2 space-y-1">
                {notes.map(note => (
                  <button
                    key={note.id}
                    onClick={() => onSelectNote(note)}
                    className="w-full text-left text-[11px] p-2 border border-[#d4d0c8] hover:bg-[#000080] hover:text-white hover:border-[#000080]"
                  >
                    <div className="font-bold">📄 {note.title}</div>
                    <div className="text-[10px] opacity-70 truncate mt-0.5">
                      [{note.category}] {stripImageMarkdown(note.content).substring(0, 50)}...
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
