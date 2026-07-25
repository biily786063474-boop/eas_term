/**
 * MotionComposer — keyframe-based Canvas 2D renderer
 * Interpolates between keyframes per property, draws each layer.
 * After interpolation, an optional preset filter layer is applied
 * (see presetEngine.js) to add packaged enter/continuous/exit motion.
 */
import { applyPresetDelta, applyCharPresetDelta, needsCharRendering } from './presetEngine'

// ── Easing functions ──
export const EASINGS = {
  linear:    t => t,
  easeIn:    t => t * t * t,
  easeOut:   t => 1 - (1 - t) ** 3,
  easeInOut: t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  spring:    t => 1 - Math.cos(t * Math.PI * 2.5) * Math.exp(-6 * t),
  // hold(持续帧):区间内保持 a 值,到达 b 时跳变(右键菜单选项)
  hold:      t => t < 1 ? 0 : 1,
}

/** 预设 → bezier 4 参表(把 5 个预设映射到 cubic bezier 控制点,graph mode 拖手柄从这里起步)*/
export const EASING_TO_BEZIER = {
  linear:    [0,    0,    1,    1   ],
  easeIn:    [0.42, 0,    1,    1   ],
  easeOut:   [0,    0,    0.58, 1   ],
  easeInOut: [0.42, 0,    0.58, 1   ],
  spring:    [0.34, 1.56, 0.64, 1.0 ], // 过冲
}

/** 用 Newton 迭代求 cubic-bezier 在 t 处使 x(t) = target 的 t 值,然后返回 y(t) */
function cubicBezier(x1, y1, x2, y2, x) {
  // 求 t 使 X(t) = x;X(t) = 3(1-t)^2 t x1 + 3(1-t) t^2 x2 + t^3
  // 用 Newton-Raphson 8 次迭代
  const sampleCurveX = (t) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3
  const sampleCurveY = (t) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3
  const sampleDerivX = (t) => 3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2)
  let t = x
  for (let i = 0; i < 8; i++) {
    const cx = sampleCurveX(t) - x
    if (Math.abs(cx) < 1e-5) return sampleCurveY(t)
    const d = sampleDerivX(t)
    if (Math.abs(d) < 1e-6) break
    t -= cx / d
  }
  // fallback 二分
  let lo = 0, hi = 1
  for (let i = 0; i < 20; i++) {
    t = (lo + hi) / 2
    const cx = sampleCurveX(t)
    if (Math.abs(cx - x) < 1e-4) break
    if (cx < x) lo = t; else hi = t
  }
  return sampleCurveY(t)
}

/** 解析 easing 字段返回 (progress: 0~1) → eased: 0~1 函数
 *  - string:查 EASINGS 表
 *  - array [x1,y1,x2,y2]:cubic-bezier
 *  - 默认 easeOut
 */
function resolveEasing(easing) {
  if (Array.isArray(easing) && easing.length === 4) {
    const [x1, y1, x2, y2] = easing
    return (t) => cubicBezier(x1, y1, x2, y2, t)
  }
  return EASINGS[easing] || EASINGS.easeOut
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ── Keyframe interpolation ──
// Given sorted keyframes [{t, v, easing}] and current time, return interpolated value.
export function interpolateKeyframes(keyframes, time, defaultValue) {
  if (!keyframes || keyframes.length === 0) return defaultValue
  if (keyframes.length === 1) return keyframes[0].v
  // Before first keyframe
  if (time <= keyframes[0].t) return keyframes[0].v
  // After last keyframe
  if (time >= keyframes[keyframes.length - 1].t) return keyframes[keyframes.length - 1].v
  // Find surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i], b = keyframes[i + 1]
    if (time >= a.t && time <= b.t) {
      const dt = b.t - a.t
      if (dt === 0) return b.v
      const progress = (time - a.t) / dt
      const easeFn = resolveEasing(b.easing)
      const eased = easeFn(progress)
      return a.v + (b.v - a.v) * eased
    }
  }
  return defaultValue
}

// ── Compute animated props for a layer at time t ──
// 2026-06-03:cornerRadius 加入可动画字段(rect only — 但 compute 函数对所有 type
// 统一返回 cornerRadius,非 rect 渲染路径根本不读这字段,无副作用)。
const DEFAULTS = { x: 0, y: 0, opacity: 1, rotation: 0, scaleX: 1, scaleY: 1, cornerRadius: 0 }

// Compute interpolated keyframe props only — does NOT apply presets.
// Used by hit-testing / bounds (we want the user's drag handles to follow
// the user-set transform, not preset wobble).
export function computeBaseAnimatedProps(layer, time) {
  const localTime = time - layer.inPoint
  const kf = layer.keyframes || {}
  return {
    x:            interpolateKeyframes(kf.x, localTime, layer.base.x || 0),
    y:            interpolateKeyframes(kf.y, localTime, layer.base.y || 0),
    opacity:      interpolateKeyframes(kf.opacity, localTime, layer.base.opacity ?? 1),
    rotation:     interpolateKeyframes(kf.rotation, localTime, layer.base.rotation || 0),
    scaleX:       interpolateKeyframes(kf.scaleX, localTime, layer.base.scaleX ?? 1),
    scaleY:       interpolateKeyframes(kf.scaleY, localTime, layer.base.scaleY ?? 1),
    cornerRadius: interpolateKeyframes(kf.cornerRadius, localTime, layer.base.cornerRadius ?? 0),
    width:        layer.base.width || 100,
    height:       layer.base.height || 100,
  }
}

