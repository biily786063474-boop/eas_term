// 画布媒体节点公用工具：扩展名判定 + easfile:// URL 编码（图片 / 动图 / 视频共用）。

import type { PaneState } from '../../layout'
import { fileUrlOf } from '../../store/shared'

// 扩展名判定搬去了 mediaExts.ts（零 import，能单测）——这里原样 re-export，
// 现有 import 一个都不用改。
export {
  IMAGE_EXTS,
  VIDEO_EXTS,
  AUDIO_EXTS,
  MODEL_EXTS,
  isImagePath,
  isVideoPath,
  isAudioPath,
  isModelPath,
  isMediaPath
} from './mediaExts'
import { IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, MODEL_EXTS } from './mediaExts'

const ext = (p: string): string => p.split('.').pop()?.toLowerCase() ?? ''

/** .html/.htm —— 唯一一种「两种看法都合理」的文件：既能渲染成页面，也能看源码。
 *  所以用户手动拖/挑它进画布时要问一句，不能替他定。 */
export const isHtmlPath = (p: string): boolean => {
  const e = ext(p)
  return e === 'html' || e === 'htm'
}

/**
 * 文件路径 → 画布节点的 pane。
 *
 * `as` 是给 .html 用的显式选择：`'web'` 渲染成页面、`'code'` 看源码。
 * 不传的话 .html 仍按渲染走 —— **那是给程序调用方保底的**（MCP 的
 * `canvas_open_html` / `canvas_open_file` 自己就说清了要哪种），
 * 用户手动拖进来的那几条路径必须先问，见 HtmlOpenChoice。
 */
export function paneForFile(path: string, as?: 'web' | 'code'): PaneState {
  const e = ext(path)
  if (e === 'html' || e === 'htm') {
    return as === 'code' ? { kind: 'code', filePath: path } : { kind: 'web', url: fileUrlOf(path) }
  }
  // 图片 / 动图(gif,webp) / 视频 / 音频 / 3D 模型 都归 image 型媒体节点，由 CanvasFileNode 按扩展名
  // 分流渲染（视频 → <video>、音频 → <audio>、.glb → 3D 查看器、其余 → 图查看器）。复用 image 型
  // 是刻意的：和视频一路，data-kind 只挑 CSS 色相、不参与逻辑，新增一种 kind 反而要动更多地方。
  if (IMAGE_EXTS.has(e) || VIDEO_EXTS.has(e) || AUDIO_EXTS.has(e) || MODEL_EXTS.has(e)) return { kind: 'image', filePath: path }
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
