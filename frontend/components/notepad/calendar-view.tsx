"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Loader2, NotebookPen, Pencil, Plus, SlidersHorizontal, Tags, Trash2, X } from 'lucide-react'
import { useCalendar, type CalendarItem, type CalendarItemInput, type CalendarTag } from '@/hooks/use-calendar'
import type { Note } from '@/hooks/use-notes'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const TAG_COLORS = [
  { value: '#526e63', name: '鼠尾草绿' },
  { value: '#6c88a1', name: '雾蓝' },
  { value: '#b08b59', name: '暖金' },
  { value: '#8974a5', name: '薰衣草紫' },
  { value: '#bc768a', name: '玫瑰粉' },
  { value: '#86916a', name: '橄榄绿' },
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
    <span className="calendar-tag-badge">
      <span className="calendar-tag-dot" style={{ backgroundColor: tag.color }} />
      <span className="truncate">{tag.name}</span>
    </span>
  )
}

export function CalendarView({ notes }: { notes: Note[] }) {
  const { items, tags, isLoaded, error, reload, addItem, updateItem, deleteItem, addTag, deleteTag } = useCalendar()
  const today = dateKey(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const diaryDates = useMemo(() => {
    const dates = new Set<string>()
    for (const note of notes) {
      // SQLite timestamps are local time; normalize the separator for WebKit.
      const createdAt = new Date(note.createdAt.replace(' ', 'T'))
      if (!Number.isNaN(createdAt.getTime())) dates.add(dateKey(createdAt))
    }
    return dates
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
    if (showTagManager) tagManagerRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [showTagManager])

  useEffect(() => {
    if (pendingDelete) deletePromptRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
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
  const monthItems = items.filter(item => item.date.startsWith(month) && (!filterTagId || item.tagIds.includes(filterTagId)))

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
    setMonth(dateKey(next).slice(0, 7))
    setSelectedDate(dateKey(next))
  }

  function selectDay(value: string) {
    if (value < '0001-01-01' || value > '9999-12-31') return
    setSelectedDate(value)
    setMonth(value.slice(0, 7))
  }

  function openEditor(item?: CalendarItem) {
    setEditingId(item?.id ?? null)
    setDraft(item ? {
      title: item.title, description: item.description, date: item.date, time: item.time, tagIds: [...item.tagIds],
    } : { title: '', description: '', date: selectedDate, time: '', tagIds: filterTagId ? [filterTagId] : [] })
    setActionError('')
    setNotice('')
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
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
    return <div className="calendar-loading glass-card" role="status"><Loader2 size={24} aria-hidden="true" /><span>正在加载日历...</span></div>
  }

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <div className="calendar-filter">
          <SlidersHorizontal size={15} aria-hidden="true" />
          <label htmlFor="calendar-filter">标签筛选</label>
          <select id="calendar-filter" aria-label="标签筛选" className="glass-input calendar-filter-select" value={filterTagId} onChange={event => setFilterTagId(event.target.value)}>
            <option value="">全部标签</option>
            {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
        </div>
        <button className={`glass-button calendar-manage-button ${showTagManager ? 'is-active' : ''}`} aria-expanded={showTagManager} onClick={() => setShowTagManager(value => !value)}>
          <Tags size={15} aria-hidden="true" />管理标签
        </button>
      </div>

      {(error || actionError) && (
        <div className="calendar-error" role="alert">
          <span>{actionError || error}</span>
          {error && <button className="glass-button" disabled={busy} onClick={() => { void reload() }}>重新加载</button>}
        </div>
      )}

      <div className="calendar-main">
        <section className="calendar-month glass-card" aria-label="月历">
          <div className="calendar-month-header">
            <div>
              <h2>{parseDate(`${month}-01`).getFullYear()} 年 {Number(month.slice(5))} 月</h2>
              <p>{monthItems.length} 个事项<span>·</span>已完成 {monthItems.filter(item => item.completed).length} 个{filterTagId ? '（已筛选）' : ''}</p>
            </div>
            <div className="calendar-month-controls">
              <button className="glass-button calendar-today-button" onClick={() => selectDay(dateKey(new Date()))}>今天</button>
              <div className="calendar-month-arrows">
                <button className="glass-icon-button" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
                <button className="glass-icon-button" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={18} aria-hidden="true" /></button>
              </div>
            </div>
          </div>
          <div className="calendar-weekdays">
            {WEEKDAYS.map((day, index) => <div key={day} className={index > 4 ? 'is-weekend' : ''}>周{day}</div>)}
          </div>
          <div className="calendar-grid">
            {days.map(({ key, day }) => {
              const entries = itemsByDate.get(key) ?? []
              const selected = key === selectedDate
              const inMonth = key.startsWith(month)
              const hasDiary = diaryDates.has(key)
              return (
                <button key={key} type="button" aria-label={`${key}，${entries.length} 个事项${hasDiary ? '，已写日记' : ''}${key === today ? '，今天' : ''}`} aria-pressed={selected} aria-current={key === today ? 'date' : undefined}
                  onClick={() => selectDay(key)}
                  className={`calendar-day ${hasDiary ? 'has-diary' : ''} ${selected ? 'is-selected' : ''} ${inMonth ? '' : 'is-outside'} ${key === today ? 'is-today' : ''}`}>
                  <div className="calendar-day-top">
                    <span className="calendar-day-number">{day}</span>
                    {entries.length > 0 && <span className="calendar-day-count">{entries.length}</span>}
                  </div>
                  <div className="calendar-day-entries">
                    {entries.slice(0, 2).map(item => (
                      <div key={item.id} className={`calendar-day-entry ${item.completed ? 'is-completed' : ''}`} style={{ borderLeftColor: tagMap.get(item.tagIds[0])?.color ?? '#819087' }}>
                        {item.completed ? '✓ ' : item.time ? `${item.time} ` : ''}{item.title}
                      </div>
                    ))}
                    {entries.length > 2 && <div className="calendar-day-more">+{entries.length - 2} 项</div>}
                  </div>
                </button>
              )
            })}
          </div>
          <div className="calendar-legend">
            <span><i className="calendar-legend-diary" aria-hidden="true" />已写日记</span>
            <span><i className="calendar-legend-selected" aria-hidden="true" />选中日期</span>
            <span><i className="calendar-legend-today" aria-hidden="true" />今天</span>
          </div>
        </section>

        <aside className="calendar-agenda" aria-label="当日事项">
          <div className="calendar-agenda-heading">
            <div>
              <span className="calendar-eyebrow">当日安排</span>
              <h2>{dateLabel(selectedDate)}</h2>
              <p>{dayItems.length} 个事项<span>·</span>{dayItems.filter(item => !item.completed).length} 个待完成{filterTagId ? '（已筛选）' : ''}</p>
            </div>
            <button className="glass-button-primary calendar-add-button" disabled={busy || !!draft || !!error} onClick={() => openEditor()}>
              <Plus size={15} aria-hidden="true" /><span>添加事项</span>
            </button>
          </div>

          {draft && (
            <form ref={formRef} onSubmit={saveItem} className="calendar-editor calendar-inline-panel glass-card" aria-label={editingId ? '编辑事项' : '添加事项'}>
              <fieldset disabled={busy}>
                <legend><NotebookPen size={17} aria-hidden="true" />{editingId ? '编辑事项' : '添加事项'}</legend>
                <label className="calendar-field">事项标题
                  <input name="title" autoFocus required maxLength={200} className="glass-input" placeholder="要做些什么？" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
                </label>
                <div className="calendar-date-fields">
                  <label className="calendar-field">日期
                    <input type="date" required min="0001-01-01" max="9999-12-31" className="glass-input" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} />
                  </label>
                  <label className="calendar-field">时间<span className="calendar-field-hint">选填</span>
                    <input type="time" className="glass-input" value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} />
                  </label>
                </div>
                <label className="calendar-field">备注<span className="calendar-field-hint">选填</span>
                  <textarea rows={3} maxLength={10000} className="glass-input" placeholder="补充事项详情..." value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} />
                </label>
                <div className="calendar-field">
                  <div className="calendar-field-heading">
                    <span>标签<span className="calendar-field-hint">可多选</span></span>
                    <button type="button" className="calendar-text-button" onClick={() => setShowTagManager(true)}><Plus size={13} aria-hidden="true" />新标签</button>
                  </div>
                  {tags.length === 0 ? <p className="calendar-help">暂无标签，可先保存事项或添加标签。</p> : (
                    <div className="calendar-tag-options">
                      {tags.map(tag => (
                        <label key={tag.id} className={`calendar-tag-option ${draft.tagIds.includes(tag.id) ? 'is-selected' : ''}`}>
                          <input type="checkbox" checked={draft.tagIds.includes(tag.id)} onChange={event => setDraft({ ...draft, tagIds: event.target.checked ? [...draft.tagIds, tag.id] : draft.tagIds.filter(id => id !== tag.id) })} />
                          <TagBadge tag={tag} />
                          {draft.tagIds.includes(tag.id) && <Check size={12} aria-hidden="true" />}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="calendar-panel-actions">
                  <button type="button" className="glass-button" onClick={() => { setDraft(null); setEditingId(null); setActionError('') }}>取消</button>
                  <button type="submit" className="glass-button-primary">{busy ? '保存中...' : '保存事项'}</button>
                </div>
              </fieldset>
            </form>
          )}

          {showTagManager && (
            <section ref={tagManagerRef} className="calendar-tag-manager calendar-inline-panel glass-card" aria-label="标签管理">
              <div className="calendar-panel-heading">
                <h3><Tags size={17} aria-hidden="true" />标签管理</h3>
                <button className="glass-icon-button" aria-label="收起标签管理" onClick={() => setShowTagManager(false)}><X size={16} aria-hidden="true" /></button>
              </div>
              <form onSubmit={createTag}>
                <fieldset disabled={busy || !!error}>
                  <label className="calendar-field">标签名称
                    <input required maxLength={30} className="glass-input" placeholder="例如：工作、生活、学习" value={tagName} onChange={event => setTagName(event.target.value)} />
                  </label>
                  <div className="calendar-color-row">
                    <div className="calendar-color-options" role="group" aria-label="标签颜色">
                      {TAG_COLORS.map(color => (
                        <button key={color.value} type="button" aria-label={color.name} aria-pressed={tagColor === color.value} title={color.name} onClick={() => setTagColor(color.value)}
                          className={`calendar-color-option ${tagColor === color.value ? 'is-selected' : ''}`} style={{ backgroundColor: color.value }}>
                          {tagColor === color.value && <Check size={13} aria-hidden="true" />}
                        </button>
                      ))}
                    </div>
                    <button type="submit" className="glass-button">添加标签</button>
                  </div>
                </fieldset>
              </form>
              {tags.length > 0 && <div className="calendar-managed-tags">
                {tags.map(tag => (
                  <div key={tag.id} className="calendar-managed-tag">
                    <TagBadge tag={tag} />
                    <button className="glass-icon-button calendar-danger-button" disabled={busy} aria-label={`删除标签 ${tag.name}`} onClick={() => setPendingDelete({ kind: 'tag', id: tag.id, name: tag.name })}><Trash2 size={14} aria-hidden="true" /></button>
                  </div>
                ))}
              </div>}
            </section>
          )}

          {pendingDelete && (
            <div ref={deletePromptRef} className="calendar-delete-prompt calendar-inline-panel" role="alert">
              <p>确定删除{pendingDelete.kind === 'item' ? '事项' : '标签'}「{pendingDelete.name}」？</p>
              <p className="calendar-help">{pendingDelete.kind === 'tag' ? '仅移除标签，关联事项仍会保留。' : '删除后无法恢复。'}</p>
              <div className="calendar-panel-actions">
                <button className="glass-button" disabled={busy} onClick={() => setPendingDelete(null)}>取消删除</button>
                <button className="glass-button calendar-danger-button" disabled={busy} onClick={confirmDelete}>确认删除</button>
              </div>
            </div>
          )}

          <div className="calendar-agenda-list">
            {dayItems.length === 0 ? (
              <div className="calendar-empty glass-card">
                <div className="calendar-empty-icon" aria-hidden="true"><CalendarDays size={29} strokeWidth={1.4} /><span><Check size={12} /></span></div>
                <p>{error ? '日历暂时无法加载' : filterTagId ? '这一天没有符合标签的事项' : '这一天还没有安排'}</p>
                <p>{error ? '请重新加载后再试。' : '记下一件小事，让计划从这里开始。'}</p>
                {!draft && !error && <button className="calendar-text-button" disabled={busy} onClick={() => openEditor()}><Plus size={14} aria-hidden="true" />添加事项</button>}
              </div>
            ) : dayItems.map(item => (
              <article key={item.id} className={`calendar-agenda-item glass-card ${item.completed ? 'is-completed' : ''}`}>
                <div className="calendar-item-heading">
                  <label className="calendar-complete-control">
                    <input type="checkbox" checked={item.completed} disabled={busy} aria-label={`${item.completed ? '标记未完成' : '完成事项'}：${item.title}`} onChange={() => { void runAction(async () => { await updateItem(item.id, { completed: !item.completed }); setNotice(item.completed ? '已标记为未完成' : '事项已完成') }) }} />
                    <span><Check size={12} strokeWidth={2.5} aria-hidden="true" /></span>
                  </label>
                  <div className="calendar-item-title">
                    <h3>{item.title}</h3>
                    <p><Clock3 size={12} aria-hidden="true" />{item.time || '全天'}<span>·</span>{item.completed ? '已完成' : '待完成'}</p>
                  </div>
                </div>
                {item.description && <p className="calendar-item-description">{item.description}</p>}
                {item.tagIds.length > 0 && <div className="calendar-item-tags">{item.tagIds.map(id => { const tag = tagMap.get(id); return tag ? <TagBadge key={id} tag={tag} /> : null })}</div>}
                <div className="calendar-item-actions">
                  <button className="calendar-text-button" disabled={busy || !!draft} aria-label={`编辑事项 ${item.title}`} onClick={() => openEditor(item)}><Pencil size={13} aria-hidden="true" />编辑</button>
                  <button className="calendar-text-button calendar-danger-button" disabled={busy} aria-label={`删除事项 ${item.title}`} onClick={() => setPendingDelete({ kind: 'item', id: item.id, name: item.title })}><Trash2 size={13} aria-hidden="true" />删除</button>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>
      <div className="calendar-status" role="status" aria-live="polite">
        {busy ? <Loader2 size={13} className="calendar-saving-icon" aria-hidden="true" /> : notice ? <CheckCircle2 size={13} aria-hidden="true" /> : <span className="calendar-status-dot" aria-hidden="true" />}
        {busy ? '正在保存...' : notice || `共 ${items.length} 个事项 · ${tags.length} 个标签 · 数据保存在本机`}
      </div>
    </div>
  )
}