// Compute final render props = base + preset filter layer.
export function computeAnimatedProps(layer, time) {
  const base = computeBaseAnimatedProps(layer, time)
  const localTime = time - layer.inPoint
  const layerDuration = (layer.outPoint || 0) - (layer.inPoint || 0)
  return applyPresetDelta(base, layer, localTime, layerDuration)
}

// ── Media cache (images + videos) ──
const _mediaCache = new Map()

function getMedia(src, isVideo = false) {
  if (!src) return null
  if (_mediaCache.has(src)) {
    const v = _mediaCache.get(src)
    if (v === 'loading') return null
    return v
  }
  if (isVideo) {
    const vid = document.createElement('video')
    vid.crossOrigin = 'anonymous'; vid.muted = true; vid.playsInline = true
    vid.preload = 'auto'; vid.loop = true
    _mediaCache.set(src, 'loading')
    vid.onloadeddata = () => { _mediaCache.set(src, vid); vid.play().catch(() => {}) }
    vid.onerror = () => _mediaCache.set(src, null)
    vid.src = src
    return null
  }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  _mediaCache.set(src, 'loading')
  img.onload = () => _mediaCache.set(src, img)
  img.onerror = () => _mediaCache.set(src, null)
  img.src = src
  return null
}

export async function preloadMedia(layers) {
  const promises = []
  for (const l of layers) {
    if (!l.base.src) continue
    const src = l.base.src, isVid = l.type === 'video'
    if (_mediaCache.has(src) && _mediaCache.get(src) !== 'loading') continue
    promises.push(new Promise(r => {
      if (isVid) {
        const vid = document.createElement('video')
        vid.crossOrigin = 'anonymous'; vid.muted = true; vid.preload = 'auto'
        vid.onloadeddata = () => { _mediaCache.set(src, vid); r() }
        vid.onerror = () => { _mediaCache.set(src, null); r() }
        vid.src = src
      } else {
        const img = new Image(); img.crossOrigin = 'anonymous'
        img.onload = () => { _mediaCache.set(src, img); r() }
        img.onerror = () => { _mediaCache.set(src, null); r() }
        img.src = src
      }
    }))
  }
  await Promise.all(promises)
}

// ── Measure text bounding box ──
function measureText(ctx, base) {
  const fs = base.fontSize || 24
  if (!ctx) return { w: (base.text || '').length * fs * 0.6 || 60, h: fs * (base.lineHeight || 1.2) }
  ctx.font = `${fs}px ${base.fontFamily || 'sans-serif'}`
  const lines = (base.text || '').split('\n')
  const lineH = fs * (base.lineHeight || 1.2)
  let maxW = 0
  for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width)
  return { w: maxW || 60, h: lines.length * lineH || fs }
}

// ── Resolve text bounding box (fixed-mode aware) ──
// 2026-06-02 修复:design 端拖出的 text 框带 textSizing='fixed' + base.width/height,
// renderer 之前只用 measureText 算 ink 占位 → 空白处 hit test 点不中,且渲染跟 hit 不同源。
// 这里统一返回 base.width/height(fixed)或 measureText ink box(auto / 兼容老数据)。
// 适用范围:drawShape / getLayerBounds / getLayerBoundsAbsolute 三处 text 分支。
function resolveTextSize(ctx, base) {
  const isFixed = base.textSizing === 'fixed' && base.width > 0 && base.height > 0
  if (isFixed) {
    // TEMP DEBUG
    return { w: base.width, h: base.height }
  }
  if (ctx) {
    const r = measureText(ctx, base)
    return r
  }
  const fb = {
    w: (base.text || '').length * (base.fontSize || 24) * 0.6 || 60,
    h: (base.fontSize || 24) * (base.lineHeight || 1.2),
  }
  return fb
}

