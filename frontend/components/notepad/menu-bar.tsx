"use client"

import { CalendarDays, BookOpen, PenLine, Heart } from 'lucide-react'

interface MenuBarProps {
  onAction: (action: string) => void
  currentView?: string
}

const menuItems = [
  { key: '1', label: '日历', action: 'calendar', icon: CalendarDays },
  { key: '2', label: '所有笔记', action: 'list', icon: BookOpen },
  { key: '3', label: '新建笔记', action: 'new', icon: PenLine },
  { key: '4', label: '草莓', action: 'strawberry', icon: Heart },
]

export function MenuBar({ onAction, currentView }: MenuBarProps) {
  return (
    <nav className="app-nav" aria-label="主要功能">
      {menuItems.map(({ icon: Icon, ...item }) => (
        <button key={item.key} onClick={() => onAction(item.action)}
          aria-current={currentView === item.action ? 'page' : undefined}
          title={`${item.label} · 快捷键 ${item.key}`}
          data-tone={item.action === 'strawberry' ? 'rose' : undefined}
          className="app-nav-item">
          <Icon aria-hidden="true" /><span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
