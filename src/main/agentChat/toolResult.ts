import { imageFromBlock, MAX_RESULT_IMAGES, type ChatImage } from '../../shared/chatImages.ts'
/** MCP content 的可读降级；资源只是标识，外部打开仍由 UI 的协议白名单控制。 */
export function normalizeToolContent(content: unknown, fallback: string): {
  output: string
  images?: ChatImage[]
  resources?: { uri: string; name: string; mimeType?: string }[]
} {
  if (!Array.isArray(content)) return { output: fallback }
  const texts: string[] = []
  const images: ChatImage[] = []
  const resources: { uri: string; name: string; mimeType?: string }[] = []
  let recognized = false
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'image') {
      recognized = true
      const image = imageFromBlock(block)
      if (!image) texts.push('[图片未显示：缺少像素、格式无效或超过 2 MiB；支持 PNG/JPEG/GIF/WebP]')
      else if (images.some(x=>x.url===image.url)) continue
      else if (images.length >= MAX_RESULT_IMAGES) texts.push('[图片超过单次 4 张上限，未显示其余图片]')
      else images.push(image)
    } else if (block.type === 'text' && typeof block.text === 'string') {
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
  return { output: recognized ? texts.join('\n') : fallback, ...(images.length ? { images } : {}), ...(resources.length ? { resources } : {}) }
}