// ── Resolve true visual geometry bounds for a layer ──
// 2026-06-03 round-13 修复(用户反馈:bbox 留白):**直接返回纯几何**,不再跟 base.w/h
// 取 max。base.width/height 是"容器逻辑尺寸",不是视觉占用 — designer 里椭圆/星形/多边形
// 的 base box 经常被用户拖大,几何只是中央一小块,bbox 跟 base 走就空了一圈白。
//
// 各 type 返回真几何 half size:
//   - rect / image / video:base.w/2 + strokePad(rect 本身就是 base 框,这个对)
//   - ellipse:radiusX/Y + strokePad
//   - star / gear:outerRadius + strokePad(外接圆)
//   - polygon:radius + strokePad
//   - text:measureText 或 actualBoundingBox 真 ink box
//   - pen / path:penNodes 极值(绝对坐标)
//   - line:两端点极值
//
// drawShape 把所有 shape 都画在 origin (0,0) 中心。bbox 关于 cx/cy 对称扩张即可。
// 返回 { hw, hh } — 半宽 / 半高(已含 stroke padding)。
function computeGeometryHalfSize(ctx, layer) {
  const b = layer.base || {}
  const bw = b.width || 100, bh = b.height || 100
  let hw = bw / 2, hh = bh / 2 // rect/image/video 默认走 base
  const strokePad = (b.stroke && b.strokeWidth > 0) ? (b.strokeWidth / 2) : 0

  switch (layer.type) {
    case 'rect':
    case 'image':
    case 'video':
      // rect / image / video 严格按 base.width/height 画 → bbox = base box + stroke
      // 这是唯一 base.w/h = 真几何的 type
      break
    case 'ellipse': {
      // drawShape: ellipse(0,0, b.radiusX || hw, b.radiusY || hh)
      // 真几何 = radiusX × radiusY,不跟 base 比 max(round 13 修)
      hw = b.radiusX || bw / 2
      hh = b.radiusY || bh / 2
      break
    }
    case 'star': {
      // drawShape: outerR = b.outerRadius || min(hw, hh) — 外接圆
      const outerR = b.outerRadius || Math.min(bw / 2, bh / 2)
      hw = outerR
      hh = outerR
      break
    }
    case 'polygon': {
      const r = b.radius || Math.min(bw / 2, bh / 2)
      hw = r
      hh = r
      break
    }
    case 'gear': {
      const outerR = b.outerRadius || Math.min(bw / 2, bh / 2)
      hw = outerR
      hh = outerR
      break
    }
    case 'text': {
      // measureText.h 用 fontSize * lineHeight * lines — em box 已含 ascent/descent,
      // 但某些字体 descender 超出 em(SF / 中文楷书等),用 actualBoundingBox* 补强。
      const ts = resolveTextSize(ctx, b)
      let textW = ts.w, textH = ts.h
      if (ctx && b.text && b.textSizing !== 'fixed') {
        const fs = b.fontSize || 24
        ctx.save()
        ctx.font = `${fs}px ${b.fontFamily || 'sans-serif'}`
        ctx.textBaseline = 'top'
        const lines = (b.text || '').split('\n')
        const lineH = fs * (b.lineHeight || 1.2)
        let maxAscDesc = fs * 1.2 // fallback
        for (const ln of lines) {
          const m = ctx.measureText(ln)
          // actualBoundingBoxAscent + actualBoundingBoxDescent = true glyph extent
          const asc = (typeof m.actualBoundingBoxAscent === 'number') ? m.actualBoundingBoxAscent : fs
          const desc = (typeof m.actualBoundingBoxDescent === 'number') ? m.actualBoundingBoxDescent : (fs * 0.2)
          if (asc + desc > maxAscDesc) maxAscDesc = asc + desc
        }
        ctx.restore()
        // total visual height = (n-1) line gaps + last line extent
        const visualH = (lines.length - 1) * lineH + maxAscDesc
        if (visualH > textH) textH = visualH
      }
      hw = textW / 2
      hh = textH / 2
      break
    }
    case 'pen':
    case 'path': {
      // drawShape pen/path:ctx.translate(-hw, -hh) 后画 path data。
      // penNodes 在 local top-left 系(原点 = base box 左上),几何中心 = (bw/2, bh/2)
      // 即绘制 origin。bbox 半宽 = max(|p-中心|) 取所有极值。
      // round 13 修:**直接用 penNodes 极值算 hw**,不 fallback 到 base(base 常空,
      // pen 的 base.w/h = 0)。
      if (Array.isArray(b.penNodes) && b.penNodes.length) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const n of b.penNodes) {
          if (!n) continue
          const xs = [n.x, n.cx1, n.cx2].filter(v => typeof v === 'number')
          const ys = [n.y, n.cy1, n.cy2].filter(v => typeof v === 'number')
          for (const x of xs) { if (x < minX) minX = x; if (x > maxX) maxX = x }
          for (const y of ys) { if (y < minY) minY = y; if (y > maxY) maxY = y }
        }
        if (isFinite(minX)) {
          // 几何中心 = (bw/2, bh/2),半宽 = max(中心到左, 中心到右)
          hw = Math.max(bw / 2 - minX, maxX - bw / 2)
          hh = Math.max(bh / 2 - minY, maxY - bh / 2)
        }
      } else if (!b.penNodes && b.data) {
        // path 没 penNodes 只有 data 字符串 — 没法精确算极值,保留 base 作 fallback
        // (svg import 的 path 走这里;一般 svg import 时会把 viewBox 写进 base.w/h)
      }
      break
    }
    case 'line': {
      if (Array.isArray(b.points) && b.points.length >= 4) {
        const minX = Math.min(b.points[0], b.points[2])
        const maxX = Math.max(b.points[0], b.points[2])
        const minY = Math.min(b.points[1], b.points[3])
        const maxY = Math.max(b.points[1], b.points[3])
        hw = Math.max(bw / 2 - minX, maxX - bw / 2)
        hh = Math.max(bh / 2 - minY, maxY - bh / 2)
      }
      break
    }
    default: {
      // 默认分支 (renderer default case): r = b.outerRadius || b.radius || min(hw, hh)
      const r = b.outerRadius || b.radius || Math.min(bw / 2, bh / 2)
      hw = r
      hh = r
    }
  }
  return { hw: hw + strokePad, hh: hh + strokePad }
}

