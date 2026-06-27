"use client"

import { IMAGE_MARKDOWN_RE } from '@/lib/images'

interface NoteContentProps {
  content: string
}

/**
 * 渲染笔记正文：把 ![alt](/uploads/...) 形式的图片引用显示为图片，
 * 其余部分保持原有的纯文本（保留空白与换行）展示效果。
 */
export function NoteContent({ content }: NoteContentProps) {
  const parts: Array<{ type: 'text'; value: string } | { type: 'image'; src: string; alt: string }> = []
  let lastIndex = 0
  const re = new RegExp(IMAGE_MARKDOWN_RE.source, 'g')
  let m: RegExpExecArray | null

  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, m.index) })
    }
    parts.push({ type: 'image', alt: m[1], src: m[2] })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) })
  }

  return (
    <div className="text-[12px] font-mono whitespace-pre-wrap leading-relaxed break-words">
      {parts.map((part, i) =>
        part.type === 'image' ? (
          <img
            key={i}
            src={part.src}
            alt={part.alt}
            className="my-2 max-w-full h-auto win-border bg-white"
          />
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </div>
  )
}
