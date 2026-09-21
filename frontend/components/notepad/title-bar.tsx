"use client"

import { BookOpen } from 'lucide-react'

interface TitleBarProps {
  title: string
  onMinimize?: () => void
  onMaximize?: () => void
  onClose?: () => void
}

export function TitleBar({ title }: TitleBarProps) {
  return (
    <div className="app-brand" aria-label={title}>
      <div className="app-brand-icon"><BookOpen size={20} strokeWidth={1.5} /></div>
      <div className="app-brand-copy">
        <div className="app-brand-name">记事本</div>
        <div className="app-brand-caption">SMART NOTES</div>
      </div>
    </div>
  )
}