// ── Draw a single shape (origin = center of bounding box) ──
// charCtx — optional `{ localTime, layerDuration }`. When provided AND the
// layer has a textChar-style preset, the text path uses per-character drawing.
/**
 * 计算 fill style:
 *  - solid:返回 hex / css color string
 *  - linear:CanvasGradient(根据 angle / gradientColors / 盒子尺寸算)
 *  - radial:CanvasGradient
 *  - none:返回 null
 *  2026-05-29 增量:支持 designer 端的渐变填充
 */
function computeFillStyle(ctx, b, w, h) {
  const fillType = b.fillType || 'solid'
  if (fillType === 'none') return null
  if ((fillType === 'gradient' || fillType === 'radial') && b.gradientColors) {
    const gc = b.gradientColors
    const c1 = gc.c1 || '#000000', c2 = gc.c2 || '#ffffff'
    const a1 = gc.a1 ?? 1, a2 = gc.a2 ?? 1
    if (fillType === 'gradient') {
      const angle = ((b.gradientAngle || 0) * Math.PI) / 180
      const cx = 0, cy = 0
      const r = Math.sqrt(w * w + h * h) / 2
      const dx = Math.cos(angle) * r, dy = Math.sin(angle) * r
      const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
      g.addColorStop(0, hexToRgba(c1, a1))
      g.addColorStop(1, hexToRgba(c2, a2))
      return g
    } else {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) / 2)
      g.addColorStop(0, hexToRgba(c1, a1))
      g.addColorStop(1, hexToRgba(c2, a2))
      return g
    }
  }
  return b.fill || null
}

function hexToRgba(hex, alpha) {
  if (typeof hex !== 'string' || !hex.startsWith('#')) return `rgba(0,0,0,${alpha ?? 1})`
  let h = hex.slice(1)
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]
  if (h.length === 8) h = h.slice(0, 6)
  const num = parseInt(h, 16)
  return `rgba(${(num>>16)&255},${(num>>8)&255},${num&255},${alpha ?? 1})`
}

/**
 * 应用 shadow effects 到 ctx(必须在 fill/stroke 之前 set,绘制后会自动应用)
 * 注意:ctx.shadow* 是 stateful,在 drawShape 顶部 save/restore 内不影响外部
 */
function applyShadowToCtx(ctx, b) {
  const sh = b.effects?.shadow
  if (!sh) return
  ctx.shadowColor = hexToRgba(sh.color || '#000000', sh.opacity ?? 0.2)
  ctx.shadowBlur = sh.blur ?? 10
  ctx.shadowOffsetX = sh.offsetX ?? 4
  ctx.shadowOffsetY = sh.offsetY ?? 4
}

/**
 * 应用 stroke 高级属性(lineCap / lineJoin / dash)
 */
function applyStrokeStyleToCtx(ctx, b) {
  if (b.lineCap) ctx.lineCap = b.lineCap
  if (b.lineJoin) ctx.lineJoin = b.lineJoin
  if (Array.isArray(b.dash) && b.dash.length) ctx.setLineDash(b.dash)
}

