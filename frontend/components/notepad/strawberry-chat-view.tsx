"use client"

import { useState, useRef, useEffect } from 'react'
import { streamPost } from '@/lib/stream'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function StrawberryChatView() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sendStartedRef = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 加载和草莓的历史对话（独立于笔记，全局一条会话）
  useEffect(() => {
    let cancelled = false
    fetch('/api/strawberry/chat')
      .then(r => r.json())
      .then((data: Message[]) => {
        // 用户若已开始发送，则不要用历史覆盖正在进行的对话
        if (!cancelled && !sendStartedRef.current) setMessages(data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // 离开视图时中止仍在进行的流式请求，避免对已卸载组件写状态/写库
  useEffect(() => () => abortRef.current?.abort(), [])

  // 持久化一条消息；返回 Promise 以便按顺序保存，失败不抛出
  const saveMessage = (role: Message['role'], content: string) =>
    fetch('/api/strawberry/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content }),
    }).then(() => {}).catch(() => {})

  const handleClear = async () => {
    if (messages.length === 0) return
    if (!confirm('确定要清空和草莓的所有对话吗？')) return
    try {
      await fetch('/api/strawberry/chat', { method: 'DELETE' })
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

    // 把最后一条草莓气泡替换成指定文字；若还没有草莓气泡则新增一条
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
        '/api/ai/strawberry',
        { messages: newMessages },
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
        // 完整回复才落库：先存用户消息再存草莓回复（await 保证写入顺序）
        await saveMessage('user', userMessage)
        await saveMessage('assistant', finalText)
      } else {
        // 空回复：给个提示但不保存（与重载后保持一致）
        showAssistant('（草莓走神了一下，没接上话，要不再说一次？）')
      }
    } catch {
      if (controller.signal.aborted) return // 切换视图导致的中止：不提示、不落库
      // 出错：展示友好提示，不保存（避免留下「有问无答」的悬空记录）
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
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col p-2 bg-[#ece9d8] overflow-hidden">
        {/* 标题 + 清空 */}
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-bold">🍓 和草莓聊聊（对话会自动保存）</span>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              disabled={isLoading}
              className="win-button text-[10px] px-2"
            >
              清空对话
            </button>
          )}
        </div>

        {/* 对话区 */}
        <div className="flex-1 bg-white win-inset overflow-auto p-2">
          {messages.length === 0 && (
            <div className="text-[11px] text-[#808080] p-2">
              嗨，我是草莓🍓 有什么开心的或者不开心的，都可以跟我说说，我都在听呀～
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`mb-2 p-2 text-[11px] ${
                msg.role === 'user'
                  ? 'bg-[#ece9d8] ml-8'
                  : 'bg-[#ffe6f0] mr-8'
              }`}
            >
              <div className="text-[10px] font-bold mb-1">
                {msg.role === 'user' ? '您' : '🍓 草莓'}
              </div>
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="mb-2 p-2 text-[11px] bg-[#ffe6f0] mr-8">
              <div className="text-[10px] font-bold mb-1">🍓 草莓</div>
              <span className="text-[#c2185b]">正在认真听你说...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 p-1 text-[12px] win-input"
            placeholder="想和草莓说点什么..."
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="win-button text-[11px] px-4"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
