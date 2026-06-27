// 笔记里的图片以 Markdown 图片语法 ![alt](url) 形式内嵌在正文中，
// 图片本身上传到后端、正文只保留一个简短的引用，便于存储与 AI 处理。

export const IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\((\/uploads\/[^\s)]+)\)/g

/** 上传一张图片，返回可直接放进正文的 Markdown 引用，例如 ![image](/uploads/xxx.png)。 */
export async function uploadImageAsMarkdown(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: form })
  if (!res.ok) {
    let detail = '上传失败'
    try {
      detail = (await res.json()).detail || detail
    } catch {}
    throw new Error(detail)
  }
  const { url } = await res.json()
  return `![image](${url})`
}

/** 把正文里的图片引用替换成简短占位符，用于纯文本预览（列表/搜索/目录）。 */
export function stripImageMarkdown(text: string): string {
  return text.replace(IMAGE_MARKDOWN_RE, '[图片]')
}

/** 从 DataTransfer（粘贴/拖拽）里取出所有图片文件。 */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  // 部分浏览器拖拽时只填充 files、不填充 items
  if (files.length === 0) {
    for (const f of Array.from(data.files)) {
      if (f.type.startsWith('image/')) files.push(f)
    }
  }
  return files
}