function drawShape(ctx, layer, props, textSize, charCtx) {
  const b = layer.base
  const hw = (textSize?.w || props.width) / 2, hh = (textSize?.h || props.height) / 2

  // 投影应用(对 fill / stroke 生效)
  applyShadowToCtx(ctx, b)
  // stroke 高级属性
  applyStrokeStyleToCtx(ctx, b)

  // 算 fill(支持渐变 / 纯色 / 无)
  const fillStyle = computeFillStyle(ctx, b, props.width || hw * 2, props.height || hh * 2)

  switch (layer.type) {
    case 'rect': {
      // 2026-06-03 cornerRadius 可 K 动画 — 用 animated props.cornerRadius(回退 base),
      // 并 clamp 到 [0, min(w,h)/2] 防 roundRect 报错。
      const crRaw = props.cornerRadius ?? b.cornerRadius ?? 0
      const cr = Math.max(0, Math.min(crRaw, Math.min(hw, hh)))
      ctx.beginPath()
      cr > 0 ? ctx.roundRect(-hw, -hh, hw * 2, hh * 2, cr) : ctx.rect(-hw, -hh, hw * 2, hh * 2)
      if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill() }
      if (b.stroke && b.strokeWidth) { ctx.strokeStyle = b.stroke; ctx.lineWidth = b.strokeWidth; ctx.stroke() }
      break
    }
    case 'ellipse': {
      ctx.beginPath()
      ctx.ellipse(0, 0, b.radiusX || hw, b.radiusY || hh, 0, 0, Math.PI * 2)
      if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill() }
      if (b.stroke && b.strokeWidth) { ctx.strokeStyle = b.stroke; ctx.lineWidth = b.strokeWidth; ctx.stroke() }
      break
    }
    case 'star': {
      const numPoints = b.numPoints || 5
      const outerR = b.outerRadius || Math.min(hw, hh)
      const innerR = b.innerRadius || outerR * 0.4
      ctx.beginPath()
      for (let i = 0; i < numPoints * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR
        const angle = (i * Math.PI) / numPoints - Math.PI / 2
        const x = Math.cos(angle) * r, y = Math.sin(angle) * r
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath()
      if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill() }
      if (b.stroke && b.strokeWidth) { ctx.strokeStyle = b.stroke; ctx.lineWidth = b.strokeWidth; ctx.stroke() }
      break
    }
    case 'polygon': {
      const sides = b.sides || 6
      const radius = b.radius || Math.min(hw, hh)
      ctx.beginPath()
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides - Math.PI / 2
        const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath()
      if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill() }
      if (b.stroke && b.strokeWidth) { ctx.strokeStyle = b.stroke; ctx.lineWidth = b.strokeWidth; ctx.stroke() }
      break
    }
    case 'pen': {
      // pen 跟 path 一样,用 data 渲染(钢笔节点 penNodes 已 serialize 成 SVG path data)
      if (!b.data) break
      const p2 = new Path2D(b.data)
      ctx.translate(-hw, -hh)
      if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(p2) }
      if (b.stroke && b.strokeWidth) { ctx.strokeStyle = b.stroke; ctx.lineWidth = b.strokeWidth; ctx.stroke(p2) }
      break
    }
    case 'gear': {
      // gear 简化为外圆 + 多角(齿数 = teeth)
      const teeth = b.teeth || 8
      const outerR = b.outerRadius || Math.min(hw, hh)
      const innerR = b.innerRadius || outerR * 0.75
      ctx.beginPath()
      const totalTeeth = teeth * 2
      for (let i = 0; i < totalTeeth; i++) {
        const r = i % 2 === 0 ? outerR : innerR
        const angle = (i * 2 * Math.PI) / totalTeeth - Math.PI / 2
        const x = Math.cos(angle) * r, y = Math.sin(angle) * r
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath()
      if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill() }
      if (b.stroke && b.strokeWidth) { ctx.strokeStyle = b.stroke; ctx.lineWidth = b.strokeWidth; ctx.stroke() }
      break
    }
    case 'text': {
      const fs = b.fontSize || 24
      ctx.font = `${fs}px ${b.fontFamily || 'sans-serif'}`
      ctx.fillStyle = b.fill || '#000'
      ctx.textBaseline = 'top'; ctx.textAlign = 'left'
      const lineH = fs * (b.lineHeight || 1.2)
      const lines = (b.text || '').split('\n')
      // Per-character rendering only kicks in when a textChar-style preset is
      // attached AND the caller supplied a charCtx. Otherwise we keep the
      // legacy fast path (one fillText per line).
      const useCharRender = !!charCtx && needsCharRendering(layer)
      if (!useCharRender) {
        lines.forEach((line, i) => ctx.fillText(line, -hw, -hh + i * lineH))
        break
      }
      // Per-character path: walk each char, apply the per-char delta, draw it.
      const layerDur = charCtx.layerDuration ?? ((layer.outPoint || 0) - (layer.inPoint || 0))
      const localTime = charCtx.localTime ?? 0
      // Pre-count total chars (excluding newlines) for stagger normalization
      let totalChars = 0
      for (const ln of lines) totalChars += ln.length
      let charIndex = 0
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li]
        let cursorX = -hw
        const lineY = -hh + li * lineH
        for (let ci = 0; ci < line.length; ci++) {
          const ch = line[ci]
          const w = ctx.measureText(ch).width
          const charDelta = applyCharPresetDelta(charIndex, totalChars, layer, localTime, layerDur)
          if (charDelta) {
            // We want to transform around the character's own center.
            const charCx = cursorX + w / 2
            const charCy = lineY + lineH / 2
            // Compose: x/y are offsets relative to the char's draw position,
            // scaleX/scaleY around its center, opacity multiplies.
            ctx.save()
            ctx.globalAlpha *= (charDelta.opacity ?? 1)
            ctx.translate(charCx + (charDelta.x ?? 0), charCy + (charDelta.y ?? 0))
            ctx.rotate((charDelta.rotation ?? 0) * Math.PI / 180)
            ctx.scale(charDelta.scaleX ?? 1, charDelta.scaleY ?? 1)
            ctx.fillText(ch, -w / 2, -lineH / 2)
            ctx.restore()
          } else {
            ctx.fillText(ch, cursorX, lineY)
          }
          cursorX += w
          charIndex++
        }
      }
      break
    }
    case 'video':
    case 'image': {
      const media = getMedia(b.src, layer.type === 'video')
      if (media) ctx.drawImage(media, -hw, -hh, hw * 2, hh * 2)
      break
    }
    case 'line': {
      if (!b.points || b.points.length < 4) break
      ctx.beginPath(); ctx.moveTo(b.points[0] - hw, b.points[1] - hh); ctx.lineTo(b.points[2] - hw, b.points[3] - hh)
      ctx.strokeStyle = b.stroke || '#000'; ctx.lineWidth = b.strokeWidth || 2; ctx.stroke()
      break
    }
    case 'path': {
      if (!b.data) break
      const p2 = new Path2D(b.data)
      ctx.translate(-hw, -hh) // path data is in local coords from top-left
      if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(p2) }
      if (b.stroke && b.strokeWidth) { ctx.strokeStyle = b.stroke; ctx.lineWidth = b.strokeWidth; ctx.stroke(p2) }
      break
    }
    default: {
      const r = b.outerRadius || b.radius || Math.min(hw, hh)
      if (r > 0) {
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2)
        if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill() }
        if (b.stroke && b.strokeWidth) { ctx.strokeStyle = b.stroke; ctx.lineWidth = b.strokeWidth; ctx.stroke() }
      }
    }
  }
}

