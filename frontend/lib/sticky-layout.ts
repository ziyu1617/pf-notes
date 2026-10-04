'use client'

import { useEffect, useState } from 'react'

export const STICKY_DEFAULT_SIZE = 240
export const STICKY_MIN_SIZE = 200
export const STICKY_MAX_SIZE = 420

const sizeKey = (id: string) => `smart-notes:sticky-size:${id}`

export function clampStickySize(value: number, maximum = STICKY_MAX_SIZE) {
  if (!Number.isFinite(value)) return STICKY_DEFAULT_SIZE
  return Math.round(Math.max(STICKY_MIN_SIZE, Math.min(Math.max(STICKY_MIN_SIZE, maximum), value)))
}

export function resizeStickySize(startSize: number, deltaX: number, deltaY: number, corner: 'top-left' | 'bottom-left', maximum = STICKY_MAX_SIZE) {
  const horizontal = -deltaX
  const vertical = deltaY * (corner === 'top-left' ? -1 : 1)
  return clampStickySize(startSize + (Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical), maximum)
}

export function readStickySize(id: string) {
  if (typeof window === 'undefined') return STICKY_DEFAULT_SIZE
  try {
    const value = window.localStorage.getItem(sizeKey(id))
    return value === null ? STICKY_DEFAULT_SIZE : clampStickySize(Number(value))
  } catch { return STICKY_DEFAULT_SIZE }
}

export function saveStickySize(id: string, value: number) {
  const size = clampStickySize(value)
  try { window.localStorage.setItem(sizeKey(id), String(size)) } catch { /* Window sizing works without storage. */ }
  window.dispatchEvent(new CustomEvent('sticky-size-changed', { detail: { id, size } }))
  return size
}

export function useStickySize(id: string) {
  const [size, setSize] = useState(STICKY_DEFAULT_SIZE)
  useEffect(() => {
    setSize(readStickySize(id))
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; size: number }>).detail
      if (String(detail?.id) !== id || typeof detail?.size !== 'number') return
      const next = clampStickySize(detail.size)
      try { window.localStorage.setItem(sizeKey(id), String(next)) } catch { /* Keep the in-memory size. */ }
      setSize(next)
    }
    const stored = (event: StorageEvent) => {
      if (event.key === sizeKey(id)) setSize(readStickySize(id))
    }
    window.addEventListener('sticky-size-changed', changed)
    window.addEventListener('storage', stored)
    return () => {
      window.removeEventListener('sticky-size-changed', changed)
      window.removeEventListener('storage', stored)
    }
  }, [id])
  return [size, (next: number) => saveStickySize(id, next)] as const
}
