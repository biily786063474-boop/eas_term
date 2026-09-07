/** MCP content 的可读降级；资源只是标识，外部打开仍由 UI 的协议白名单控制。 */
export function normalizeToolContent(content: unknown, fallback: string): {
  output: string
  resources?: { uri: string; name: string; mimeType?: string }[]
} {
  if (!Array.isArray(content)) return { output: fallback }
  const texts: string[] = []
  const resources: { uri: string; name: string; mimeType?: string }[] = []
  let recognized = false
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      recognized = true
      texts.push(block.text)
    } else if (block.type === 'resource_link' || block.type === 'resource') {
      const r = block.type === 'resource' ? block.resource : block
      if (!r || typeof r !== 'object' || typeof r.uri !== 'string') continue
      recognized = true
      const name = typeof r.name === 'string' && r.name ? r.name : r.uri
      texts.push(typeof r.text === 'string' ? r.text : `${name}${name === r.uri ? '' : ` (${r.uri})`}`)
      try {
        const url = new URL(r.uri)
        if (!['http:', 'https:', 'ui:'].includes(url.protocol) || url.username || url.password) continue
        if (!resources.some((entry) => entry.uri === r.uri)) {
          resources.push({ uri: r.uri, name, ...(typeof r.mimeType === 'string' ? { mimeType: r.mimeType } : {}) })
        }
      } catch { /* 非 URL 资源仍保留文本，不作为入口 */ }
    } else {
      // 图像、音频与未来类型仍保留原始降级信息，不悄悄吞掉。
      texts.push(JSON.stringify(block))
    }
  }
  return { output: recognized ? texts.join('\n') : fallback, ...(resources.length ? { resources } : {}) }
}
