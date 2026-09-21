"use client"

import { useCallback, useEffect, useRef, useState } from 'react'

export interface CalendarTag {
  id: string
  name: string
  color: string
}

export interface CalendarItem {
  id: string
  title: string
  description: string
  date: string
  time: string
  completed: boolean
  tagIds: string[]
  createdAt: string
  updatedAt: string
}

export interface CalendarItemInput {
  title: string
  description: string
  date: string
  time: string
  tagIds: string[]
}

interface CalendarData {
  items: CalendarItem[]
  tags: CalendarTag[]
}

async function calendarRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response
  let text: string
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    response = await fetch(path, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
    text = await response.text()
  } catch {
    if (controller.signal.aborted) {
      throw new Error('日历请求超时，请稍后重试。')
    }
    throw new Error('无法连接日历服务，请检查网络后重试。')
  } finally {
    clearTimeout(timeout)
  }

  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    throw new Error('日历服务暂时无法响应，请稍后重试。')
  }

  if (!response.ok) {
    const errorData = data as { detail?: unknown; error?: unknown } | undefined
    const detail = errorData?.detail ?? errorData?.error
    throw new Error(typeof detail === 'string' ? detail : '日历操作失败，请检查填写内容后重试。')
  }

  return data as T
}

export function useCalendar() {
  const [items, setItems] = useState<CalendarItem[]>([])
  const [tags, setTags] = useState<CalendarTag[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const requestQueue = useRef<Promise<unknown>>(Promise.resolve())

  // Serialize reads and writes so a slow reload cannot overwrite a later edit.
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const request = requestQueue.current.then(operation, operation)
    requestQueue.current = request.then(() => undefined, () => undefined)
    return request
  }, [])

  const reload = useCallback(() => enqueue(async () => {
    if (mounted.current) setError(null)
    try {
      const data = await calendarRequest<CalendarData>('/api/calendar')
      if (!data || !Array.isArray(data.items) || !Array.isArray(data.tags)) {
        throw new Error('日历数据格式有误，请重试。')
      }
      if (mounted.current) {
        setItems(data.items)
        setTags(data.tags)
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : '加载日历失败，请重试。')
      }
    } finally {
      if (mounted.current) setIsLoaded(true)
    }
  }), [enqueue])

  useEffect(() => {
    mounted.current = true
    void reload()
    return () => { mounted.current = false }
  }, [reload])

  const mutate = useCallback(<T,>(
    path: string,
    method: string,
    body: unknown,
    onSuccess: (value: T) => void,
  ): Promise<T> => enqueue(async () => {
    try {
      const value = await calendarRequest<T>(path, method, body)
      if (mounted.current) onSuccess(value)
      return value
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error('日历操作失败，请重试。')
      throw failure
    }
  }), [enqueue])

  const addItem = useCallback((input: CalendarItemInput) =>
    mutate<CalendarItem>('/api/calendar/items', 'POST', input, item => {
      setItems(previous => [...previous, item])
    }), [mutate])

  const updateItem = useCallback((id: string, updates: Partial<CalendarItemInput & { completed: boolean }>) =>
    mutate<CalendarItem>(`/api/calendar/items/${encodeURIComponent(id)}`, 'PUT', updates, item => {
      setItems(previous => previous.map(existing => existing.id === id ? item : existing))
    }), [mutate])

  const deleteItem = useCallback((id: string) =>
    mutate<void>(`/api/calendar/items/${encodeURIComponent(id)}`, 'DELETE', undefined, () => {
      setItems(previous => previous.filter(item => item.id !== id))
    }), [mutate])

  const addTag = useCallback((input: Pick<CalendarTag, 'name' | 'color'>) =>
    mutate<CalendarTag>('/api/calendar/tags', 'POST', input, tag => {
      setTags(previous => [...previous, tag])
    }), [mutate])

  const updateTag = useCallback((id: string, updates: Partial<Pick<CalendarTag, 'name' | 'color'>>) =>
    mutate<CalendarTag>(`/api/calendar/tags/${encodeURIComponent(id)}`, 'PUT', updates, tag => {
      setTags(previous => previous.map(existing => existing.id === id ? tag : existing))
    }), [mutate])

  const deleteTag = useCallback((id: string) =>
    mutate<void>(`/api/calendar/tags/${encodeURIComponent(id)}`, 'DELETE', undefined, () => {
      setTags(previous => previous.filter(tag => tag.id !== id))
      setItems(previous => previous.map(item => ({ ...item, tagIds: item.tagIds.filter(tagId => tagId !== id) })))
    }), [mutate])

  return { items, tags, isLoaded, error, reload, addItem, updateItem, deleteItem, addTag, updateTag, deleteTag }
}
