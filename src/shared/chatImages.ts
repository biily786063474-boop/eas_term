/** 返回图片只接受内联栅格像素：不读取模型指定路径，不自动请求远端 URL。 */
export interface ChatImage { url: string; mimeType: string }
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_RESULT_IMAGES = 4
export const MAX_HISTORY_IMAGE_CHARS = 8 * 1024 * 1024
const signatures: Record<string, RegExp> = {
  'image/png': /^iVBORw0KGgo/,
  'image/jpeg': /^\/9j\//,
  'image/gif': /^R0lGOD[dl]/,
  'image/webp': /^UklGR/
}
export function imageFromBlock(value: unknown): ChatImage | null {
  if (!value || typeof value !== 'object') return null
  const b = value as Record<string, unknown>
  const source = b.source && typeof b.source === 'object' ? b.source as Record<string, unknown> : b
  const mime = source.mimeType ?? source.media_type
  const data = source.data
  if (typeof mime !== 'string' || !Object.hasOwn(signatures, mime) || typeof data !== 'string') return null
  if (!data.length || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || data.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || !signatures[mime].test(data)) return null
  const bytes = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
  if (bytes > MAX_IMAGE_BYTES) return null
  return { mimeType: mime, url: 'data:' + mime + ';base64,' + data }
}
/** 历史与 renderer 边界重验，旧记录/被修改的记录不能引入外链。 */
export function safeChatImages(value: unknown): ChatImage[] {
  if (!Array.isArray(value)) return []
  const images: ChatImage[] = []
  for (const im of value.slice(0, MAX_RESULT_IMAGES)) {
    if (!im || typeof im.url !== 'string' || typeof im.mimeType !== 'string') continue
    const prefix = 'data:' + im.mimeType + ';base64,'
    if (!im.url.startsWith(prefix)) continue
    const checked = imageFromBlock({mimeType:im.mimeType,data:im.url.slice(prefix.length)})
    if (checked && !images.some(x=>x.url===checked.url)) images.push(checked)
  }
  return images
}
