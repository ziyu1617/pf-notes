"use client"

import { useState, useRef, useEffect } from 'react'
import { Note } from '@/hooks/use-notes'
import { streamPost } from '@/lib/stream'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface AIChatViewProps {
  note: Note | null
  onClose: () => void
  onSelectNote?: () => void
  // 嵌入笔记页右侧分栏时为 true：隐藏自带的「当前笔记」预览（笔记已在左侧显示）
  embedded?: boolean
}

export function AIChatView({ note, onClose, onSelectNote, embedded = false }: AIChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sendStartedRef = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 切换笔记时加载该笔记已保存的对话记录（无笔记则清空）
  useEffect(() => {
    sendStartedRef.current = false
    if (!note) {
      setMessages([])
      return
    }
    let cancelled = false
    fetch(`/api/notes/${note.id}/chat`)
      .then(r => r.json())
      .then((data: Message[]) => {
        // 用户若已开始发送，则不要用历史覆盖正在进行的对话
        if (!cancelled && !sendStartedRef.current) setMessages(data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [note?.id])

  // 离开视图时中止仍在进行的流式请求，避免对已卸载组件写状态/写库
  useEffect(() => () => abortRef.current?.abort(), [])

  // 把单条消息持久化到当前笔记下；返回 Promise 以便按顺序保存，失败不抛出
  const saveMessage = (role: Message['role'], content: string) => {
    if (!note) return Promise.resolve()
    return fetch(`/api/notes/${note.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content }),
    }).then(() => {}).catch(() => {})
  }

  const handleClear = async () => {
    if (!note || messages.length === 0) return
    if (!confirm('确定要清空与这条笔记的对话记录吗？')) return
    try {
      await fetch(`/api/notes/${note.id}/chat`, { method: 'DELETE' })
    } catch {}
    setMessages([])
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')
    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }]
    setMessages(newMessages)
    setIsLoading(true)
    sendStartedRef.current = true
    const controller = new AbortController()
    abortRef.current = controller

    let started = false
    let finalText = ''

    // 把最后一条 AI 气泡替换成指定文字；若还没有 AI 气泡则新增一条
    const showAssistant = (content: string) =>
      setMessages(prev => {
        const copy = [...prev]
        if (started && copy[copy.length - 1]?.role === 'assistant') {
          copy[copy.length - 1] = { role: 'assistant', content }
          return copy
        }
        return [...prev, { role: 'assistant', content }]
      })

    try {
      await streamPost(
        '/api/ai/chat',
        { messages: newMessages, noteId: note?.id ?? null },
        (text) => {
          finalText = text
          setMessages(prev => {
            if (!started) {
              started = true
              return [...prev, { role: 'assistant', content: text }]
            }
            const copy = [...prev]
            copy[copy.length - 1] = { role: 'assistant', content: text }
            return copy
          })
        },
        controller.signal,
      )

      if (finalText) {
        // 完整回复才落库：先存用户消息再存 AI 回复（await 保证写入顺序）
        await saveMessage('user', userMessage)
        await saveMessage('assistant', finalText)
      } else {
        showAssistant('（AI 未返回内容）')
      }
    } catch {
      if (controller.signal.aborted) return // 切换视图导致的中止：不提示、不落库
      showAssistant('连接 AI 服务失败，请确认后端已启动（python3 api.py）。')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fv-secondary fv-chat flex-1 flex flex-col overflow-hidden">
      <div className="fv-workspace flex-1 flex gap-2 p-2 bg-[#ece9d8] overflow-hidden">
        {/* 笔记预览（嵌入分栏时隐藏，笔记已在左侧显示） */}
        {!embedded && (
          <div className="w-64 flex flex-col shrink-0">
            <div className="text-[11px] font-bold mb-1">当前笔记</div>
            <div className="fv-paper flex-1 bg-white p-2 win-inset overflow-auto">
              {note ? (
                <>
                  <div className="text-[11px] font-bold mb-1">{note.title}</div>
                  <div className="fv-muted text-[10px] text-[#808080] mb-2">[{note.category}]</div>
                  <pre className="text-[10px] font-mono whitespace-pre-wrap">
                    {note.content}
                  </pre>
                </>
              ) : (
                <div className="fv-muted text-[11px] text-[#808080]">
                  <p className="mb-2">未选择笔记</p>
                  {onSelectNote && (
                    <button
                      onClick={onSelectNote}
                      className="win-button text-[10px] px-2"
                    >
                      去选择笔记
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 对话区域 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="fv-chat-heading flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold">对话{note && '（已保存到此笔记）'}</span>
            {note && messages.length > 0 && (
              <button
                onClick={handleClear}
                disabled={isLoading}
                className="win-button text-[10px] px-2"
              >
                清空对话
              </button>
            )}
          </div>
          <div className="fv-chat-surface flex-1 bg-white win-inset overflow-auto p-2">
            {messages.length === 0 && (
              <div className="fv-muted text-[11px] text-[#808080] p-2">
                开始与 AI 对话吧！{note ? '您可以问关于当前笔记的任何问题。' : '建议先选择一条笔记再开始对话。'}
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`fv-chat-bubble mb-2 p-2 text-[11px] ${
                  msg.role === 'user' 
                    ? 'fv-bubble-user bg-[#ece9d8] ml-8'
                    : 'fv-bubble-assistant bg-[#e0f0ff] mr-8'
                }`}
              >
                <div className="fv-chat-author text-[10px] font-bold mb-1">
                  {msg.role === 'user' ? '您' : 'AI'}
                </div>
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="fv-chat-bubble fv-bubble-assistant mb-2 p-2 text-[11px] bg-[#e0f0ff] mr-8">
                <div className="fv-chat-author text-[10px] font-bold mb-1">AI</div>
                <span className="fv-thinking text-[#000080]">正在思考...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          {/* 输入区域 */}
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-w-0 flex-1 p-1 text-[12px] win-input"
              placeholder="输入您的问题..."
              disabled={isLoading}
            />
            <button 
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="fv-primary-action win-button shrink-0 text-[11px] px-4"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