/**
 * Render full frame. All layers use UNIFIED coordinate system:
 *   p.x, p.y = top-left of bounding box (before scale)
 *   Transform: translate to center → rotate → scale → draw centered
 */
/**
 * 渲染单个 layer(支持 group/mask 递归)
 * 2026-05-29 改造:从 renderFrame 抽出,group/mask 走嵌套坐标系
 */
function renderLayerRecursive(ctx, layer, time) {
  if (!layer || layer.visible === false) return
  if (time < layer.inPoint || time > layer.outPoint) return
  const p = computeAnimatedProps(layer, time)

  // 应用 blendMode(globalCompositeOperation),空或 source-over 时不设
  const bm = layer.base?.blendMode
  // ── group / mask 走嵌套坐标系 ──
  // 2026-05-31 修复:rotation / scale 围绕 children union bbox center 而非 group 原点
  //   原因:group 自己 width/height = 0,转/缩放绕 (0,0) 会让 children 围绕左上角旋转 → 视觉"变形"
  if (layer.type === 'group' || layer.type === 'mask') {
    ctx.save()
    if (bm && bm !== 'source-over') ctx.globalCompositeOperation = bm
    ctx.globalAlpha *= clamp(p.opacity, 0, 1)
    // 算 children 的几何中心(共用 helper,跟 getLayerBoundsAbsolute 一致)
    const { cx, cy } = getGroupChildrenCenter(layer)
    // 围绕 children center 变换,然后 translate 回 local 让 children 在原本 local 坐标内绘制
    ctx.translate(p.x + cx, p.y + cy)
    ctx.rotate(p.rotation * Math.PI / 180)
    ctx.scale(p.scaleX, p.scaleY)
    ctx.translate(-cx, -cy)
    if (layer.type === 'mask' && layer.children?.[0]) {
      const m = layer.children[0]
      ctx.beginPath()
      const mw = m.width || m.base?.width || 100
      const mh = m.height || m.base?.height || 100
      const mx = m.x || m.base?.x || 0
      const my = m.y || m.base?.y || 0
      if (m.type === 'ellipse') ctx.ellipse(mx + mw / 2, my + mh / 2, mw / 2, mh / 2, 0, 0, Math.PI * 2)
      else ctx.rect(mx, my, mw, mh)
      ctx.clip()
    }
    for (const child of (layer.children || [])) {
      renderLayerRecursive(ctx, child, time)
    }
    ctx.restore()
    return
  }

  // ── 普通形状 ──
  let textSize = null
  if (layer.type === 'text') textSize = resolveTextSize(ctx, layer.base)
  const bw = textSize?.w || p.width, bh = textSize?.h || p.height
  const cx = p.x + bw / 2, cy = p.y + bh / 2
  const charCtx = (layer.type === 'text')
    ? { localTime: time - layer.inPoint, layerDuration: (layer.outPoint || 0) - (layer.inPoint || 0) }
    : null

  ctx.save()
  if (bm && bm !== 'source-over') ctx.globalCompositeOperation = bm
  ctx.globalAlpha *= clamp(p.opacity, 0, 1)
  ctx.translate(cx, cy)
  ctx.rotate(p.rotation * Math.PI / 180)
  ctx.scale(p.scaleX, p.scaleY)
  drawShape(ctx, layer, p, textSize, charCtx)
  ctx.restore()
}

export function renderFrame(ctx, layers, time, w, h, bg, noClear) {
  if (!noClear) {
    ctx.clearRect(0, 0, w, h)
    if (bg && bg !== 'transparent') { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h) }
  }
  // 顶层 globalAlpha = 1(每个 layer 内 save/restore 处理累积)
  ctx.globalAlpha = 1
  for (const layer of layers) {
    renderLayerRecursive(ctx, layer, time)
  }
}

