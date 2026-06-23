"use client"

import { useState } from 'react'
import { Note } from '@/hooks/use-notes'
import { streamPost } from '@/lib/stream'

interface AIWriteViewProps {
  note: Note | null
  onUpdateNote: (id: string, updates: Partial<Note>) => void
  onClose: () => void
}

export function AIWriteView({ note, onUpdateNote, onClose }: AIWriteViewProps) {
  const [prompt, setPrompt] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  if (!note) {
    return (
      <div className="flex flex-col p-4 bg-[#ece9d8]">
        <div className="text-center p-4 bg-[#d4d0c8] win-border">
          <div className="text-[12px] mb-4">请先从"📋 所有笔记"中选择要进行写作辅助的笔记</div>
          <button onClick={onClose} className="win-button text-[11px] px-4 py-1">
            确定
          </button>
        </div>
      </div>
    )
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      alert('请输入写作指令！')
      return
    }
    setIsLoading(true)
    setSuggestion('')
    try {
      await streamPost('/api/ai/write', { noteId: note.id, prompt }, setSuggestion)
    } catch {
      setSuggestion('连接 AI 服务失败，请确认后端已启动（python3 api.py）。')
    } finally {
      setIsLoading(false)
    }
  }

  const handleApply = () => {
    if (!suggestion) return
    const newContent = note.content + '\n\n' + suggestion
    onUpdateNote(note.id, { content: newContent })
    alert('已将 AI 建议追加到笔记末尾！')
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col p-2 gap-2 bg-[#ece9d8] overflow-hidden">
        {/* 指令输入 */}
        <div className="flex gap-2 items-center">
          <label className="text-[11px] whitespace-nowrap">写作指令：</label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 p-1 text-[12px] win-input"
            placeholder="例如：续写、优化表达、扩展内容..."
          />
          <button 
            onClick={handleGenerate}
            disabled={isLoading}
            className="win-button text-[11px] px-3"
          >
            {isLoading ? '...' : '生成'}
          </button>
        </div>
        
        {/* 快捷指令 */}
        <div className="flex gap-1 flex-wrap">
          <span className="text-[10px] text-[#808080]">快捷指令：</span>
          {['续写内容', '优化表达', '扩展内容', '添加总结', '修改语气'].map(cmd => (
            <button
              key={cmd}
              onClick={() => setPrompt(cmd)}
              className="win-button text-[10px] px-2"
            >
              {cmd}
            </button>
          ))}
        </div>
        
        {/* 内容区域 */}
        <div className="flex-1 flex gap-2 overflow-hidden">
          {/* 当前笔记 */}
          <div className="flex-1 flex flex-col">
            <div className="text-[11px] font-bold mb-1">📄 当前笔记</div>
            <div className="flex-1 bg-white p-2 win-inset overflow-auto">
              <pre className="text-[11px] font-mono whitespace-pre-wrap">
                {note.content}
              </pre>
            </div>
          </div>
          
          {/* AI 建议 */}
          <div className="flex-1 flex flex-col">
            <div className="text-[11px] font-bold mb-1">✨ AI 建议</div>
            <div className="flex-1 bg-white p-2 win-inset overflow-auto">
              {!suggestion && !isLoading && (
                <div className="text-[11px] text-[#808080]">
                  输入写作指令后点击生成按钮
                </div>
              )}
              {isLoading && !suggestion && (
                <div className="text-[11px] text-[#000080]">
                  ⏳ AI 正在思考...
                </div>
              )}
              {suggestion && (
                <pre className="text-[11px] font-mono whitespace-pre-wrap">
                  {suggestion}
                </pre>
              )}
            </div>
            {suggestion && (
              <button 
                onClick={handleApply}
                className="win-button text-[11px] px-4 py-1 mt-2 self-end"
              >
                应用到笔记
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
