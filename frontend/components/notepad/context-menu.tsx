"use client"

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

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

/** 经典 Windows 风格的右键菜单，定位后会自动约束在视口内。 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // 渲染后按菜单实际尺寸把它挪回视口内，避免贴边溢出
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (x + r.width > window.innerWidth) nx = Math.max(0, window.innerWidth - r.width - 2)
    if (y + r.height > window.innerHeight) ny = Math.max(0, window.innerHeight - r.height - 2)
    setPos({ x: nx, y: ny })
  }, [x, y])

  // 点击别处 / 右键别处 / Esc / 失焦 / 改变窗口大小都关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
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
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{ top: pos.y, left: pos.x }}
      className="fixed z-[100] min-w-[150px] bg-[#d4d0c8] win-border py-0.5 text-[11px] select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="my-0.5 mx-0.5 h-px bg-[#808080]" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              item.onClick()
              onClose()
            }}
            className="flex w-full items-center justify-between gap-6 px-3 py-1 text-left text-black hover:bg-[#000080] hover:text-white disabled:text-[#a0a0a0] disabled:hover:bg-transparent disabled:hover:text-[#a0a0a0]"
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="opacity-70">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  )
}
