"use client"

import { useState, useEffect, useCallback } from 'react'

export interface Note {
  id: string
  title: string
  content: string
  category: string
  diaryDate?: string | null
  createdAt: string
  updatedAt: string
}

/** The diary's intended day, independent of when a backfilled note was saved. */
export function getNoteDate(note: Pick<Note, 'diaryDate' | 'createdAt'>): string {
  if (note.diaryDate) return note.diaryDate

  // API/CLI timestamps have no timezone. Preserve their local calendar date;
  // replacing the SQL separator also keeps ISO parsing consistent in Safari.
  const timestamp = note.createdAt.trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(timestamp)) {
    return timestamp.slice(0, 10)
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Reading order follows the diary day, never the most recent edit. */
export function compareNotesByDateDescending(a: Note, b: Note): number {
  const dayOrder = getNoteDate(b).localeCompare(getNoteDate(a))
  if (dayOrder) return dayOrder
  const createdTime = (note: Note) => {
    const value = Date.parse(note.createdAt.trim().replace(' ', 'T'))
    return Number.isFinite(value) ? value : 0
  }
  return createdTime(b) - createdTime(a) || b.id.localeCompare(a.id, undefined, { numeric: true })
}

async function noteRequest(path: string, options?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(path, options)
  } catch {
    throw new Error('无法连接笔记服务，请检查网络后重试。')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const detail: unknown = data?.detail
    const message = typeof detail === 'string' ? detail : Array.isArray(detail)
      ? detail.map(value => typeof value?.msg === 'string' ? value.msg.replace(/^Value error, /, '') : '').filter(Boolean).join('；')
      : ''
    throw new Error(message || `笔记操作失败（${response.status}），请稍后重试。`)
  }
  return response
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    noteRequest('/api/notes')
      .then(r => r.json())
      .then((data: Note[]) => {
        if (!Array.isArray(data)) throw new Error('笔记数据格式有误，请刷新后重试。')
        setNotes(data)
        setIsLoaded(true)
      })
      .catch(() => setIsLoaded(true))
  }, [])

  const addNote = useCallback(async (note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note> => {
    const res = await noteRequest('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    })
    const newNote: Note = await res.json()
    setNotes(prev => [newNote, ...prev])
    return newNote
  }, [])

  const updateNote = useCallback(async (id: string, updates: Partial<Omit<Note, 'id' | 'createdAt'>>) => {
    const res = await noteRequest(`/api/notes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const updated: Note = await res.json()
    setNotes(prev => prev.map(n => n.id === id ? updated : n))
    return updated
  }, [])

  const deleteNote = useCallback(async (id: string) => {
    await noteRequest(`/api/notes/${id}`, { method: 'DELETE' })
    setNotes(prev => prev.filter(n => n.id !== id))
  }, [])

  const categories = Array.from(new Set(notes.map(n => n.category)))

  const getNotesByCategory = useCallback((category: string) => {
    return notes.filter(n => n.category === category)
  }, [notes])

  const getNotesByDate = useCallback(() => {
    const grouped: Record<string, Note[]> = {}
    const datedNotes = notes.map(note => ({ note, date: getNoteDate(note) }))
      .sort((a, b) => b.date.localeCompare(a.date))
    datedNotes.forEach(({ note, date }) => {
      const label = date ? new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }) : '未知日期'
      if (!grouped[label]) grouped[label] = []
      grouped[label].push(note)
    })
    return grouped
  }, [notes])

  const searchNotes = useCallback((query: string) => {
    const q = query.toLowerCase()
    return notes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.category.toLowerCase().includes(q)
    )
  }, [notes])

  return {
    notes,
    isLoaded,
    addNote,
    updateNote,
    deleteNote,
    categories,
    getNotesByCategory,
    getNotesByDate,
    searchNotes,
  }
}
