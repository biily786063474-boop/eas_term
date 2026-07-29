// 画布媒体节点公用工具：扩展名判定 + easfile:// URL 编码（图片 / 动图 / 视频共用）。

import type { PaneState } from '../../layout'
import { fileUrlOf } from '../../store/shared'

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
export const VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'])

const ext = (p: string): string => p.split('.').pop()?.toLowerCase() ?? ''
export const isImagePath = (p: string): boolean => IMAGE_EXTS.has(ext(p))
export const isVideoPath = (p: string): boolean => VIDEO_EXTS.has(ext(p))

/** 文件路径 → 画布节点的 pane（.html 走内嵌浏览器，图片/视频走媒体节点，其余按代码预览） */
export function paneForFile(path: string): PaneState {
  const e = ext(path)
  if (e === 'html' || e === 'htm') return { kind: 'web', url: fileUrlOf(path) }
  // 图片 / 动图(gif,webp) / 视频 都归 image 型媒体节点，由 CanvasFileNode 按扩展名分流渲染
  if (IMAGE_EXTS.has(e) || VIDEO_EXTS.has(e)) return { kind: 'image', filePath: path }
  return { kind: 'code', filePath: path }
}

/** 绝对路径 → easfile:// 媒体 URL（base64url，避开 URL 转义坑；主进程按白名单流式返回） */
export function easfileUrl(p: string): string {
  const b64 = btoa(unescape(encodeURIComponent(p)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return 'easfile://media/' + b64
}
