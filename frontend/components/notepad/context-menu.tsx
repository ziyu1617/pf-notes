"use client"

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuAction {
  label: string
  shortcut?: string
  disabled?: boolean
  onClick: () => void
}

export type ContextMenuItem = MenuAction | 'separator'

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/** 半透明浮层菜单，保持在视口内并支持键盘导航。 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [pos, setPos] = useState({ x, y })
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)

  // 挂到 body，使 clientX/clientY 始终以视口为基准；避免玻璃/动画容器
  // 的 backdrop-filter、transform 或 overflow 改变定位和裁剪。SSR 先不渲染。
  useEffect(() => {
    setPortalTarget(document.body)
  }, [])

  // 渲染后按菜单实际尺寸把它挪回视口内，避免贴边溢出
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (!previousFocusRef.current) previousFocusRef.current = document.activeElement as HTMLElement | null
    const r = el.getBoundingClientRect()
    const nx = Math.max(8, Math.min(x, window.innerWidth - r.width - 8))
    const ny = Math.max(8, Math.min(y, window.innerHeight - r.height - 8))
    setPos({ x: nx, y: ny })
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y, portalTarget])

  // 点击别处 / 右键别处 / Esc / 失焦 / 改变窗口大小都关闭
  useEffect(() => {
    if (!portalTarget) return
    const menuElement = ref.current
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') e.preventDefault()
        onClose()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      if (!buttons.length) return
      e.preventDefault()
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
        : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next].focus()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('contextmenu', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('contextmenu', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
      if (menuElement?.contains(document.activeElement) && previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus()
      }
    }
  }, [onClose, portalTarget])

  if (!portalTarget) return null

  return createPortal(
    <div
      ref={ref}
      style={{ top: pos.y, left: pos.x }}
      className="glass-context-menu"
      role="menu"
      aria-label="快捷操作"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} role="separator" className="glass-context-separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onClick()
              onClose()
            }}
            className="glass-context-action"
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        )
      )}
    </div>,
    portalTarget,
  )
}
