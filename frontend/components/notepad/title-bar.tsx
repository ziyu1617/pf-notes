"use client"

interface TitleBarProps {
  title: string
  onMinimize?: () => void
  onMaximize?: () => void
  onClose?: () => void
}

export function TitleBar({ title, onClose }: TitleBarProps) {
  return (
    <div 
      className="h-7 flex items-center justify-between px-1 text-white select-none"
      style={{ background: 'linear-gradient(90deg, #000080, #1084d0)' }}
    >
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-bold tracking-tight">{title}</span>
      </div>
      <div className="flex">
        <button
          className="w-5 h-5 flex items-center justify-center text-black text-xs font-bold win-button"
          onClick={onClose}
          title="退出"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