// Get the visual bounding box for a layer at given time (for hit testing / bounds).
// 2026-06-03 修复:加 includePreset 参数,默认 true → bbox 跟实际渲染位置(含 preset delta)
// 完全一致;hit test / drag start 路径显式传 false,保留 base+kf 不污染 base.x/y/scaleX 反推。
// 之前默认走 base 路径导致带预设动画的 layer 在拖拽/缩放中 bbox 偏离图形(preset delta 是
// time 的函数,playhead 静止时 delta 恒定但 base 在变,视觉上是 const offset)。
// 副作用:wiggle/shake 类 preset 播放时 bbox 会跟着抖,这是正确行为(图形真在那里)。
//
// 2026-06-02 修复:输出 `cx, cy` = **真视觉中心 world**(消费方应一律使用 cx/cy,而不是
// 自己用 x + w/2 算)。原因:renderer L484 普通 shape 的 transform 是
// `translate(p.x + bw/2, p.y + bh/2) → rotate → scale → drawShape(-hw,-hh)`,scale 围绕
// (p.x + bw/2, p.y + bh/2) **缩放中心点不被 scale 改变**,所以视觉中心 = base 半宽算的中心。
// 而 `b.w = bw * scaleX`(视觉宽,已乘 scale),`b.x + b.w/2` = `p.x + bw*scaleX/2` ≠ 真视觉
// 中心(只在 scaleX=1 时巧合相等)。带 scale 后偏移 `bw*(scaleX-1)/2`,这就是用户看到的
// "缩放后 bbox 跟图形错位"。修法:bounds 返回 cx,cy = p.x + bw/2, p.y + bh/2(base 半宽)。
export function getLayerBounds(ctx, layer, time, includePreset = true) {
  const p = includePreset ? computeAnimatedProps(layer, time) : computeBaseAnimatedProps(layer, time)
  // **base box** — renderer 用它做 scale 中心 (p.x+baseW/2, p.y+baseH/2),所有 scale 反推、
  // 命中容差、子层 transform 累积都依赖 base.width/height 作为"name plate"语义。
  //   text 例外:base box 自身就是文字 ink box(measureText)。
  let baseW = p.width, baseH = p.height
  if (layer.type === 'text') {
    const ts = resolveTextSize(ctx, layer.base)
    baseW = ts.w; baseH = ts.h
  }
  // **真视觉几何**(对称半宽 / 半高,含 stroke 外扩 + text 真 descender + ellipse/star/polygon/
  // gear 外接圆 + pen 极值);renderer 把所有 shape 画在 (p.x + baseW/2, p.y + baseH/2) 为中心,
  // 几何中心与之重合,所以只需关于该中心对称扩张。
  // ⚠️ 不替换 bw/bh — 那些是 scale/hit/drag math 的"name plate",改了会破坏 handle 反推。
  // 这里返回 visualHW/HH 供 drawBounds(画框)和可选 visual hit padding 用。
  //
  // 2026-06-03 round-13(用户反馈"bbox 留白"):**直接用 geom.hw**,不再 Math.max baseW/2。
  // 旧逻辑导致 ellipse/star/polygon 等 base box 比真几何大时,bbox 跟 base 走 → 大量留白。
  // computeGeometryHalfSize 内部已对 rect/image/video 用 base.w/2(它们 base = 真几何),
  // 对 ellipse/star/polygon/gear/text/pen 用真几何,所以这里直接信它就行。
  const geom = computeGeometryHalfSize(ctx, layer)
  const visualHW = geom.hw
  const visualHH = geom.hh
  return {
    x: p.x, y: p.y,
    w: baseW * p.scaleX, h: baseH * p.scaleY,
    bw: baseW, bh: baseH,
    // 真视觉半宽 / 半高(pre-scale,关于 cx/cy 对称)— bbox 必须用 visualHW * scaleX 画
    visualHW, visualHH,
    visualW: visualHW * 2 * p.scaleX,
    visualH: visualHH * 2 * p.scaleY,
    cx: p.x + baseW / 2, cy: p.y + baseH / 2,
    rotation: p.rotation, scaleX: p.scaleX, scaleY: p.scaleY,
  }
}

/**
 * 递归找 layer 在 tree 中的路径(parent chain + layer 自己)
 * 用于 getLayerBoundsAbsolute 累积父级 transform
 */
export function findLayerPath(layers, layerId, path = []) {
  if (!Array.isArray(layers) || !layerId) return null
  for (const l of layers) {
    const newPath = [...path, l]
    if (l.id === layerId) return newPath
    if (Array.isArray(l.children)) {
      const r = findLayerPath(l.children, layerId, newPath)
      if (r) return r
    }
  }
  return null
}

