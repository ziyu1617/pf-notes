"use client"

import { useState, useEffect, useCallback } from 'react'

export interface Note {
  id: string
  title: string
  content: string
  category: string
  createdAt: string
  updatedAt: string
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/notes')
      .then(r => r.json())
      .then((data: Note[]) => {
        setNotes(data)
        setIsLoaded(true)
      })
      .catch(() => setIsLoaded(true))
  }, [])

  const addNote = useCallback(async (note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note> => {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    })
    const newNote: Note = await res.json()
    setNotes(prev => [newNote, ...prev])
    return newNote
  }, [])

  const updateNote = useCallback(async (id: string, updates: Partial<Omit<Note, 'id' | 'createdAt'>>) => {
    const res = await fetch(`/api/notes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const updated: Note = await res.json()
    setNotes(prev => prev.map(n => n.id === id ? updated : n))
    return updated
  }, [])

  const deleteNote = useCallback(async (id: string) => {
    await fetch(`/api/notes/${id}`, { method: 'DELETE' })
    setNotes(prev => prev.filter(n => n.id !== id))
  }, [])

  const categories = Array.from(new Set(notes.map(n => n.category)))

  const getNotesByCategory = useCallback((category: string) => {
    return notes.filter(n => n.category === category)
  }, [notes])

  const getNotesByDate = useCallback(() => {
    const grouped: Record<string, Note[]> = {}
    notes.forEach(note => {
      const date = new Date(note.createdAt).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      if (!grouped[date]) grouped[date] = []
      grouped[date].push(note)
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
