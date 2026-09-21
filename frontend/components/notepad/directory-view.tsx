"use client"

import { useState } from 'react'
import { ArrowUpRight, BookOpen, CalendarDays, FileText, Layers3 } from 'lucide-react'
import { Note } from '@/hooks/use-notes'
import { stripImageMarkdown } from '@/lib/images'

interface DirectoryViewProps {
  notesByDate: Record<string, Note[]>
  notesByCategory: (category: string) => Note[]
  categories: string[]
  onSelectNote: (note: Note) => void
}

export function DirectoryView({ notesByDate, notesByCategory, categories, onSelectNote }: DirectoryViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const activeCategory = selectedCategory && categories.includes(selectedCategory) ? selectedCategory : null
  const totalNotes = Object.values(notesByDate).reduce((total, notes) => total + notes.length, 0)
  const groups = Object.entries(notesByDate)
    .map(([date, notes]) => [date, activeCategory ? notes.filter(note => note.category === activeCategory) : notes] as const)
    .filter(([, notes]) => notes.length > 0)
  const visibleCount = groups.reduce((total, [, notes]) => total + notes.length, 0)

  return (
    <div className="notes-directory">
      <div className="notes-directory-filters" aria-label="笔记分类">
        <span className="notes-filter-label"><Layers3 size={15} strokeWidth={1.7} /> 分类</span>
        <div className="notes-category-list">
          <button className={`notes-category-chip ${activeCategory === null ? 'is-active' : ''}`} aria-pressed={activeCategory === null} onClick={() => setSelectedCategory(null)}>
            全部笔记 <span>{totalNotes}</span>
          </button>
          {categories.map(category => (
            <button key={category} className={`notes-category-chip ${activeCategory === category ? 'is-active' : ''}`} aria-pressed={activeCategory === category} onClick={() => setSelectedCategory(category)}>
              <span className="notes-category-name">{category}</span><span>{notesByCategory(category).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="notes-directory-scroll">
        {groups.length === 0 ? (
          <div className="notes-empty glass-card">
            <div className="notes-empty-icon"><BookOpen size={30} strokeWidth={1.3} /></div>
            <h2>把日常，留在这里</h2>
            <p>点击「新建笔记」，记下一个想法或今天的片刻。</p>
          </div>
        ) : (
          <>
            <div className="notes-directory-summary"><span>按时间浏览</span><span>{visibleCount} 篇笔记</span></div>
            {groups.map(([date, notes]) => (
              <section key={date} className="notes-date-group" aria-label={date}>
                <div className="notes-date-heading"><CalendarDays size={14} strokeWidth={1.7} /><h2>{date}</h2><span>{notes.length} 篇</span><div /></div>
                <div className="notes-card-grid">
                  {notes.map(note => (
                    <button key={note.id} onClick={() => onSelectNote(note)} className="notes-preview-card glass-card">
                      <div className="notes-preview-top"><span className="notes-file-icon"><FileText size={18} strokeWidth={1.5} /></span><span className="notes-note-category">{note.category}</span><ArrowUpRight className="notes-open-arrow" size={17} strokeWidth={1.6} /></div>
                      <h3>{note.title}</h3>
                      <p>{stripImageMarkdown(note.content).trim() || '这篇笔记记录了图片，打开看看。'}</p>
                      <div className="notes-preview-footer"><span>{note.createdAt.slice(11, 16)}</span><span>阅读笔记 <ArrowUpRight size={12} strokeWidth={1.7} /></span></div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
