"use client"

import { useState, useRef, useEffect } from 'react'
import { streamPost } from '@/lib/stream'
import { ArrowUp, Heart, Trash2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function StrawberryChatView() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sendStartedRef = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'end',
    })
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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <section className="glass-chat strawberry-chat" aria-label="和草莓聊聊">
      <header className="chat-header">
        <div className="chat-heading">
          <div className="chat-avatar chat-avatar-rose" aria-hidden="true">🍓</div>
          <div>
            <h2>和草莓聊聊</h2>
            <p><span className="chat-status-dot" />一个随时愿意听你说话的朋友</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            disabled={isLoading}
            className="glass-icon-button chat-clear"
            aria-label="清空与草莓的对话"
            title="清空对话"
          >
            <Trash2 size={17} strokeWidth={1.7} />
          </button>
        )}
      </header>

      <div className="chat-messages" role="log" aria-label="与草莓的对话记录" aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-welcome strawberry-welcome">
            <div className="chat-welcome-orb" aria-hidden="true">🍓</div>
            <span className="chat-eyebrow">A LITTLE SPACE FOR YOU</span>
            <h3>这里，可以慢慢说。</h3>
            <p>开心的小事，或是说不清的心情。<br />我是草莓，你说，我都在听。</p>
            <div className="chat-suggestions">
              {['今天有点累', '分享一件开心的事', '就想随便聊聊'].map(prompt => (
                <button key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus() }} className="chat-suggestion">{prompt}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <article key={i} className={`chat-message ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}>
            <span className="chat-message-author">{msg.role === 'user' ? '你' : '🍓 草莓'}</span>
            <div className="chat-bubble"><p>{msg.content}</p></div>
          </article>
        ))}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="chat-message chat-message-assistant">
            <span className="chat-message-author">🍓 草莓</span>
            <div className="chat-bubble chat-thinking"><span className="chat-typing" aria-hidden="true"><i /><i /><i /></span>正在认真听你说…</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-compose-area">
        <div className="chat-composer">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="想和草莓说的话"
            placeholder="今天，有什么想和草莓说的？"
            disabled={isLoading}
          />
          <button onClick={handleSend} disabled={isLoading || !input.trim()} className="chat-send" aria-label="发送消息" title="发送消息">
            <ArrowUp size={19} strokeWidth={2.1} />
          </button>
        </div>
        <p className="chat-compose-hint"><Heart size={11} strokeWidth={1.7} /> 对话自动保存，心情慢慢安放 <span>Enter 发送 · Shift + Enter 换行</span></p>
      </div>
    </section>
  )
}