/** 拿 group 的 children union bbox center(local coords)— renderer 和 bounds 共用 */
export function getGroupChildrenCenter(group) {
  if (!Array.isArray(group?.children) || !group.children.length) return { cx: 0, cy: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const child of group.children) {
    const cb = child.base || {}
    const xx = cb.x || 0, yy = cb.y || 0
    const ww = cb.width || 100, hh = cb.height || 100
    if (xx < minX) minX = xx
    if (yy < minY) minY = yy
    if (xx + ww > maxX) maxX = xx + ww
    if (yy + hh > maxY) maxY = yy + hh
  }
  if (!isFinite(minX)) return { cx: 0, cy: 0 }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

/**
 * 拿到 layer 的"画板绝对坐标系" bounds(累积父级 group transform)
 *
 * 数学推导(忽略 rotation):
 *  Renderer 内 group transform 是:
 *    translate(p.x + cx, p.y + cy) → scale(sx, sy) → translate(-cx, -cy)
 *  child 在 group local (lx, ly) 经过此 transform 后到 world:
 *    worldX = p.x + cx + (lx - cx) * sx = p.x + cx*(1-sx) + lx * sx
 *  累积形式:
 *    new absOffset = absOffset + (p.x + pcx*(1 - p.sx)) * absS
 *    new absS = absS * p.sx
 *
 * 这样 child 的定界框 / 手柄就跟父级 scale 时实际渲染位置一致
 */
export function getLayerBoundsAbsolute(ctx, layerId, time, layers, includePreset = true) {
  const path = findLayerPath(layers, layerId)
  if (!path || !path.length) return null

  // 累积 transform:把 child local (lx, ly) → world (X, Y)
  //   X = absOffsetX + lx * absSx ;  Y = absOffsetY + ly * absSy
  let absOffsetX = 0, absOffsetY = 0
  let absSx = 1, absSy = 1
  let absRot = 0

  for (let i = 0; i < path.length - 1; i++) {
    const parent = path[i]
    // 2026-06-03:默认含 preset delta,跟 renderLayerRecursive 同源;hit test 路径传 false
    const p = includePreset ? computeAnimatedProps(parent, time) : computeBaseAnimatedProps(parent, time)
    const { cx: pcx, cy: pcy } = getGroupChildrenCenter(parent)
    // scale 绕 (pcx, pcy) 中心 → 等价 translate(pcx*(1-sx))
    absOffsetX += (p.x + pcx * (1 - p.scaleX)) * absSx
    absOffsetY += (p.y + pcy * (1 - p.scaleY)) * absSy
    absSx *= p.scaleX
    absSy *= p.scaleY
    absRot += p.rotation
  }

  const child = path[path.length - 1]
  // 2026-06-03:默认含 preset delta,与 renderLayerRecursive 普通形状路径(L436 computeAnimatedProps)同源
  const cp = includePreset ? computeAnimatedProps(child, time) : computeBaseAnimatedProps(child, time)
  let bw = cp.width, bh = cp.height
  // 默认 box left/top in local = (0, 0) — 普通 shape
  let visualOffsetX = 0, visualOffsetY = 0
  // **关键修复**:group/mask 自身 base.width=0,要用 children union 算 visual bbox
  //   bw/bh 用 union 大小,visualOffsetX/Y 补正 box left local(可能 != 0)
  if (child.type === 'group' || child.type === 'mask') {
    if (Array.isArray(child.children) && child.children.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const c of child.children) {
        const cb = c.base || {}
        const xx = cb.x || 0, yy = cb.y || 0
        const ww = cb.width || 100, hh = cb.height || 100
        if (xx < minX) minX = xx
        if (yy < minY) minY = yy
        if (xx + ww > maxX) maxX = xx + ww
        if (yy + hh > maxY) maxY = yy + hh
      }
      if (isFinite(minX) && (maxX - minX) > 0 && (maxY - minY) > 0) {
        bw = maxX - minX
        bh = maxY - minY
        visualOffsetX = minX
        visualOffsetY = minY
      }
    }
  } else if (child.type === 'text') {
    const ts = resolveTextSize(ctx, child.base)
    bw = ts.w; bh = ts.h
  }

  const finalSx = absSx * cp.scaleX
  const finalSy = absSy * cp.scaleY
  // box center local(用于 scale / rotate 算补偿)
  //   普通 shape:cxLocal = bw/2(box left=0)
  //   group:cxLocal = visualOffsetX + bw/2(box left=visualOffsetX)
  const cxLocal = visualOffsetX + bw / 2
  const cyLocal = visualOffsetY + bh / 2
  // 2026-06-02 修复:cx,cy = **真视觉中心 world**,消费方一律用 cx/cy 不要自己 x + w/2 算。
  // renderer L484/L450 transform 链最终把 (cp.x + cxLocal, cp.y + cyLocal) 当作 scale 中心 →
  // 它就是 child 在父级 local 系的视觉中心(不被 child 自己的 scale 改变);经父级 absS 累积:
  //   worldCx = absOffsetX + (cp.x + cxLocal) * absSx
  // **不是** `x + w/2` = `absOffsetX + (cp.x + visualOffsetX) * absSx + bw*finalSx/2`,
  // 后者额外乘了 child cp.scaleX,**scale ≠ 1 时常数偏移**(用户截图症状根因)
  const worldCx = absOffsetX + (cp.x + cxLocal) * absSx
  const worldCy = absOffsetY + (cp.y + cyLocal) * absSy
  // 2026-06-03 round-13:真视觉几何半宽(pre-scale,关于 cx/cy 对称)— 含 stroke 外扩、
  // text 真 descender、ellipse/star/polygon/gear 外接圆、pen 极值。
  // **直接用 geom**,不 Math.max baseW/2(否则 ellipse/star 等 base 大时 bbox 留白)。
  // group/mask 已是 union bbox,不走 computeGeometryHalfSize。
  let visualHW = bw / 2, visualHH = bh / 2
  if (child.type !== 'group' && child.type !== 'mask') {
    const g = computeGeometryHalfSize(ctx, child)
    visualHW = g.hw
    visualHH = g.hh
  }
  return {
    x: absOffsetX + (cp.x + visualOffsetX) * absSx,
    y: absOffsetY + (cp.y + visualOffsetY) * absSy,
    w: bw * finalSx,
    h: bh * finalSy,
    bw, bh,
    cxLocal, cyLocal,
    visualHW, visualHH,
    visualW: visualHW * 2 * finalSx,
    visualH: visualHH * 2 * finalSy,
    cx: worldCx, cy: worldCy,
    rotation: absRot + cp.rotation,
    scaleX: finalSx,
    scaleY: finalSy,
  }
}

/**
 * 把 layer tree 递归展平为 flat 数组(z-order 倒序便于 hit test)
 * 内部 layer 后于父级出现,所以 hit test 倒序遍历时,**子级优先匹配**
 */
export function flattenLayerTree(layers) {
  const out = []
  const walk = (list) => {
    for (const l of list) {
      out.push(l)
      if (Array.isArray(l.children)) walk(l.children)
    }
  }
  walk(layers || [])
  return out
}
