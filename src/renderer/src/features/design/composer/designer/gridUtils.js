/**
 * DesignComposer — grid building, color overlay, snap calculation
 */
import { SNAP_DIST, GRID_OPACITY, COLOR_GRID_COLORS } from './constants'

export function buildLayoutGrid(cfg, cw, ch) {
  if (!cfg.gridType) return { lines: [], rects: [], snapX: [], snapY: [] }
  const lines = [], rects = []
  const snapX = [], snapY = []
  const fill = 'rgba(124,106,237,0.06)'
  const stroke = 'rgba(124,106,237,0.25)'

  if (cfg.gridType === 'grid') {
    const sx = cfg.gridSize || 50
    const sy = cfg.gridSizeY || sx
    for (let x = sx; x < cw; x += sx) {
      lines.push({ pts: [x, 0, x, ch], stroke: (x % (sx * 5) === 0) ? 'rgba(124,106,237,0.2)' : 'rgba(124,106,237,0.08)' })
      snapX.push(x)
    }
    for (let y = sy; y < ch; y += sy) {
      lines.push({ pts: [0, y, cw, y], stroke: (y % (sy * 5) === 0) ? 'rgba(124,106,237,0.2)' : 'rgba(124,106,237,0.08)' })
      snapY.push(y)
    }
  } else if (cfg.gridType === 'columns') {
    const cols = cfg.gridColumns || 12
    const margin = cfg.gridMargin ?? 40
    const gutter = cfg.gridGutter ?? 20
    const inner = cw - margin * 2
    const colW = (inner - gutter * (cols - 1)) / cols
    for (let i = 0; i < cols; i++) {
      const x = margin + i * (colW + gutter)
      rects.push({ x, y: 0, w: colW, h: ch, fill })
      lines.push({ pts: [x, 0, x, ch], stroke })
      lines.push({ pts: [x + colW, 0, x + colW, ch], stroke })
      snapX.push(x, x + colW)
    }
    lines.push({ pts: [margin, 0, margin, ch], stroke: 'rgba(124,106,237,0.35)' })
    lines.push({ pts: [cw - margin, 0, cw - margin, ch], stroke: 'rgba(124,106,237,0.35)' })
    snapX.push(margin, cw - margin)
  } else if (cfg.gridType === 'modular') {
    const cols = cfg.gridColumns || 6
    const rows = cfg.gridRows || 6
    const mx = cfg.gridMargin ?? 40
    const my = cfg.gridMargin ?? 40
    const gx = cfg.gridGutter ?? 20
    const gy = cfg.gridRowGutter ?? 20
    const colW = (cw - mx * 2 - gx * (cols - 1)) / cols
    const rowH = cfg.gridRowHeight > 0 ? cfg.gridRowHeight : (ch - my * 2 - gy * (rows - 1)) / rows
    for (let c = 0; c < cols; c++) {
      const x = mx + c * (colW + gx)
      snapX.push(x, x + colW)
      for (let r = 0; r < rows; r++) {
        const y = my + r * (rowH + gy)
        if (c === 0) snapY.push(y, y + rowH)
        rects.push({ x, y, w: colW, h: rowH, fill })
      }
    }
    lines.push({ pts: [mx, 0, mx, ch], stroke })
    lines.push({ pts: [cw - mx, 0, cw - mx, ch], stroke })
    lines.push({ pts: [0, my, cw, my], stroke })
    lines.push({ pts: [0, ch - my, cw, ch - my], stroke })
    snapX.push(mx, cw - mx)
    snapY.push(my, ch - my)
  }

  return { lines, rects, snapX, snapY }
}

export function buildColorGrid(dir, colors, cw, ch) {
  if (!dir) return []
  const [c30, c60, c10] = colors || COLOR_GRID_COLORS
  const opacity = GRID_OPACITY
  if (dir === 'horizontal') {
    const h30 = ch * 0.3, h60 = ch * 0.6, h10 = ch * 0.1
    return [
      { x: 0, y: 0, w: cw, h: h30, fill: c30, opacity },
      { x: 0, y: h30, w: cw, h: h60, fill: c60, opacity },
      { x: 0, y: h30 + h60, w: cw, h: h10, fill: c10, opacity },
    ]
  }
  const w30 = cw * 0.3, w60 = cw * 0.6, w10 = cw * 0.1
  return [
    { x: 0, y: 0, w: w30, h: ch, fill: c30, opacity },
    { x: w30, y: 0, w: w60, h: ch, fill: c60, opacity },
    { x: w30 + w60, y: 0, w: w10, h: ch, fill: c10, opacity },
  ]
}

export function calcSnap(dragBox, others, cw, ch, gridTargets) {
  const { x, y, w, h } = dragBox
  const dPts = {
    x: [x, x + w / 2, x + w],
    y: [y, y + h / 2, y + h],
  }
  const targets = { x: [0, cw / 2, cw], y: [0, ch / 2, ch] }
  for (const o of others) {
    const ox = o.x || 0, oy = o.y || 0, ow = o.width || 100, oh = o.height || 100
    targets.x.push(ox, ox + ow / 2, ox + ow)
    targets.y.push(oy, oy + oh / 2, oy + oh)
  }
  if (gridTargets) {
    targets.x.push(...gridTargets.x)
    targets.y.push(...gridTargets.y)
  }

  let bestDx = 0, bestDy = 0, snapLineX = null, snapLineY = null
  let minDistX = SNAP_DIST
  for (const t of targets.x) {
    for (const d of dPts.x) {
      const dist = Math.abs(t - d)
      if (dist < minDistX) { minDistX = dist; bestDx = t - d; snapLineX = t }
    }
  }
  let minDistY = SNAP_DIST
  for (const t of targets.y) {
    for (const d of dPts.y) {
      const dist = Math.abs(t - d)
      if (dist < minDistY) { minDistY = dist; bestDy = t - d; snapLineY = t }
    }
  }

  const guides = []
  if (snapLineX != null) guides.push({ x: snapLineX, from: -9999, to: 9999 })
  if (snapLineY != null) guides.push({ y: snapLineY, from: -9999, to: 9999 })

  return { dx: bestDx, dy: bestDy, guides }
}

export function hexAlphaToRgba(hex, alpha) {
  const a = alpha ?? 1
  if (a >= 1) return hex
  const r = parseInt(hex.slice(1, 3), 16) || 0
  const g = parseInt(hex.slice(3, 5), 16) || 0
  const b = parseInt(hex.slice(5, 7), 16) || 0
  return `rgba(${r},${g},${b},${a})`
}
