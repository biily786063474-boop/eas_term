// 画布媒体节点公用工具：扩展名判定 + easfile:// URL 编码（图片 / 动图 / 视频共用）。

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
export const VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'])

const ext = (p: string): string => p.split('.').pop()?.toLowerCase() ?? ''
export const isImagePath = (p: string): boolean => IMAGE_EXTS.has(ext(p))
export const isVideoPath = (p: string): boolean => VIDEO_EXTS.has(ext(p))

/** 绝对路径 → easfile:// 媒体 URL（base64url，避开 URL 转义坑；主进程按白名单流式返回） */
export function easfileUrl(p: string): string {
  const b64 = btoa(unescape(encodeURIComponent(p)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return 'easfile://media/' + b64
}
