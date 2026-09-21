"use client"

import { useDeferredValue, useState } from 'react'
import { Search, NotebookPen } from 'lucide-react'
import { Note } from '@/hooks/use-notes'
import { stripImageMarkdown } from '@/lib/images'

interface SearchViewProps {
  onSearch: (query: string) => Note[]
  onSelectNote: (note: Note) => void
  onViewNote: (note: Note) => void
}

export function SearchView({ onSearch, onSelectNote, onViewNote }: SearchViewProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const results = deferredQuery ? onSearch(deferredQuery) : []
  const highlight = (text: string) => {
    if (!deferredQuery) return text
    const escaped = deferredQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text.split(new RegExp(`(${escaped})`, 'gi')).map((part, index) => part.toLowerCase() === deferredQuery.toLowerCase() ? <mark key={index}>{part}</mark> : part)
  }

  return (
    <section className="search-page glass-card">
      <label className="search-field"><Search size={18} strokeWidth={1.5} /><input aria-label="搜索关键词" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、内容或分类…" autoFocus /></label>
      <div className="glass-muted text-xs" role="status">{deferredQuery ? `找到 ${results.length} 篇笔记` : '有些记忆，只需要一个关键词。'}</div>
      <div className="search-results">
        {results.map(note => (
          <button key={note.id} className="search-result" onClick={() => { onSelectNote(note); onViewNote(note) }}>
            <h3>{highlight(note.title)}</h3>
            <span className="glass-chip mb-2">{note.category}</span>
            <p>{highlight(stripImageMarkdown(note.content).slice(0, 180))}</p>
          </button>
        ))}
        {results.length === 0 && <div className="flex flex-col items-center py-16 text-center glass-muted"><NotebookPen size={30} strokeWidth={1} className="mb-4 opacity-50" /><p className="text-sm">{deferredQuery ? '还没有找到，换个词试试？' : '写过的片刻，都在这里。'}</p></div>}
      </div>
    </section>
  )
}
