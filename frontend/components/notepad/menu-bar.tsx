"use client"

interface MenuBarProps {
  onAction: (action: string) => void
  currentView?: string
}

const menuItems = [
  { key: '1', label: '日历', action: 'calendar', icon: '📅' },
  { key: '2', label: '所有笔记', action: 'list', icon: '📋' },
  { key: '3', label: '新建笔记', action: 'new', icon: '✏️' },
  { key: '4', label: '草莓', action: 'strawberry', icon: '🍓' },
]

export function MenuBar({ onAction, currentView }: MenuBarProps) {
  return (
    <div className="glass-navigation flex flex-wrap gap-1 p-1 bg-[#d4d0c8] border-b border-[#808080]">
      {menuItems.map((item) => (
        <button
          key={item.key}
          onClick={() => onAction(item.action)}
          aria-current={currentView === item.action ? 'page' : undefined}
          className={`win-button text-[11px] px-2 py-0.5 whitespace-nowrap ${
            currentView === item.action ? 'bg-[#000080] text-white' : ''
          }`}
        >
          <span className="mr-1 text-[10px] opacity-60">[{item.key}]</span>
          {item.icon && <span className="mr-1">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  )
}
