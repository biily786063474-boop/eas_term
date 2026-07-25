/**
 * precompRender.js — UC 预合成产物渲染(2026-06-05 UC→VC 直连 Phase 1)
 *
 * 在 Composer 关闭后、React 之外执行(App.jsx 集成层调用,不依赖 UC mounted):
 *   _unifiedState → rebuildMotionFromDesign(最新 design 重建 motion layers)
 *   → 静态(无动效)= renderFrame(t=0, 透明底) → PNG(带 alpha,瞬时)
 *   → 有动效        = exportMotion(透明底)     → WebM VP9/VP8 alpha(wall-clock 1:1)
 *
 * ❗ 本模块只产 blob,不写节点(Composer 红区:禁 import 画布 store)——
 *    saveMedia / updateNode 由调用方(App.jsx)负责。
 *
 * 规划文档:docs/UC_VC_PRECOMP_PLAN.md
 */
import { rebuildMotionFromDesign } from './rebuildMotion'
import { renderFrame, preloadMedia } from './animate/renderer'
import { exportMotion } from './animate/exporter'

/** 递归判定 motion layers 是否含真动效(任意 prop kfs≥2 或任一预设挂载)。 */
export function hasMotionContent(layers) {
  if (!Array.isArray(layers)) return false
  for (const l of layers) {
    if (l?.presets && (l.presets.enter || l.presets.continuous || l.presets.exit)) return true
    const kfs = l?.keyframes || {}
    for (const prop of Object.keys(kfs)) {
      if (Array.isArray(kfs[prop]) && kfs[prop].length >= 2) return true
    }
    if (Array.isArray(l?.children) && hasMotionContent(l.children)) return true
  }
  return false
}

/**
 * 渲染预合成产物。
 * @param {object} unifiedState node._unifiedState({ designState, motionState })
 * @returns {Promise<{ blob: Blob, hasMotion: boolean, duration: number } | null>}
 *          null = 内容为空(无 objects),调用方应清产物字段
 */
export async function renderPrecompArtifact(unifiedState) {
  const designState = unifiedState?.designState
  if (!designState?.objects?.length) return null

  // 按最新 design 重建(用户可能只在 design 模式改完直接关,motionState 落后)
  const motion = rebuildMotionFromDesign(unifiedState?.motionState || null, designState)
  if (!motion?.layers?.length) return null

  const w = Math.max(2, Math.round(motion.canvasWidth || 1920))
  const h = Math.max(2, Math.round(motion.canvasHeight || 1080))
  const withMotion = hasMotionContent(motion.layers)

  if (!withMotion) {
    // ── 静态:t=0 渲一帧 → PNG(canvas 默认透明底;bg='transparent' 跳过填底)──
    await preloadMedia(motion.layers)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    renderFrame(ctx, motion.layers, 0, w, h, 'transparent')
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('PNG 编码失败')
    return { blob, hasMotion: false, duration: 0 }
  }

  // ── 动效:既有 exportMotion(透明底强制,VP9/VP8 alpha WebM)──
  const duration = motion.duration || 5
  const blob = await exportMotion({
    layers: motion.layers,
    canvasWidth: w,
    canvasHeight: h,
    backgroundColor: 'transparent',     // 覆盖 store 值不写回(uc-precomp 既有协议)
    fps: motion.fps || 30,
    duration,
  })
  if (!blob) throw new Error('动效渲染失败')
  return { blob, hasMotion: true, duration }
}
