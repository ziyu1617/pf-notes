// 后端在流式过程中出错时发来的哨兵标记（必须与 api.py 的 STREAM_ERROR_SENTINEL 逐字节一致）。
// 用私有区字符 U+E001 包裹，正常回复绝不会包含它；一旦出现，说明这次回复失败了。
export const STREAM_ERROR_SENTINEL = 'STREAM_ERROR'

// 以流式方式 POST 并逐块读取纯文本响应。
// onChunk 每次收到的是「累计到目前为止」的可见文本（已剔除错误哨兵），便于直接渲染。
// 若流以错误哨兵结束，则在读完后抛出错误，交由调用方的 catch 处理（不会把错误文本当成回复）。
// 传入 signal 可在组件卸载等场景中止请求。
export async function streamPost(
  url: string,
  body: unknown,
  onChunk: (accumulated: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let acc = ''
  let errored = false

  const emit = () => {
    let visible = acc
    const idx = visible.indexOf(STREAM_ERROR_SENTINEL)
    if (idx !== -1) {
      errored = true
      visible = visible.slice(0, idx) // 只渲染哨兵之前的真实内容
    }
    onChunk(visible)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    acc += decoder.decode(value, { stream: true })
    emit()
  }
  acc += decoder.decode() // flush 残留的多字节字符
  emit()

  if (errored) throw new Error('AI_STREAM_ERROR')
}
