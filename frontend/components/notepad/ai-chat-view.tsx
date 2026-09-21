"use client"

import { useState, useRef, useEffect } from 'react'
import { Note } from '@/hooks/use-notes'
import { streamPost } from '@/lib/stream'
import { ArrowUp, FileText, Sparkles, Trash2, X } from 'lucide-react'

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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sendStartedRef = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'end',
    })
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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={`glass-chat-layout ${embedded ? 'chat-embedded' : ''}`}>
      {!embedded && (
        <aside className="chat-note-preview glass-card" aria-label="当前笔记">
          <span className="chat-note-eyebrow"><FileText size={14} /> 当前笔记</span>
          {note ? (
            <>
              <h3>{note.title || '无标题笔记'}</h3>
              <span className="glass-chip">{note.category}</span>
              <pre>{note.content}</pre>
            </>
          ) : (
            <div className="chat-note-empty">
              <p>选择一条笔记，让讨论更有灵感。</p>
              {onSelectNote && <button onClick={onSelectNote} className="glass-button">选择笔记</button>}
            </div>
          )}
        </aside>
      )}

      <section className="glass-chat ai-chat" aria-label="AI 笔记助手">
        <header className="chat-header">
          <div className="chat-heading">
            <div className="chat-avatar" aria-hidden="true"><Sparkles size={20} strokeWidth={1.6} /></div>
            <div>
              <h2>一起想得更远</h2>
              <p>{note ? '围绕这条笔记，继续你的思考' : '你的 AI 笔记助手'}</p>
            </div>
          </div>
          <div className="chat-header-actions">
            {note && messages.length > 0 && (
              <button onClick={handleClear} disabled={isLoading} className="glass-icon-button chat-clear" aria-label="清空笔记对话" title="清空对话">
                <Trash2 size={16} strokeWidth={1.7} />
              </button>
            )}
            {!embedded && <button onClick={onClose} className="glass-icon-button" aria-label="关闭 AI 对话" title="关闭对话"><X size={17} /></button>}
          </div>
        </header>

        <div className="chat-messages" role="log" aria-label="AI 对话记录" aria-live="polite">
          {messages.length === 0 && (
            <div className="chat-welcome ai-welcome">
              <div className="chat-welcome-orb" aria-hidden="true"><Sparkles size={29} strokeWidth={1.25} /></div>
              <span className="chat-eyebrow">A FRESH PERSPECTIVE</span>
              <h3>给想法一点新灵感。</h3>
              <p>{note ? '梳理思路、提炼重点，或展开一个新方向。' : '选择一条笔记，或者直接从一个问题开始。'}</p>
              <div className="chat-suggestions">
                {(note ? ['帮我梳理这条笔记', '有哪些值得深入的想法？'] : ['帮我整理思路', '给我一点写作灵感']).map(prompt => (
                  <button key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus() }} className="chat-suggestion">{prompt}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <article key={i} className={`chat-message ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}>
              <span className="chat-message-author">{msg.role === 'user' ? '你' : 'AI 助手'}</span>
              <div className="chat-bubble"><p>{msg.content}</p></div>
            </article>
          ))}
          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="chat-message chat-message-assistant">
              <span className="chat-message-author">AI 助手</span>
              <div className="chat-bubble chat-thinking"><span className="chat-typing" aria-hidden="true"><i /><i /><i /></span>正在思考…</div>
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
              aria-label="向 AI 助手提问"
              placeholder="有什么想一起想想的？"
              disabled={isLoading}
            />
            <button onClick={handleSend} disabled={isLoading || !input.trim()} className="chat-send" aria-label="发送消息" title="发送消息">
              <ArrowUp size={19} strokeWidth={2.1} />
            </button>
          </div>
          <p className="chat-compose-hint">{note ? '对话自动保存到当前笔记' : 'AI 的回答仅供参考'}<span>Enter 发送 · Shift + Enter 换行</span></p>
        </div>
      </section>
    </div>
  )
}
