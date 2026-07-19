// 剪贴板读写：优先用异步 Clipboard API，失败时回退到 execCommand，
// 让复制/剪切/粘贴在浏览器和桌面 WebView 里都尽量可用。

/** 把文本写入剪贴板，返回是否成功。 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 回退：隐藏 textarea + execCommand('copy')
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      ta.setAttribute('readonly', '')
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export interface ClipboardContent {
  text: string
  images: File[]
}

/** 读取剪贴板，同时尝试拿到文本和图片。任一失败都会安全降级。 */
export async function readClipboard(): Promise<ClipboardContent> {
  const result: ClipboardContent = { text: '', images: [] }
  // 先尝试富内容（可能含图片）
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type)
          const ext = type.split('/')[1] || 'png'
          result.images.push(new File([blob], `pasted.${ext}`, { type }))
        } else if (type === 'text/plain' && !result.text) {
          result.text = await (await item.getType(type)).text()
        }
      }
    }
    if (result.images.length || result.text) return result
  } catch {
    // 不支持 read() 或无权限：退回纯文本读取
  }
  try {
    result.text = await navigator.clipboard.readText()
  } catch {
    // 读取失败（无权限/不支持）：返回空，调用方据此提示
  }
  return result
}
