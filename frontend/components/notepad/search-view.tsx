"use client"

import { useState } from 'react'
import { Note } from '@/hooks/use-notes'

interface SearchViewProps {
  onSearch: (query: string) => Note[]
  onSelectNote: (note: Note) => void
  onViewNote: (note: Note) => void
}

export function SearchView({ onSearch, onSelectNote, onViewNote }: SearchViewProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Note[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  const handleSearch = () => {
    if (!query.trim()) {
      alert('请输入搜索关键词！')
      return
    }
    const found = onSearch(query.trim())
    setResults(found)
    setHasSearched(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN')
  }

  const highlightText = (text: string, query: string) => {
    if (!query) return text
    const regex = new RegExp(`(${query})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) => 
      regex.test(part) ? (
        <span key={i} className="bg-yellow-300 text-black">{part}</span>
      ) : part
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 搜索框 */}
      <div className="p-2 bg-[#ece9d8] border-b border-[#808080] flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 p-1 text-[12px] win-input"
          placeholder="输入关键词搜索标题、内容或分类..."
          autoFocus
        />
        <button onClick={handleSearch} className="win-button text-[11px] px-4">
          搜索
        </button>
      </div>
      
      {/* 搜索结果 */}
      <div className="flex-1 bg-white win-inset overflow-auto">
        {!hasSearched ? (
          <div className="p-4 text-center text-[11px] text-[#808080]">
            输入关键词后点击搜索按钮或按 Enter 键开始搜索
          </div>
        ) : results.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-[#808080]">
            未找到包含 "{query}" 的笔记
          </div>
        ) : (
          <div className="p-2">
            <div className="text-[11px] mb-2 text-[#404040]">
              找到 {results.length} 条结果：
            </div>
            {results.map(note => (
              <div
                key={note.id}
                onClick={() => onSelectNote(note)}
                onDoubleClick={() => onViewNote(note)}
                className="p-2 mb-2 border border-[#d4d0c8] hover:bg-[#ece9d8] cursor-pointer"
              >
                <div className="text-[12px] font-bold">
                  📄 {highlightText(note.title, query)}
                </div>
                <div className="text-[10px] text-[#404040] mt-1">
                  [{note.category}] | {formatDate(note.createdAt)}
                </div>
                <div className="text-[11px] mt-1 text-[#404040] line-clamp-2">
                  {highlightText(note.content.substring(0, 150), query)}
                  {note.content.length > 150 && '...'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* 状态栏 */}
      <div className="p-1 bg-[#d4d0c8] border-t border-[#808080] text-[10px]">
        {hasSearched && `双击搜索结果打开笔记 | 当前结果: ${results.length} 条`}
      </div>
    </div>
  )
}
