"use client"

import { useState } from 'react'
import { Note } from '@/hooks/use-notes'
import { streamPost } from '@/lib/stream'

interface AISummaryViewProps {
  note: Note | null
  onClose: () => void
}

export function AISummaryView({ note, onClose }: AISummaryViewProps) {
  const [summary, setSummary] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  if (!note) {
    return (
      <div className="fv-secondary fv-workspace flex flex-col p-4 bg-[#ece9d8]">
        <div className="fv-message-card text-center p-4 bg-[#d4d0c8] win-border">
          <div className="text-[12px] mb-4">请先从"📋 所有笔记"中选择要总结的笔记</div>
          <button onClick={onClose} className="win-button text-[11px] px-4 py-1">
            确定
          </button>
        </div>
      </div>
    )
  }

  const handleSummarize = async () => {
    setIsLoading(true)
    setSummary('')
    try {
      await streamPost('/api/ai/summarize', { noteId: note.id }, setSummary)
    } catch {
      setSummary('连接 AI 服务失败，请确认后端已启动（python3 api.py）。')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fv-secondary flex-1 flex flex-col overflow-hidden">
      <div className="fv-workspace flex-1 flex gap-2 p-2 bg-[#ece9d8] overflow-hidden">
        {/* 原文 */}
        <div className="flex-1 flex flex-col">
          <div className="text-[11px] font-bold mb-1">📄 原文内容</div>
          <div className="fv-paper flex-1 bg-white p-2 win-inset overflow-auto">
            <div className="text-[11px] font-bold mb-1">{note.title}</div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap">
              {note.content}
            </pre>
          </div>
        </div>
        
        {/* AI 总结 */}
        <div className="flex-1 flex flex-col">
          <div className="text-[11px] font-bold mb-1">🤖 AI 总结</div>
          <div className="fv-paper flex-1 bg-white p-2 win-inset overflow-auto">
            {!summary && !isLoading && (
              <div className="fv-muted text-[11px] text-[#808080]">
                点击下方按钮生成 AI 总结
              </div>
            )}
            {isLoading && !summary && (
              <div className="fv-thinking text-[11px] text-[#000080]">
                ⏳ 正在生成总结...
              </div>
            )}
            {summary && (
              <pre className="text-[11px] font-mono whitespace-pre-wrap">
                {summary}
              </pre>
            )}
          </div>
          <button 
            onClick={handleSummarize} 
            disabled={isLoading}
            className="win-button text-[11px] px-4 py-1 mt-2 self-end"
          >
            {isLoading ? '处理中...' : '生成总结'}
          </button>
        </div>
      </div>
    </div>
  )
}
