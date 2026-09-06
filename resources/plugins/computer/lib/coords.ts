// computer use 的**坐标换算**。纯函数，零依赖，必须有测试。
//
// 设计稿 §二 B4：坐标是这个功能最容易出错、出错后果最严重的地方 —— 算错不是不动，
// 是**点到别的地方**（最坏落在另一个窗口的危险按钮上）。所以三层缩放全部显式建模：
//
//   ① 逻辑点（point）  —— 用户和系统 API 说的坐标。`screencapture -R`、鼠标点击都用它
//   ② 物理像素        —— 截图的原始输出。2026-09-06 本机实测：`-R0,0,100,100` 出 200×200 PNG，
//                        全屏 1147×745 点 → 2294×1490 像素，scaleFactor = 2
//   ③ 存盘图片        —— 我们还会把图缩到长边 ≤1280（设计稿 §三 决定 6，省上下文）
//
// 模型看到的是 ③，它给出的坐标必须一路换算回 ①。任何一层漏了，偏移都是成倍的。

export interface DisplayInfo {
  id: number
  /** 逻辑边界（点）。多屏时 x/y 可能为负（副屏在主屏左边/上边） */
  bounds: { x: number; y: number; width: number; height: number }
  /** 物理像素 ÷ 逻辑点。Retina 通常是 2 */
  scaleFactor: number
}

/** 一张截图的完整几何：从「模型看到的像素」回到「屏幕逻辑点」需要的全部信息 */
export interface ShotGeometry {
  display: DisplayInfo
  /** 截的是逻辑坐标系里的哪一块（点）。全屏时等于 display.bounds */
  region: { x: number; y: number; width: number; height: number }
  /** 存盘图片的真实像素尺寸（已经过缩放） */
  image: { width: number; height: number }
}

export interface Pt {
  x: number
  y: number
}

export type CoordResult = { ok: true; pt: Pt } | { ok: false; error: string }

/** 缩图目标尺寸：长边不超过 maxEdge，等比，至少 1×1。不放大（图本来就小就原样）。 */
export function fitTo(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 }
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) }
  const k = maxEdge / longest
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/**
 * 模型在图上给的**像素**坐标 → 屏幕**逻辑点**。
 *
 * 越界一律报错，**不做钳制** —— 钳到边缘会让「模型算错了」变成「点到了屏幕角落的某个东西」，
 * 那是设计稿 §三 决定 8 说的「报错而不是静默不动」。
 */
export function imageToScreen(pt: Pt, geo: ShotGeometry): CoordResult {
  const { image, region } = geo
  if (!(image.width > 0) || !(image.height > 0)) return { ok: false, error: '截图尺寸无效' }
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return { ok: false, error: '坐标不是数字' }
  if (pt.x < 0 || pt.y < 0 || pt.x > image.width || pt.y > image.height)
    return { ok: false, error: `坐标 (${pt.x}, ${pt.y}) 超出这张截图 ${image.width}×${image.height}` }
  // 图片像素 → 区域内的相对比例 → 区域的逻辑点
  const x = region.x + (pt.x / image.width) * region.width
  const y = region.y + (pt.y / image.height) * region.height
  return { ok: true, pt: { x: Math.round(x), y: Math.round(y) } }
}

/** 屏幕逻辑点 → 图上像素（面板画「刚点了这里」的标记用）。越界同样报错。 */
export function screenToImage(pt: Pt, geo: ShotGeometry): CoordResult {
  const { image, region } = geo
  if (!(region.width > 0) || !(region.height > 0)) return { ok: false, error: '截图区域无效' }
  if (pt.x < region.x || pt.y < region.y || pt.x > region.x + region.width || pt.y > region.y + region.height)
    return { ok: false, error: '这个点不在这张截图的范围里' }
  return {
    ok: true,
    pt: {
      x: Math.round(((pt.x - region.x) / region.width) * image.width),
      y: Math.round(((pt.y - region.y) / region.height) * image.height)
    }
  }
}

/** 逻辑点落在哪个显示器上。**多屏坐标可能是负的**，所以只能靠 bounds 判，不能靠正负号。 */
export function findDisplay(pt: Pt, displays: readonly DisplayInfo[]): DisplayInfo | null {
  for (const d of displays) {
    const b = d.bounds
    if (pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height) return d
  }
  return null
}

/**
 * 一次动作前的最后一道关：这个逻辑点能不能点。
 * 没有显示器、点在所有显示器之外，都要**明确说出来**而不是默默不动。
 */
export function validateClick(pt: Pt, displays: readonly DisplayInfo[]): CoordResult {
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return { ok: false, error: '坐标不是数字' }
  if (!displays.length) return { ok: false, error: '没有可用的显示器（睡眠或锁屏？）' }
  const d = findDisplay(pt, displays)
  if (!d) {
    const desc = displays.map((x) => `#${x.id} ${x.bounds.x},${x.bounds.y} ${x.bounds.width}×${x.bounds.height}`).join('；')
    return { ok: false, error: `坐标 (${pt.x}, ${pt.y}) 不在任何显示器内。当前显示器：${desc}` }
  }
  return { ok: true, pt: { x: Math.round(pt.x), y: Math.round(pt.y) } }
}

/** 物理像素 ↔ 逻辑点（只在跟系统 API 打交道时用；模型永远只看逻辑点与图片像素） */
export const toPixels = (p: number, scaleFactor: number): number => Math.round(p * scaleFactor)
export const toPoints = (px: number, scaleFactor: number): number => Math.round(px / scaleFactor)
