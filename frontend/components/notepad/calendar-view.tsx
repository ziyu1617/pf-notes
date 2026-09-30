"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCalendar, type CalendarItem, type CalendarItemInput, type CalendarTag } from '@/hooks/use-calendar'
import { getNoteDate, type Note } from '@/hooks/use-notes'
import { ContextMenu } from './context-menu'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const TAG_COLORS = [
  { value: '#000080', name: '深蓝' },
  { value: '#008080', name: '青绿' },
  { value: '#a04000', name: '橙棕' },
  { value: '#800080', name: '紫色' },
  { value: '#c00000', name: '红色' },
  { value: '#35702a', name: '绿色' },
]

// Use local calendar dates throughout; UTC conversion can move an item to the previous day.
function dateKey(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`)
}

function dateLabel(value: string) {
  return parseDate(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
}

function TagBadge({ tag }: { tag: CalendarTag }) {
  return (
    <span className="glass-tag inline-flex max-w-full items-center gap-1 border border-[#d4d0c8] bg-[#f8f8f4] px-1.5 py-0.5 text-[10px] text-[#404040]">
      <span className="h-2 w-2 shrink-0" style={{ backgroundColor: tag.color }} />
      <span className="truncate">{tag.name}</span>
    </span>
  )
}

interface CalendarViewProps {
  notes: Note[]
  initialDate?: string
  onDateChange: (date: string) => void
  onCreateDiary: (date: string) => void
  onOpenNote: (note: Note) => void
}

export function CalendarView({ notes, initialDate, onDateChange, onCreateDiary, onOpenNote }: CalendarViewProps) {
  const { items, tags, isLoaded, error, reload, addItem, updateItem, deleteItem, addTag, deleteTag } = useCalendar()
  const today = dateKey(new Date())
  const [selectedDate, setSelectedDate] = useState(initialDate || today)
  const [month, setMonth] = useState((initialDate || today).slice(0, 7))
  const [dateMenu, setDateMenu] = useState<{ date: string; x: number; y: number } | null>(null)
  const notesByDate = useMemo(() => {
    const grouped = new Map<string, Note[]>()
    for (const note of notes) {
      const key = getNoteDate(note)
      if (!key) continue
      const group = grouped.get(key) ?? []
      group.push(note)
      grouped.set(key, group)
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id, undefined, { numeric: true }))
    }
    return grouped
  }, [notes])
  const [filterTagId, setFilterTagId] = useState('')
  const [draft, setDraft] = useState<CalendarItemInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState(TAG_COLORS[0].value)
  const [showTagManager, setShowTagManager] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'item' | 'tag'; id: string; name: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const tagManagerRef = useRef<HTMLElement>(null)
  const deletePromptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showTagManager) tagManagerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [showTagManager])

  useEffect(() => {
    if (pendingDelete) deletePromptRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [pendingDelete])

  const days = useMemo(() => {
    const first = parseDate(`${month}-01`)
    const start = new Date(first)
    start.setDate(1 - (first.getDay() + 6) % 7)
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start)
      day.setDate(start.getDate() + index)
      return { key: dateKey(day), day: day.getDate() }
    })
  }, [month])

  const tagMap = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags])
  const itemsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarItem[]>()
    for (const item of items) {
      if (filterTagId && !item.tagIds.includes(filterTagId)) continue
      const group = grouped.get(item.date) ?? []
      group.push(item)
      grouped.set(item.date, group)
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => Number(a.completed) - Number(b.completed) || a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt))
    }
    return grouped
  }, [items, filterTagId])

  const dayItems = itemsByDate.get(selectedDate) ?? []

  async function runAction(action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      await action()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function moveMonth(offset: number) {
    const next = parseDate(`${month}-01`)
    next.setMonth(next.getMonth() + offset)
    if (next.getFullYear() < 1 || next.getFullYear() > 9999) return
    selectDay(dateKey(next))
  }

  function selectDay(value: string, revealMonth = true) {
    if (value < '0001-01-01' || value > '9999-12-31') return
    setSelectedDate(value)
    if (revealMonth) setMonth(value.slice(0, 7))
    onDateChange(value)
    setDateMenu(null)
  }

  function openDiary(value: string) {
    const note = notesByDate.get(value)?.[0]
    if (!note) return
    selectDay(value)
    onOpenNote(note)
  }

  function openEditor(item?: CalendarItem) {
    setEditingId(item?.id ?? null)
    setDraft(item ? {
      title: item.title, description: item.description, date: item.date, time: item.time, tagIds: [...item.tagIds],
    } : { title: '', description: '', date: selectedDate, time: '', tagIds: filterTagId ? [filterTagId] : [] })
    setActionError('')
    setNotice('')
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      formRef.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus()
    })
  }

  function saveItem(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    if (!draft.title.trim()) {
      setActionError('请输入事项标题')
      return
    }
    const input = { ...draft, title: draft.title.trim(), description: draft.description.trim() }
    void runAction(async () => {
      if (editingId) await updateItem(editingId, input)
      else await addItem(input)
      selectDay(input.date)
      if (filterTagId && !input.tagIds.includes(filterTagId)) setFilterTagId('')
      setDraft(null)
      setEditingId(null)
      setNotice('事项已保存')
    })
  }

  function createTag(event: React.FormEvent) {
    event.preventDefault()
    if (!tagName.trim()) {
      setActionError('请输入标签名称')
      return
    }
    void runAction(async () => {
      const tag = await addTag({ name: tagName.trim(), color: tagColor })
      setTagName('')
      setDraft(current => current ? { ...current, tagIds: [...new Set([...current.tagIds, tag.id])] } : current)
      setNotice(`已添加标签「${tag.name}」`)
    })
  }

  function confirmDelete() {
    if (!pendingDelete) return
    const target = pendingDelete
    void runAction(async () => {
      if (target.kind === 'item') {
        await deleteItem(target.id)
        if (editingId === target.id) {
          setDraft(null)
          setEditingId(null)
        }
      } else {
        await deleteTag(target.id)
        if (filterTagId === target.id) setFilterTagId('')
        setDraft(current => current ? { ...current, tagIds: current.tagIds.filter(id => id !== target.id) } : current)
      }
      setPendingDelete(null)
      setNotice(target.kind === 'item' ? '事项已删除' : '标签已删除，事项已保留')
    })
  }

  if (!isLoaded) {
    return <div className="flex-1 bg-[#ece9d8] p-6 text-center text-[12px]" role="status">正在加载日历...</div>
  }

  return (
    <div className="glass-calendar flex min-h-0 flex-1 flex-col bg-[#ece9d8] text-[12px]">
      <div className="glass-calendar-toolbar flex flex-wrap items-center gap-2 border-b border-[#808080] p-2">
        <button className="win-button" aria-label="上个月" onClick={() => moveMonth(-1)}>◀</button>
        <span className="glass-month-label min-w-28 text-center font-bold">{parseDate(`${month}-01`).getFullYear()} 年 {Number(month.slice(5))} 月</span>
        <button className="win-button" aria-label="下个月" onClick={() => moveMonth(1)}>▶</button>
        <button className="win-button" onClick={() => selectDay(dateKey(new Date()))}>今天</button>
        <label className="ml-auto flex items-center gap-1 text-[11px]">
          标签筛选
          <select aria-label="标签筛选" className="win-input max-w-36 p-1" value={filterTagId} onChange={event => setFilterTagId(event.target.value)}>
            <option value="">全部标签</option>
            {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
        </label>
        <button className="win-button" aria-expanded={showTagManager} onClick={() => setShowTagManager(value => !value)}>管理标签</button>
      </div>

      {(error || actionError) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#c00000] bg-[#fff1ef] px-3 py-2 text-[#a00000]" role="alert">
          <span>{actionError || error}</span>
          {error && <button className="win-button" disabled={busy} onClick={() => { void reload() }}>重新加载</button>}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row">
        <section className="min-w-0 shrink-0 p-2 lg:flex lg:flex-1 lg:flex-col lg:overflow-auto" aria-label="月历">
          <div className="glass-calendar-sheet win-inset bg-white p-0.5 lg:flex lg:min-h-[450px] lg:flex-1 lg:flex-col">
            <div className="glass-weekdays grid grid-cols-7 border-b border-[#808080] bg-[#d4d0c8]">
              {WEEKDAYS.map((day, index) => <div key={day} className={`py-1.5 text-center text-[11px] font-bold ${index > 4 ? 'text-[#a04000]' : ''}`}>周{day}</div>)}
            </div>
            <div className="grid flex-1 grid-cols-7 auto-rows-fr">
              {days.map(({ key, day }) => {
                const entries = itemsByDate.get(key) ?? []
                const selected = key === selectedDate
                const inMonth = key.startsWith(month)
                const diaryCount = notesByDate.get(key)?.length ?? 0
                const hasDiary = diaryCount > 0
                return (
                  <button key={key} type="button" aria-label={`${key}，${entries.length} 个事项${hasDiary ? `，${diaryCount} 篇日记` : ''}${key === today ? '，今天' : ''}`} aria-pressed={selected} aria-haspopup="menu" aria-current={key === today ? 'date' : undefined}
                    title={hasDiary ? '双击查看当天日记' : undefined}
                    // Keep adjacent-month cells in place between the two clicks.
                    onClick={() => selectDay(key, false)}
                    onDoubleClick={() => openDiary(key)}
                    onContextMenu={event => {
                      event.preventDefault()
                      selectDay(key)
                      setDateMenu({ date: key, x: event.clientX, y: event.clientY })
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && hasDiary && !event.repeat && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        openDiary(key)
                        return
                      }
                      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                        event.preventDefault()
                        const rect = event.currentTarget.getBoundingClientRect()
                        selectDay(key)
                        setDateMenu({ date: key, x: rect.left, y: rect.bottom })
                      }
                    }}
                    className={`glass-day flex min-h-[80px] min-w-0 flex-col overflow-hidden border-b border-r border-[#d4d0c8] p-1 text-left outline-offset-[-4px] focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-[#404040] ${hasDiary ? 'glass-day-diary shadow-[inset_0_0_0_2px_#ec4899]' : ''} ${selected ? 'bg-[#e6edf7]' : inMonth ? 'bg-white hover:bg-[#f5f4ec]' : 'bg-[#f2f1ed] text-[#808080]'}`}>
                    <div className="mb-1 flex w-full items-center gap-1">
                      <span className={`glass-day-number inline-flex h-5 min-w-5 shrink-0 items-center justify-center px-0.5 ${key === today ? 'bg-[#000080] font-bold text-white' : selected ? 'font-bold text-[#000080]' : ''}`}>{day}</span>
                      {hasDiary && <span className="shrink-0 whitespace-nowrap text-[10px] font-bold text-[#b52c70]">日记</span>}
                      {entries.length > 0 && <span className="ml-auto min-w-0 truncate text-[9px] text-[#606060]">{entries.length}项</span>}
                    </div>
                    <div className="w-full space-y-0.5">
                      {entries.slice(0, 2).map(item => (
                        <div key={item.id} className={`glass-calendar-entry truncate border-l-2 bg-[#ece9d8] px-1 py-0.5 text-[10px] text-[#303030] ${item.completed ? 'line-through' : ''}`} style={{ borderLeftColor: tagMap.get(item.tagIds[0])?.color ?? '#808080' }}>
                          {item.completed ? '✓ ' : item.time ? `${item.time} ` : ''}{item.title}
                        </div>
                      ))}
                      {entries.length > 2 && <div className="truncate text-[9px] text-[#606060]">另有 {entries.length - 2} 项</div>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <aside className="glass-day-panel min-w-0 shrink-0 space-y-3 border-t border-[#808080] p-3 lg:w-[340px] lg:overflow-auto lg:border-l lg:border-t-0" aria-label="当日事项">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-bold">{dateLabel(selectedDate)}</h2>
              <p className="mt-1 text-[10px] text-[#606060]">{dayItems.length} 个事项 · {dayItems.filter(item => !item.completed).length} 个待完成{filterTagId ? '（已筛选）' : ''}</p>
            </div>
            <button className="win-button" disabled={busy || !!draft || !!error} onClick={() => openEditor()}>＋ 添加事项</button>
          </div>

          {draft && (
            <form ref={formRef} onSubmit={saveItem} className="win-border space-y-2 bg-[#d4d0c8] p-3" aria-label={editingId ? '编辑事项' : '添加事项'}>
              <fieldset disabled={busy} className="min-w-0 space-y-2">
                <legend className="mb-2 font-bold">{editingId ? '编辑事项' : '添加事项'}</legend>
                <label className="block text-[11px]">事项标题
                  <input name="title" autoFocus required maxLength={200} className="win-input mt-1 w-full p-1.5 text-[12px]" placeholder="要做些什么？" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <label className="min-w-0 flex-1 text-[11px]">日期
                    <input type="date" required min="0001-01-01" max="9999-12-31" className="win-input mt-1 w-full min-w-0 p-1.5" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} />
                  </label>
                  <label className="w-28 text-[11px]">时间（选填）
                    <input type="time" className="win-input mt-1 w-full p-1.5" value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} />
                  </label>
                </div>
                <label className="block text-[11px]">备注（选填）
                  <textarea rows={3} maxLength={10000} className="win-input mt-1 w-full resize-y p-1.5 text-[12px]" placeholder="补充事项详情..." value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} />
                </label>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span>标签（可多选）</span>
                    <button type="button" className="text-[#000080] underline" onClick={() => setShowTagManager(true)}>＋ 新标签</button>
                  </div>
                  {tags.length === 0 ? <p className="text-[10px] text-[#606060]">暂无标签，可先保存事项或添加标签。</p> : (
                    <div className="flex flex-wrap gap-2">
                      {tags.map(tag => (
                        <label key={tag.id} className="flex min-w-0 max-w-full items-center gap-1">
                          <input type="checkbox" checked={draft.tagIds.includes(tag.id)} onChange={event => setDraft({ ...draft, tagIds: event.target.checked ? [...draft.tagIds, tag.id] : draft.tagIds.filter(id => id !== tag.id) })} />
                          <TagBadge tag={tag} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" className="win-button" onClick={() => { setDraft(null); setEditingId(null); setActionError('') }}>取消</button>
                  <button type="submit" className="win-button">{busy ? '保存中...' : '保存事项'}</button>
                </div>
              </fieldset>
            </form>
          )}

          {showTagManager && (
            <section ref={tagManagerRef} className="win-border space-y-2 bg-[#d4d0c8] p-3" aria-label="标签管理">
              <div className="flex items-center justify-between">
                <h3 className="font-bold">标签管理</h3>
                <button className="win-button" aria-label="收起标签管理" onClick={() => setShowTagManager(false)}>×</button>
              </div>
              <form onSubmit={createTag} className="space-y-2">
                <fieldset disabled={busy || !!error} className="space-y-2">
                  <label className="block text-[11px]">标签名称
                    <input required maxLength={30} className="win-input mt-1 w-full p-1.5" placeholder="例如：工作、生活、学习" value={tagName} onChange={event => setTagName(event.target.value)} />
                  </label>
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label="标签颜色">
                    {TAG_COLORS.map(color => (
                      <button key={color.value} type="button" aria-label={color.name} aria-pressed={tagColor === color.value} title={color.name} onClick={() => setTagColor(color.value)}
                        className={`flex h-6 w-6 items-center justify-center border text-white ${tagColor === color.value ? 'outline-1 outline-offset-2 outline-[#000080]' : 'border-white'}`} style={{ backgroundColor: color.value }}>
                        {tagColor === color.value ? '✓' : ''}
                      </button>
                    ))}
                    <button type="submit" className="win-button ml-auto">添加标签</button>
                  </div>
                </fieldset>
              </form>
              {tags.length > 0 && <div className="space-y-1 border-t border-[#808080] pt-2">
                {tags.map(tag => (
                  <div key={tag.id} className="flex items-center justify-between gap-2">
                    <TagBadge tag={tag} />
                    <button className="shrink-0 text-[10px] text-[#a00000] underline" disabled={busy} aria-label={`删除标签 ${tag.name}`} onClick={() => setPendingDelete({ kind: 'tag', id: tag.id, name: tag.name })}>删除</button>
                  </div>
                ))}
              </div>}
            </section>
          )}

          {pendingDelete && (
            <div ref={deletePromptRef} className="win-border space-y-2 bg-[#fff4db] p-3" role="alert">
              <p className="break-words">确定删除{pendingDelete.kind === 'item' ? '事项' : '标签'}「{pendingDelete.name}」？</p>
              <p className="text-[10px] text-[#606060]">{pendingDelete.kind === 'tag' ? '仅移除标签，关联事项仍会保留。' : '删除后无法恢复。'}</p>
              <div className="flex justify-end gap-2">
                <button className="win-button" disabled={busy} onClick={() => setPendingDelete(null)}>取消删除</button>
                <button className="win-button text-[#a00000]" disabled={busy} onClick={confirmDelete}>确认删除</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {dayItems.length === 0 ? (
              <div className="win-inset bg-white px-3 py-8 text-center text-[11px] text-[#606060]">
                <div className="mb-2 text-2xl" aria-hidden="true">📅</div>
                <p>{error ? '日历暂时无法加载' : filterTagId ? '这一天没有符合标签的事项' : '这一天还没有安排'}</p>
                <p className="mt-1 text-[10px]">{error ? '请重新加载后再试。' : '点击「添加事项」，记下接下来的计划。'}</p>
              </div>
            ) : dayItems.map(item => (
              <article key={item.id} className="glass-task-card win-inset space-y-2 bg-white p-3">
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={item.completed} disabled={busy} aria-label={`${item.completed ? '标记未完成' : '完成事项'}：${item.title}`} onChange={() => { void runAction(async () => { await updateItem(item.id, { completed: !item.completed }); setNotice(item.completed ? '已标记为未完成' : '事项已完成') }) }} />
                  <div className="min-w-0 flex-1">
                    <h3 className={`break-words font-bold ${item.completed ? 'text-[#303030] line-through' : ''}`}>{item.title}</h3>
                    <p className="mt-0.5 text-[10px] text-[#606060]">{item.time || '全天'} · {item.completed ? '已完成' : '待完成'}</p>
                  </div>
                </div>
                {item.description && <p className="whitespace-pre-wrap break-words text-[11px] text-[#404040] select-text">{item.description}</p>}
                {item.tagIds.length > 0 && <div className="flex flex-wrap gap-1">{item.tagIds.map(id => { const tag = tagMap.get(id); return tag ? <TagBadge key={id} tag={tag} /> : null })}</div>}
                <div className="flex justify-end gap-3 text-[10px]">
                  <button className="text-[#000080] underline" disabled={busy || !!draft} aria-label={`编辑事项 ${item.title}`} onClick={() => openEditor(item)}>编辑</button>
                  <button className="text-[#a00000] underline" disabled={busy} aria-label={`删除事项 ${item.title}`} onClick={() => setPendingDelete({ kind: 'item', id: item.id, name: item.title })}>删除</button>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>
      <div className="glass-calendar-status min-h-6 shrink-0 border-t border-[#808080] bg-[#d4d0c8] px-2 py-1 text-[10px] text-[#404040]" role="status" aria-live="polite">
        {busy ? '正在保存...' : notice || `共 ${items.length} 个事项 · ${tags.length} 个标签 · 数据保存在本机`}
      </div>
      {dateMenu && (
        <ContextMenu x={dateMenu.x} y={dateMenu.y} onClose={() => setDateMenu(null)} items={[
          { label: '新建当天日记', onClick: () => onCreateDiary(dateMenu.date) },
        ]} />
      )}
    </div>
  )
}
