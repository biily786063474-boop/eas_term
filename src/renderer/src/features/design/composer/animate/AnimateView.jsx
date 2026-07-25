/**
 * MotionComposer — keyframe animation workspace
 * Preview: zoomable/pannable with bounding box drawn directly on canvas
 * Timeline: scrollable with frame ticks, draggable playhead
 * Panels: resizable right panel + timeline height
 */
import React, { useState, useCallback, useEffect, useRef } from 'react'
// [Eas-Term 移植] 桩掉 taptv 的 useIdleStore(浏览器标签隐藏检测)—— Electron 单窗口
// 无标签隐藏语义,isHidden 恒 false;保留 useIdleStore.getState().isHidden 调用点不改。
const useIdleStore = { getState: () => ({ isHidden: false }) }
import { useUnifiedMotionStore, EASING_OPTIONS, findLayerInTree } from './store'
import { renderFrame, computeAnimatedProps, computeBaseAnimatedProps, getLayerBounds, getLayerBoundsAbsolute, flattenLayerTree, findLayerPath, getGroupChildrenCenter } from './renderer'
import { exportMotion } from './exporter'
import { exportMotionMp4 } from './exporterMp4'
import { PRESETS_LIB, getPresetMeta } from './presets'
import PresetAnimationPicker from './PresetAnimationPicker'
import LayersPanel from './LayersPanel'
// [Eas-Term 移植] AI 整体剥离:不带 MotionAIModal / MotionAIModal.css
import './styles.css'

const TYPE_COLORS = {
  rect: '#4a9eff', ellipse: '#ff6b9d', text: '#ffd93d', image: '#6bcb77',
  line: '#999', path: '#c084fc', star: '#ff9f43', polygon: '#ff9f43', gear: '#ff9f43',
}
const ANIM_PROPS = [
  { key: 'x', label: 'X', step: 1 },
  { key: 'y', label: 'Y', step: 1 },
  { key: 'opacity', label: '不透明', step: 0.05, min: 0, max: 1 },
  { key: 'rotation', label: '旋转', step: 1 },
  { key: 'scaleX', label: '缩放X', step: 0.05 },
  { key: 'scaleY', label: '缩放Y', step: 0.05 },
  // 2026-06-03 cornerRadius 可 K 动画(rect-only,KeyframePanel 按 layer.type 过滤)
  { key: 'cornerRadius', label: '圆角', step: 1, min: 0, types: ['rect'] },
]
const BG_MODES = ['checker', 'color']
const BG_LABELS = { checker: '棋盘格', color: '纯色' }

function fmt(t) {
  const s = Math.floor(t % 60), f = Math.floor((t % 1) * 100)
  return `${Math.floor(t / 60)}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`
}

// Draw checkerboard pattern on canvas
function drawChecker(ctx, w, h, cellSize = 12) {
  const c1 = '#2a2a2a', c2 = '#222'
  for (let y = 0; y < h; y += cellSize) {
    for (let x = 0; x < w; x += cellSize) {
      ctx.fillStyle = ((x / cellSize + y / cellSize) % 2 === 0) ? c1 : c2
      ctx.fillRect(x, y, cellSize, cellSize)
    }
  }
}

/**
 * Visual tokens — 跟 designer/KonvaCanvas.jsx 对齐(2026-06-03 round-9 alignment)
 *  - BOX_STROKE / ANCHOR_STROKE / BORDER_STROKE / ROTATER_STROKE = '#a78bfa' (lavender stroke)
 *  - ROTATER_GLYPH = '#7c6aed' (deeper purple,for ↻ icon stroke + cr_handle stroke)
 *  - dash pattern [4, 3](designer Konva Transformer dash)
 *  - anchorSize 6 (= hs 3 square),anchor border 1px
 *  - rotater radius 11(world px,scale 由 zoom 外部除掉)
 *  - cr_handle radius 5 / 紫描边白心 / 圆角调节
 */
const VT = {
  BOX: '#a78bfa',
  ANCHOR_STROKE: '#a78bfa',
  ANCHOR_FILL: '#fff',
  ROTATER_STROKE: '#a78bfa',
  ROTATER_FILL: '#fff',
  ROTATER_GLYPH: '#7c6aed',
  CR_HANDLE_STROKE: '#7c6aed',
  CR_HANDLE_FILL: '#fff',
  DASH: [4, 3],
}

/**
 * 4 corner 到光标距离 argmin — 跟 designer round 5 Figma 式自适应一致。
 * 返回 'TL' | 'TR' | 'BR' | 'BL'
 */
function nearestCorner(rc, mx, my) {
  const names = ['TL', 'TR', 'BR', 'BL']
  let best = 'TR', bestD = Infinity
  for (const n of names) {
    const dx = mx - rc[n].x, dy = my - rc[n].y
    const d2 = dx * dx + dy * dy
    if (d2 < bestD) { bestD = d2; best = n }
  }
  return best
}

/**
 * 给定 corner 名字 + box center + 4 corner world,算出 rotater 应该出现的 world 坐标。
 * 跟 designer updateCustomRotaterPosition 同算法(沿 corner→center 反方向延伸 DIAG=22 屏幕 px)。
 */
function rotaterPosFromCorner(rc, cx, cy, cornerName, diagWorldPx) {
  const corner = rc[cornerName]
  const vx = corner.x - cx, vy = corner.y - cy
  const len = Math.sqrt(vx * vx + vy * vy) || 1
  return { x: corner.x + (vx / len) * diagWorldPx, y: corner.y + (vy / len) * diagWorldPx }
}

/**
 * Draw bounding box + handles + rotater + cr_handle 直接在 canvas 上 — **Figma 风:跟随 rotation 旋转**
 *
 * 关键:
 *  - 用真视觉几何 (b.visualHW * 2 × b.scaleX, b.visualHH * 2 × b.scaleY) — 含 stroke 外扩 +
 *    text 真 descender + ellipse/star/polygon/gear 外接圆 + pen 极值,不是 axis-aligned bbox
 *  - ctx.translate(box_center_world) + ctx.rotate(rotation) 进入 rotated 坐标系
 *  - 画 rotated rect 和 4 个 corner handles(它们在 rotated 角上)
 *  - handle size 不被 scale 影响(因为没 ctx.scale)
 *  - 视觉 token 跟 designer 一致(#a78bfa box/anchor stroke / dash[4,3] / anchorSize=6
 *    / rotater radius=11 白圆紫边 / ↻ 字符 / cr_handle radius=5 紫描边白心圆点)
 *  - 视觉 px 通过 previewZoom 外部除掉(传 strokeScale = 1 / previewZoom,handleScale 同)
 */
function drawBounds(ctx, layer, time, layers, cornerName = 'TR', previewZoom = 1) {
  const b = (layers ? getLayerBoundsAbsolute(ctx, layer.id, time, layers) : null) || getLayerBounds(ctx, layer, time)
  // 2026-06-02 修复:用 b.cx/b.cy(真视觉中心 world,renderer 同源)而不是 b.x + b.w/2。
  // 后者 = base 左上 + 视觉半宽 = base_x + bw*sx/2,与 renderer 实际绘制中心 base_x + bw/2
  // 错位 bw*(sx-1)/2,scale ≠ 1 时常数偏移 → 用户截图症状。详见 renderer.js getLayerBounds 注释。
  const cx = b.cx, cy = b.cy
  // 2026-06-02 round-12 修复:bbox **必须包裹整个图形** —— 用 visualHW/HH(真几何半宽,含
  // stroke 外扩 / text 真 descender / ellipse 外接圆 / pen 极值);hw/hh 关于 cx/cy 对称扩张。
  // 几何中心 = scale 中心 = cx,cy,所以扩张后矩形仍以 cx,cy 为中心,跟图形完美对齐。
  // 老逻辑用 b.bw * b.scaleX(base box * scale)对 ellipse / star 等几何 > base 的形状会偏小。
  const vHW = (b.visualHW != null ? b.visualHW : (b.bw || 1) / 2)
  const vHH = (b.visualHH != null ? b.visualHH : (b.bh || 1) / 2)
  const originalW = vHW * 2 * b.scaleX
  const originalH = vHH * 2 * b.scaleY
  const hw = originalW / 2, hh = originalH / 2

  // 视觉 px 在 world 系下的对应大小(previewZoom < 1 → 视觉同样 px 在 world 系下要除回去)
  const px = 1 / previewZoom

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(b.rotation * Math.PI / 180)

  // Dashed bbox — 在 rotated 坐标系下画原始大小;1 屏幕 px stroke + [4,3] dash 跟 designer 完全一致
  ctx.strokeStyle = VT.BOX
  ctx.lineWidth = 1 * px
  ctx.setLineDash([VT.DASH[0] * px, VT.DASH[1] * px])
  ctx.strokeRect(-hw, -hh, originalW, originalH)
  ctx.setLineDash([])

  // Corner anchors(scale)— 在 rotated 角上;anchorSize=6 (hs=3) 白心紫描边 1px,跟 designer 完全一致
  const hs = 3 * px
  const anchorPositions = [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]]
  for (const [hx, hy] of anchorPositions) {
    ctx.fillStyle = VT.ANCHOR_FILL
    ctx.strokeStyle = VT.ANCHOR_STROKE
    ctx.lineWidth = 1 * px
    ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2)
    ctx.strokeRect(hx - hs, hy - hs, hs * 2, hs * 2)
  }

  ctx.restore()

  // cr_handle(rect 圆角调节)— 在 rotated 坐标系下,inset 16 屏幕 px + 沿对角偏移 r·0.707
  // 跟 designer Round 8 完全一致
  if (layer.type === 'rect') {
    const cr = (b.cornerRadius != null ? b.cornerRadius : (layer.base?.cornerRadius || 0))
    const inset = 16 * px
    const diagR = cr * 0.707
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(b.rotation * Math.PI / 180)
    // rect 在 rotated 系下 local top-left = (-hw, -hh);right-top inside corner inset:
    const lx = hw - inset - diagR
    const ly = -hh + inset + diagR
    ctx.beginPath()
    ctx.arc(lx, ly, 5 * px, 0, Math.PI * 2)
    ctx.fillStyle = VT.CR_HANDLE_FILL
    ctx.fill()
    ctx.lineWidth = 2 * px
    ctx.strokeStyle = VT.CR_HANDLE_STROKE
    ctx.stroke()
    ctx.restore()
  }

  // Rotater — 不在 rotated 系下(rotater 跟着 box 转视觉会反向晃,固定屏幕方向就行)
  // 位置:从 box center 沿(nearestCorner→外侧)单位向量延伸 22 屏幕 px
  // 视觉:radius=11 屏幕 px 白圆 + 1.5 屏幕 px 紫描边 + ↻ 字符
  const rc = getRotatedCorners(cx, cy, hw, hh, b.rotation || 0)
  const rPos = rotaterPosFromCorner(rc, cx, cy, cornerName, 22 * px)
  ctx.save()
  ctx.beginPath()
  ctx.arc(rPos.x, rPos.y, 11 * px, 0, Math.PI * 2)
  ctx.fillStyle = VT.ROTATER_FILL
  ctx.fill()
  ctx.lineWidth = 1.5 * px
  ctx.strokeStyle = VT.ROTATER_STROKE
  ctx.stroke()
  // ↻ 字符 — Canvas 2D 用 fillText 渲染最简单(可用 emoji '↻');字号 = 13 屏幕 px
  ctx.fillStyle = VT.ROTATER_GLYPH
  ctx.font = `${13 * px}px -apple-system, BlinkMacSystemFont, "Segoe UI Symbol", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('↻', rPos.x, rPos.y)
  ctx.restore()
}

/** rotated bbox 的 4 个角 world 坐标(用于 hit test / hover cursor)
 *  cx, cy:box center world
 *  hw, hh:已 scale 的 half size
 *  rotDeg:rotation 度数
 */
function getRotatedCorners(cx, cy, hw, hh, rotDeg) {
  const rad = rotDeg * Math.PI / 180
  const cosR = Math.cos(rad), sinR = Math.sin(rad)
  const rot = (lx, ly) => ({ x: cx + lx * cosR - ly * sinR, y: cy + lx * sinR + ly * cosR })
  return {
    TL: rot(-hw, -hh),
    TR: rot( hw, -hh),
    BL: rot(-hw,  hh),
    BR: rot( hw,  hh),
  }
}

/**
 * 4 角朝向的旋转 cursor(Figma 风:双向弧形箭头,弧线朝图形中心)
 *
 * base SVG 默认弧朝下(凸朝下),箭头在左右两端;rotate 让弧朝不同方向:
 *  - TL 角(图形中心在右下) → 弧朝右下 → rotate 135°
 *  - TR 角(中心在左下) → rotate 225°
 *  - BR 角(中心在左上) → rotate 315°
 *  - BL 角(中心在右上) → rotate 45°
 *
 * fallback `alias`(浏览器自带带弯曲号的箭头)— 即使 SVG 加载失败也能视觉提示
 */
function makeRotateCursor(rotDeg) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='-16 -16 32 32'>` +
    `<g transform='rotate(${rotDeg})'>` +
    // 弧(黑底 + 白描边,提高可见度)
    `<path d='M -8 -3 A 8 8 0 0 1 8 -3' fill='none' stroke='black' stroke-width='4' stroke-linecap='round'/>` +
    `<path d='M -8 -3 A 8 8 0 0 1 8 -3' fill='none' stroke='white' stroke-width='2' stroke-linecap='round'/>` +
    // 左端箭头(指向弧切线方向 = 朝左下)
    `<polyline points='-12 -1 -8 -3 -6 -7' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>` +
    `<polyline points='-12 -1 -8 -3 -6 -7' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/>` +
    // 右端箭头(指向弧切线方向 = 朝右下)
    `<polyline points='12 -1 8 -3 6 -7' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>` +
    `<polyline points='12 -1 8 -3 6 -7' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/>` +
    `</g></svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 16 16, alias`
}

const ROTATE_CURSORS = {
  TL: makeRotateCursor(135),
  TR: makeRotateCursor(225),
  BR: makeRotateCursor(315),
  BL: makeRotateCursor(45),
}

// 缩放 cursor:对角方向(✓ 浏览器原生)
const SCALE_CURSORS = {
  TL: 'nwse-resize', // ↖↘
  BR: 'nwse-resize',
  TR: 'nesw-resize', // ↗↙
  BL: 'nesw-resize',
}

export default function AnimateView({ nodeId, savedState, designInputs = [], mediaInputs = [], onExport, onClose, onSaveState, topbarCenter }) {
  const store = useUnifiedMotionStore()
  const { layers, selectedLayerId, selectedIds: storeSelectedIds, playhead, playing, duration, fps, canvasWidth, canvasHeight, backgroundColor, zoom: tlZoom, showBounds } = store
  // Round-11(2026-06-03 group/钻入/选中对齐 designer):多选 ids 派生
  //   ⚠️ storeSelectedIds 可能是旧 savedState 没填的 undefined,显式 fallback 到 [selectedLayerId]
  //      让所有读取这个变量的路径(marquee bbox 多选画框 / 锚点 gate)都拿到非空数组。
  const selectedIds = (storeSelectedIds && storeSelectedIds.length)
    ? storeSelectedIds
    : (selectedLayerId ? [selectedLayerId] : [])
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const saveRef = useRef(null)
  const previewWrapRef = useRef(null)

  const [timelineH, setTimelineH] = useState(220)
  const [rightW, setRightW] = useState(260)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  // Preset picker — null when closed, or { stage } when open
  const [presetPickerStage, setPresetPickerStage] = useState(null)

  // Preview zoom & pan (separate from timeline zoom)
  const [previewZoom, setPreviewZoom] = useState(0.5) // fit initially
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
  const [bgMode, setBgMode] = useState('checker') // 'checker' | 'color'
  const [bgColor, setBgColor] = useState('#000000') // preview-only background color
  // Round-9 alignment(2026-06-03):跟 designer round 5 Figma 式 4 corner 自适应 rotater
  // cornerRef 当前最近 corner 名,鼠标 hover 切换 → drawBounds 用它决定 rotater 出现在哪个 corner 外
  // 用 useRef 避免 mousemove 高频 setState 导致重渲染 → drawBounds 是 useEffect deps:cornerTick 触发重画
  const cornerRef = useRef('TR')
  const [cornerTick, setCornerTick] = useState(0)
  const isAnimateTransformingRef = useRef(false) // 拖拽期间冻结 corner 切换(防 rotater 拖一半跳走)

  // Round-11(2026-06-03 group/钻入/选中对齐 designer):
  //  editingId — 当前钻入的 group id(双击进 / Esc 退 / 嵌套支持多级 path)
  //    · null = 顶层模式,所有顶层 group/layer 都按整体响应
  //    · != null = 已钻入,layer hit test 只看 editingId.children 内
  //    · 跟 designer enteredGroupId 同语义(DC KonvaCanvas L1810 setEnteredGroupId(clickedId))
  //    · 用 component-local state(不污染 store / savedState),关 Composer 自然丢弃 — 跟 design 同模式
  //  marquee — DOM 浮层框选 state {x1,y1,x2,y2} 屏幕坐标(便于直接渲染 div 不画到 canvas)
  //    · marqueeRef 同步存 startMX/startMY canvas 坐标用于 hit 完成时 bbox 相交计算
  const [editingId, setEditingId] = useState(null)
  const [marquee, setMarquee] = useState(null) // 屏幕 px 坐标 {x1,y1,x2,y2}
  const marqueeRef = useRef(null) // canvas 坐标 {x1,y1,x2,y2,sx1,sy1}(s* 屏幕坐标)

  // ── Round-12(2026-06-03 钻入瞬间自动展开 LayersPanel + Timeline group 节点)──
  //  用户原话(澄清版):"我说的钻入展开是,当我在图形的上面去点击钻入选中组内元素的时候,图层和时间轴也要同步展开"
  //  目标:editingId 从 null → not-null(双击钻入)时,LayersPanel + Timeline 树里
  //        editingId 自身 + 所有祖先 group 的 expanded 状态自动置 true(可见 children 行)
  //  策略:
  //   1. 用 store.layers 作为唯一真相源,findLayerPath 已经提供祖先链
  //   2. LayersPanel 的 expandedGroups + Timeline 的 expandedLayers 提升到 AnimateView
  //      作为两份独立 Set state(各自语义不同:LayersPanel 只 group/mask,Timeline 任何 layer 可展开)
  //   3. editingId useEffect 监听 not-null 边沿,对 path 上每个 group id add 到两个 set
  //   4. Esc 退出(editingId → null)不强制收起 — 尊重用户当前展开状态
  //   5. 嵌套钻入 outer.inner:钻 outer → path=[outer] add;再钻 inner → path=[outer,inner] add(outer 仍在 set)
  //  撤销:round-12 第一版误读为"timelineH 高度自动回弹"已撤销
  const [expandedGroupsLP, setExpandedGroupsLP] = useState(() => new Set()) // LayersPanel 持有
  const [expandedLayersTL, setExpandedLayersTL] = useState(() => new Set()) // Timeline 持有
  const toggleExpandLP = useCallback((id) => {
    setExpandedGroupsLP(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  const toggleExpandTL = useCallback((id) => {
    setExpandedLayersTL(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  // editingId not-null 边沿:展开 path 上所有 group(含 editingId 自身)
  useEffect(() => {
    if (editingId == null) return
    const path = findLayerPath(useUnifiedMotionStore.getState().layers, editingId)
    if (!path || !path.length) return
    const ids = path.map(p => p.id)
    setExpandedGroupsLP(prev => {
      // 只 add(不 delete),保持已展开的其他 group
      let changed = false
      const next = new Set(prev)
      for (const id of ids) { if (!next.has(id)) { next.add(id); changed = true } }
      return changed ? next : prev
    })
    setExpandedLayersTL(prev => {
      let changed = false
      const next = new Set(prev)
      for (const id of ids) { if (!next.has(id)) { next.add(id); changed = true } }
      return changed ? next : prev
    })
  }, [editingId])

  // ── Mount ──
  useEffect(() => {
    if (savedState?.layers?.length) {
      store.restore(savedState)
    } else {
      store.reset()
      // Import design elements
      if (designInputs[0]?.state) store.importDesignState(designInputs[0].state)
      // Import upstream media (images/videos) as layers
      if (mediaInputs.length) store.importMedia(mediaInputs)
    }
    // Auto-fit preview zoom
    const wrap = previewWrapRef.current
    if (wrap) {
      const r = wrap.getBoundingClientRect()
      const fit = Math.min(r.width / canvasWidth, r.height / canvasHeight) * 0.85
      setPreviewZoom(Math.min(1, fit))
    }
    return () => cancelAnimationFrame(animRef.current)
  }, [nodeId]) // eslint-disable-line

  // ── Auto-save ──
  useEffect(() => {
    clearTimeout(saveRef.current)
    saveRef.current = setTimeout(() => onSaveState?.(useUnifiedMotionStore.getState().serialize()), 500)
    return () => clearTimeout(saveRef.current)
  }, [layers, duration, fps, onSaveState])

  // ── Render (draw on canvas: preview bg + layers + bounds) ──
  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const displayW = Math.round(canvasWidth * previewZoom)
    const displayH = Math.round(canvasHeight * previewZoom)
    c.width = canvasWidth; c.height = canvasHeight
    c.style.width = displayW + 'px'; c.style.height = displayH + 'px'
    const ctx = c.getContext('2d')

    // 1. Preview background (not exported)
    ctx.clearRect(0, 0, canvasWidth, canvasHeight)
    if (bgMode === 'checker') drawChecker(ctx, canvasWidth, canvasHeight)
    else { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, canvasWidth, canvasHeight) }

    // 2. Layers (noClear=true so preview bg is preserved)
    renderFrame(ctx, layers, playhead, canvasWidth, canvasHeight, 'transparent', true)

    // 3. Bounding box(传 layers 让 drawBounds 用 absolute coords,group 内子级才正确)
    //    Round-9 alignment:传 cornerRef.current(4 corner Figma 自适应)+ previewZoom(屏幕 px 视觉常量)
    //    Round-11(2026-06-03):多选时画每个 layer 简化外框(无 anchor / rotater / cr_handle),
    //    单选才走完整 drawBounds(anchors + rotater + cr 全套)
    const idsToBound = (selectedIds && selectedIds.length) ? selectedIds : (selectedLayerId ? [selectedLayerId] : [])
    if (showBounds && idsToBound.length) {
      if (idsToBound.length === 1) {
        const selLayer = findLayerInTree(layers, idsToBound[0])
        if (selLayer && playhead >= selLayer.inPoint && playhead <= selLayer.outPoint) {
          drawBounds(ctx, selLayer, playhead, layers, cornerRef.current, previewZoom)
        }
      } else {
        // 多选:每个画简化外框(虚线 + accent)— 不画 anchor handle,避免多选拖手柄混乱
        ctx.save()
        ctx.strokeStyle = '#a78bfa'
        ctx.lineWidth = 1 / previewZoom
        ctx.setLineDash([4 / previewZoom, 3 / previewZoom])
        for (const id of idsToBound) {
          const l = findLayerInTree(layers, id)
          if (!l || !l.visible || playhead < l.inPoint || playhead > l.outPoint) continue
          const b = getLayerBoundsAbsolute(ctx, id, playhead, layers, false) || getLayerBounds(ctx, l, playhead, false)
          if (!b) continue
          // 2026-06-02 round-12:用 visualW/H 画真视觉 bbox(含 stroke / ellipse 外接圆等)
          const vw = b.visualW != null ? b.visualW : b.w
          const vh = b.visualH != null ? b.visualH : b.h
          ctx.strokeRect(b.cx - vw / 2, b.cy - vh / 2, vw, vh)
        }
        ctx.restore()
      }
    }
    // Round-11:editingId 钻入态高亮外圈(虚线浅紫)— 视觉提示用户当前 editing 范围
    if (editingId) {
      const ed = findLayerInTree(layers, editingId)
      if (ed && ed.visible && playhead >= ed.inPoint && playhead <= ed.outPoint) {
        const b = getLayerBoundsAbsolute(ctx, editingId, playhead, layers, false) || getLayerBounds(ctx, ed, playhead, false)
        if (b) {
          ctx.save()
          ctx.strokeStyle = 'color-mix(in srgb, #a78bfa 60%, transparent)' // canvas 不支持 color-mix
          ctx.strokeStyle = 'rgba(167, 139, 250, 0.55)'
          ctx.lineWidth = 1.5 / previewZoom
          ctx.setLineDash([6 / previewZoom, 4 / previewZoom])
          // 外扩 6px 让钻入框跟选中框区分开
          const pad = 6 / previewZoom
          // 2026-06-02 round-12:用 visualW/H(真视觉 bbox)
          const vw = b.visualW != null ? b.visualW : b.w
          const vh = b.visualH != null ? b.visualH : b.h
          ctx.strokeRect(b.cx - vw / 2 - pad, b.cy - vh / 2 - pad, vw + pad * 2, vh + pad * 2)
          ctx.restore()
        }
      }
    }
  }, [layers, playhead, canvasWidth, canvasHeight, selectedLayerId, selectedIds, editingId, showBounds, previewZoom, bgMode, bgColor, cornerTick])

  // ── Playback ──
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(animRef.current); return }
    let last = performance.now()
    const tick = (now) => {
      // Idle-aware: 标签隐藏时不推进 playhead(Chromium 自带 RAF 1Hz throttle,这里再加 short-circuit
      // 双保险),保留 RAF 链等 visible 后自然继续。重置 last 避免切回时一帧大跳。
      if (useIdleStore.getState().isHidden) {
        last = now
        animRef.current = requestAnimationFrame(tick)
        return
      }
      const s = useUnifiedMotionStore.getState()
      let next = s.playhead + (now - last) / 1000; last = now
      if (next >= s.duration) next = 0
      s.setPlayhead(next)
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [playing])

  const handleClose = useCallback(() => {
    clearTimeout(saveRef.current); store.setPlaying(false)
    onSaveState?.(store.serialize()); onClose?.()
  }, [onClose, onSaveState, store])

  // ── Keyboard ──
  //  Round-9 alignment(2026-06-03):跟 designer DesignerView.jsx 命名规范对齐。
  //  designer 有 V/R/O/T/P/L 形状工具,animate 无形状工具(只动画化已存在的 layer),
  //  所以只对齐"无形状操作语义"的快捷键:
  //   - V          → 清选(deselect),跟 designer V 一致(designer V 切到 select 工具同时 clear)
  //   - Space      → 播放 / 暂停(animate 特有,不冲突)
  //   - K          → 当前 layer 加 transform keyframe(animate 特有)
  //   - Esc        → 关闭画板
  //   - Cmd/Ctrl + Z / Shift+Z / Y → undo/redo(跟 designer 一致)
  //   - Cmd/Ctrl + C / X / V / D    → 复制/剪切/粘贴 keyframe / duplicate 占位(沿用既有处理)
  //   - Delete / Backspace          → 删选中(交给独立 keyframe handler;沿用既有)
  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); store.setPlaying(!store.playing) }
      // Round-11(2026-06-03):Esc 钻入态退一级,顶层时关 Composer(对齐 designer)
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (editingId) {
          const path = findLayerPath(useUnifiedMotionStore.getState().layers, editingId)
          const parentId = (path && path.length >= 2) ? path[path.length - 2].id : null
          // 选中刚退出的 group(对齐 designer 行为)
          store.selectLayer(editingId)
          setEditingId(parentId)
          e.preventDefault()
        } else {
          handleClose()
        }
      }
      if (e.key === 'k' && store.selectedLayerId) { e.preventDefault(); store.pushUndo(); store.addTransformKeyframe(store.selectedLayerId) }
      // V = clear selection(跟 designer V 一致,不创建形状只清选)
      if (!e.metaKey && !e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        e.stopPropagation()
        if (store.selectedLayerId) store.selectLayer(null)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); store.undo() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); store.redo() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); e.stopPropagation(); store.redo() }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [handleClose, store, editingId])

  // ── Canvas coords from screen (accounts for zoom + pan) ──
  const screenToCanvas = useCallback((clientX, clientY) => {
    const wrap = previewWrapRef.current; if (!wrap) return { x: 0, y: 0 }
    const wr = wrap.getBoundingClientRect()
    // Canvas is centered in preview + offset by pan
    const cDisplayW = canvasWidth * previewZoom, cDisplayH = canvasHeight * previewZoom
    const cLeft = (wr.width - cDisplayW) / 2 + previewPan.x
    const cTop = (wr.height - cDisplayH) / 2 + previewPan.y
    return {
      x: (clientX - wr.left - cLeft) / previewZoom,
      y: (clientY - wr.top - cTop) / previewZoom,
    }
  }, [previewZoom, previewPan, canvasWidth, canvasHeight])

  const writeKeyframe = useCallback((layerId, prop, value) => {
    const s = useUnifiedMotionStore.getState()
    const layer = findLayerInTree(s.layers, layerId)
    if (!layer) return
    const kfs = layer.keyframes?.[prop] || []
    // 关键改动(2026-05-29):
    // - keyframes 数组 ≤ 1(只有 importDesignState 自动写入的 init kf at t=0)
    //   → 用户还没"开始做动画",拖动只更新 init kf 的 v(不新增),base 在外面已 updateLayerBase 改了
    //   → wrapper handleAnimateSave 会检测此状态,把 base 回写设计稿
    // - keyframes 数组 ≥ 2 → 用户已显式打过关键帧,正常 record 模式按 playhead 加新 kf
    if (kfs.length <= 1) {
      store.setKeyframe(layerId, prop, 0, value)
      return
    }
    store.setKeyframe(layerId, prop, s.playhead - layer.inPoint, value)
  }, [store])

  // ── Preview interaction ──
  const dragRef = useRef(null)
  const handlePreviewPointerDown = useCallback((e) => {
    const { x: mx, y: my } = screenToCanvas(e.clientX, e.clientY)
    const s = useUnifiedMotionStore.getState()
    // TEMP DEBUG 2026-06-02
    if (typeof window !== 'undefined' && window.__UC_DEBUG_TEXT !== false) {
      window.__UC_DEBUG_TEXT = true
      console.log('[pointer-down]', {
        client: { x: e.clientX, y: e.clientY },
        canvas: { mx: Math.round(mx), my: Math.round(my) },
        zoom: previewZoom, pan: previewPan,
        layers: s.layers.length, selectedId: s.selectedLayerId,
      })
    }

    const c = canvasRef.current
    const getCtx = () => c?.getContext('2d')

    // Check bounding box handles if bounds visible(用 rotated bbox corners)
    // 判定优先级(Round-9 alignment 2026-06-03 跟 designer 一致):
    //   ① cr_handle(rect 圆角)≤ 8 屏幕 px → mode='cornerRadius'
    //   ② Scale handle ≤ 14 屏幕 px → mode='scale'
    //   ③ Rotater 圆(nearest corner 外 22px,radius 11)→ mode='rotate'(优先级高于 ring)
    //   ④ Rotation 14~36 屏幕 px 环 → mode='rotate'(保留旧交互,扩大命中区)
    // Round-11(2026-06-03):anchor handle 仅单选时启用(对齐 designer Transformer 单选行为)
    //   多选时跳过 cornerRadius / scale / rotate 命中,直接走 layer hit / marquee
    const isSingleSelect = ((s.selectedIds && s.selectedIds.length === 1) || (!s.selectedIds?.length && !!s.selectedLayerId))
    if (s.showBounds && s.selectedLayerId && isSingleSelect) {
      const sl = findLayerInTree(s.layers, s.selectedLayerId)
      if (sl && sl.visible && s.playhead >= sl.inPoint && s.playhead <= sl.outPoint) {
        // 2026-06-03:hit test 路径用 base+kf(不含 preset),避免 d.origSX/origBaseX 被 preset delta
        // 污染 → onMove 反推回写 store.base.scaleX 会被叠加二次 preset
        const b = getLayerBoundsAbsolute(getCtx(), sl.id, s.playhead, s.layers, false) || getLayerBounds(getCtx(), sl, s.playhead, false)
        // 2026-06-02 修复:用 b.cx/cy(真视觉中心 world,跟 drawBounds 同源)
        const cx = b.cx, cy = b.cy
        // 2026-06-02 round-12:hit test 也用 visualHW/HH,handles 命中在真视觉角(跟 drawBounds 同源)
        const vHW = (b.visualHW != null ? b.visualHW : (b.bw || 1) / 2)
        const vHH = (b.visualHH != null ? b.visualHH : (b.bh || 1) / 2)
        const hw = vHW * b.scaleX
        const hh = vHH * b.scaleY
        // **rotated 角**,适配 Figma 风:旋转后 handles 跟着转
        const rc = getRotatedCorners(cx, cy, hw, hh, b.rotation || 0)
        const corners = [
          { name: 'TL', x: rc.TL.x, y: rc.TL.y },
          { name: 'TR', x: rc.TR.x, y: rc.TR.y },
          { name: 'BL', x: rc.BL.x, y: rc.BL.y },
          { name: 'BR', x: rc.BR.x, y: rc.BR.y },
        ]
        const px = 1 / previewZoom

        // ① cr_handle(仅 rect):rotated 系下 right-top inset + diagR
        if (sl.type === 'rect') {
          const cr = (b.cornerRadius != null ? b.cornerRadius : (sl.base?.cornerRadius || 0))
          const inset = 16 * px
          const diagR = cr * 0.707
          const rad = (b.rotation || 0) * Math.PI / 180
          const lxR = hw - inset - diagR
          const lyR = -hh + inset + diagR
          const handleWX = cx + lxR * Math.cos(rad) - lyR * Math.sin(rad)
          const handleWY = cy + lxR * Math.sin(rad) + lyR * Math.cos(rad)
          const dhx = mx - handleWX, dhy = my - handleWY
          if (dhx * dhx + dhy * dhy <= (8 * px) * (8 * px)) {
            e.preventDefault(); store.pushUndo()
            isAnimateTransformingRef.current = true
            const w = b.bw || 100, h = b.bh || 100
            const maxR = Math.min(w, h) / 2
            // diag = (dx + dy) / 2 in rotated/local space;newR = diag / 0.707
            // 跟 designer round 8 同算法,只是 designer 用 Konva Group 自动 unrotate,
            // 这里我们手动算 local 系下的 dx/dy(world delta 反旋转)
            dragRef.current = {
              mode: 'cornerRadius',
              id: sl.id,
              cx, cy,
              rad,
              w, h,
              maxR,
              inset,
              startCr: cr,
              startLx: lxR,
              startLy: lyR,
            }
            return
          }
        }

        // ② Scale handle ≤ 14 屏幕 px
        for (const cc of corners) {
          if (Math.sqrt((mx - cc.x) ** 2 + (my - cc.y) ** 2) <= 14 * px) {
            e.preventDefault(); store.pushUndo()
            isAnimateTransformingRef.current = true
            const oppName = { TL: 'BR', TR: 'BL', BL: 'TR', BR: 'TL' }[cc.name]
            const opp = corners.find(x => x.name === oppName)
            const p = computeAnimatedProps(sl, s.playhead)
            // 2026-06-03 round-10:rotation 通用 + 分轴独立 + group children absSx 反推
            // 锁定:rad / cosR / sinR / sign_cc / sign_opp / absSx/Sy / absOffsetX/Y
            // 让 onMove 能正确把鼠标 world delta 转 box local delta + base.x/y 反推支持任意层级
            const rad = (b.rotation || 0) * Math.PI / 180
            const sign_cc = ({
              TL: { x: -1, y: -1 },
              TR: { x: 1,  y: -1 },
              BL: { x: -1, y: 1  },
              BR: { x: 1,  y: 1  },
            })[cc.name] || { x: 1, y: 1 }
            const sign_opp = { x: -sign_cc.x, y: -sign_cc.y }
            // 爬 parents 算 absSx / absSy / absOffsetX / absOffsetY(跟 getLayerBoundsAbsolute 同源)
            // 让 base.x/y 反推时支持 group children:newBaseX = (boxCenterW - absOffsetX) / absSx - cxL
            //                                     cp.scaleX_new = sx_total / absSx(避免父级累积 double scale)
            let absSx = 1, absSy = 1, absOffsetX = 0, absOffsetY = 0
            const path = findLayerPath(s.layers, sl.id) || []
            for (let i = 0; i < path.length - 1; i++) {
              const parent = path[i]
              const pp = computeAnimatedProps(parent, s.playhead)
              const { cx: pcx, cy: pcy } = getGroupChildrenCenter(parent)
              absOffsetX += (pp.x + pcx * (1 - pp.scaleX)) * absSx
              absOffsetY += (pp.y + pcy * (1 - pp.scaleY)) * absSy
              absSx *= pp.scaleX
              absSy *= pp.scaleY
            }
            dragRef.current = {
              mode: 'scale',
              id: sl.id,
              corner: cc.name,
              cx, cy,                                  // box center world 起始
              oppX: opp.x, oppY: opp.y,                // 对角 world 起始(rotated, 用 visual 角)
              origSX: b.scaleX, origSY: b.scaleY,      // total scale 起始(absSx · cp.scaleX)
              origCpSX: p.scaleX, origCpSY: p.scaleY,  // 自身 base+kf scale 起始(无 preset)
              origBaseX: p.x, origBaseY: p.y,
              cxL: b.cxLocal ?? (b.bw || 100) / 2,
              cyL: b.cyLocal ?? (b.bh || 100) / 2,
              // 2026-06-02 round-12:cwL/chL 用 visualHW*2 — corner drawn at cx±vHW·scaleX,
              // 拖 corner 推 newScale = newPixelHW / vHW;跟 drawBounds / hit test 同源。
              cwL: (b.visualHW != null ? b.visualHW * 2 : (b.bw || 100)),
              chL: (b.visualHH != null ? b.visualHH * 2 : (b.bh || 100)),
              startMX: mx, startMY: my,
              rad, cosR: Math.cos(rad), sinR: Math.sin(rad),
              sign_cc, sign_opp,
              absSx, absSy, absOffsetX, absOffsetY,
            }
            return
          }
        }

        // ③ Rotater 圆 hit(designer round 7 自定义 rotater 同等行为)
        const rPos = rotaterPosFromCorner(rc, cx, cy, cornerRef.current, 22 * px)
        const drx = mx - rPos.x, dry = my - rPos.y
        if (drx * drx + dry * dry <= (11 * px) * (11 * px)) {
          e.preventDefault(); store.pushUndo()
          isAnimateTransformingRef.current = true
          const p = computeAnimatedProps(sl, s.playhead)
          const R0 = (b.rotation || 0) * Math.PI / 180
          const dxv = cx - p.x
          const dyv = cy - p.y
          const pcx = dxv * Math.cos(R0) + dyv * Math.sin(R0)
          const pcy = -dxv * Math.sin(R0) + dyv * Math.cos(R0)
          dragRef.current = {
            mode: 'rotate',
            id: sl.id,
            cx, cy,
            pcx, pcy,
            startAngle: Math.atan2(my - cy, mx - cx),
            origRot: b.rotation,
            origBaseX: p.x, origBaseY: p.y,
          }
          return
        }

        // ④ Rotation 14~36 屏幕 px 环(围绕图形最中心 = visual bbox center)
        // **关键修复**:visual bbox center 反 transform 算 local pcx/pcy
        //   原理同设计态:cx, cy 是 visual bbox 中心 world;反逆 origRot 旋转后得到 local center
        //   这样无论 type / scale / children 状态,旋转中心永远是定界框最中心
        for (const cc of corners) {
          const d = Math.sqrt((mx - cc.x) ** 2 + (my - cc.y) ** 2)
          if (d > 14 * px && d < 36 * px) {
            e.preventDefault(); store.pushUndo()
            isAnimateTransformingRef.current = true
            const p = computeAnimatedProps(sl, s.playhead)
            const R0 = (b.rotation || 0) * Math.PI / 180
            const dxv = cx - p.x
            const dyv = cy - p.y
            const pcx = dxv * Math.cos(R0) + dyv * Math.sin(R0)
            const pcy = -dxv * Math.sin(R0) + dyv * Math.cos(R0)
            dragRef.current = {
              mode: 'rotate',
              id: sl.id,
              cx, cy,
              pcx, pcy,
              startAngle: Math.atan2(my - cy, mx - cx),
              origRot: b.rotation,
              origBaseX: p.x, origBaseY: p.y,
            }
            return
          }
        }
      }
    }

    // Round-11(2026-06-03):嵌套 group hit test — 自顶向下,group 默认整组响应,
    //   只在 editingId 链路上才递归进 children。算法对齐 designer KonvaCanvas L1820 handleShapeClick
    //   + Group 渲染 L495-557(closed group `onClick` 整组,`onDblClick` 钻入)。
    //
    //   editingId 闸门:
    //     · editingId === null → 只 hit 顶层 layers,遇 group 整体响应,不进 children
    //     · editingId !== null → 找到 editingId path 链,链上 group 的 children 可命中,
    //                            链外的顶层 group/layer 仍按整组响应。
    //
    //   遍历顺序:同层倒序(数组末尾 = z-order 顶上),遇 group 时按 gate 决定下钻 or 整组选。
    //   bbox 用 base+kf(无 preset),跟 anchor hit / drag start 同源。
    const hitTestInChildren = (layerList) => {
      // 倒序遍历同层 layer(数组末尾 = 渲染最上层)
      for (let i = layerList.length - 1; i >= 0; i--) {
        const l = layerList[i]
        if (!l.visible || s.playhead < l.inPoint || s.playhead > l.outPoint) continue
        const isGroup = (l.type === 'group' || l.type === 'mask') && Array.isArray(l.children) && l.children.length
        // 如果当前 layer 是 group 且是 editingId(用户已钻入),递归进 children
        // 否则用 group 自身 bbox 整体命中(选 group,不进 children)
        if (isGroup && editingId === l.id) {
          const hit = hitTestInChildren(l.children)
          if (hit) return hit
          // editingId 自身整组 bbox 不参与命中(用户已经钻进去了,点空白应该退出)
          continue
        }
        // 这里要么是普通 layer,要么是非 editingId 的 group(整组响应)
        const b = getLayerBoundsAbsolute(getCtx(), l.id, s.playhead, s.layers, false) || getLayerBounds(getCtx(), l, s.playhead, false)
        if (!b) continue
        // axis-aligned 命中用 b.cx/cy ± visualW/H /2(真视觉 box,含 stroke + ellipse 外接圆)
        // 2026-06-02:加 4 屏幕 px hit padding,对齐 Konva 默认 hit 容忍,避免边缘点不中
        // 2026-06-02 round-12:用 visualW/H 替 b.w/h(base box),让 stroke / 外接圆超出 base 时仍能命中
        const HIT_PADDING = 4 / previewZoom
        const hitW = b.visualW != null ? b.visualW : b.w
        const hitH = b.visualH != null ? b.visualH : b.h
        const hbw = hitW / 2 + HIT_PADDING, hbh = hitH / 2 + HIT_PADDING
        const hit = mx >= b.cx - hbw && mx <= b.cx + hbw && my >= b.cy - hbh && my <= b.cy + hbh
        // TEMP DEBUG 2026-06-02
        console.log('[hit-test]', {
          id: l.id, type: l.type,
          ts: l.base?.textSizing, bw: l.base?.width, bh: l.base?.height,
          text: l.base?.text?.slice(0, 20),
          fontSize: l.base?.fontSize,
          mouse: { mx: Math.round(mx), my: Math.round(my) },
          bounds: { cx: Math.round(b.cx), cy: Math.round(b.cy), w: Math.round(b.w), h: Math.round(b.h), bw: b.bw, bh: b.bh, sx: b.scaleX, sy: b.scaleY },
          hbw: Math.round(hbw), hbh: Math.round(hbh),
          hit,
        })
        if (hit) {
          return l
        }
      }
      return null
    }
    // editingId 链路解析:editingId 为 null → 从顶层 layers 开始;
    //                    editingId != null → 找该 group 在 tree 中的 path,从 path 上每一级递进
    let hitLayer = null
    if (editingId) {
      const path = findLayerPath(s.layers, editingId)
      // path 是 [topGroup, ..., editingIdGroup] 含 editingId 自身
      if (path && path.length) {
        // 先在 editingId.children 内找命中(钻入态优先 hit 子级)
        const editingLayer = path[path.length - 1]
        if (editingLayer && Array.isArray(editingLayer.children)) {
          hitLayer = hitTestInChildren(editingLayer.children)
        }
      }
      // 如果钻入态没命中(点了 editingId 外的区域)→ 回退到顶层 hit(可能选其他顶层 group)
      if (!hitLayer) hitLayer = hitTestInChildren(s.layers)
    } else {
      hitLayer = hitTestInChildren(s.layers)
    }

    if (hitLayer) {
      const isShift = !!e.shiftKey
      if (isShift) {
        // shift+click 多选 toggle(对齐 designer L1826)
        store.toggleLayerSelection(hitLayer.id)
        // 多选状态下不直接 drag(避免误移整组)→ 仅切选不进入 move 模式
        e.preventDefault()
        return
      }
      // 非 shift:如果点的 layer 已在多选集里,保留多选(对齐 designer L1830)
      const curSel = useUnifiedMotionStore.getState().selectedIds || []
      const stillInside = curSel.length > 1 && curSel.includes(hitLayer.id)
      if (!stillInside) {
        store.selectLayer(hitLayer.id)
      }
      store.pushUndo()
      isAnimateTransformingRef.current = true
      const p = computeAnimatedProps(hitLayer, s.playhead)
      dragRef.current = { mode: 'move', id: hitLayer.id, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y }
      e.preventDefault()
      return
    }

    // Middle-click or alt+drag: pan(对齐 designer L1320 isPanningRef)
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault()
      dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, origPanX: previewPan.x, origPanY: previewPan.y }
      return
    }

    // ── 空白处:editingId 退一级 + 起 Marquee(对齐 designer L1332-1346) ──
    //   editingId 存在 → 直接退一级钻入(回到外层),不起 marquee
    //   editingId === null → 起 marquee + 暂保留 selection(完成时根据是否拖动决定清/选)
    if (editingId) {
      // 找 editingId 的父 group id(没有 = 顶层)
      const path = findLayerPath(s.layers, editingId)
      // path 至少含 editingId 自身,parent = path[length-2] 或 null
      const parentId = (path && path.length >= 2) ? path[path.length - 2].id : null
      setEditingId(parentId)
      // 选中刚退出的 group(对齐 designer L1339 setSelectedIds([enteredGroupId]))
      store.selectLayer(editingId)
      e.preventDefault()
      return
    }

    // 起 Marquee:记录起点(canvas 坐标 + 屏幕坐标),onMove 内更新视觉
    const sx = e.clientX, sy = e.clientY
    marqueeRef.current = { x1: mx, y1: my, sx1: sx, sy1: sy, sx2: sx, sy2: sy }
    setMarquee({ x1: sx, y1: sy, x2: sx, y2: sy })
    // 暂不清选 — pointer up 时根据 drag 距离决定(< 4px = 单击空白 = 清选;>= 4px = marquee 完成)
  }, [screenToCanvas, store, editingId])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current; if (!d) return
      if (d.mode === 'move') {
        const nx = Math.round(d.origX + (e.clientX - d.startX) / previewZoom)
        const ny = Math.round(d.origY + (e.clientY - d.startY) / previewZoom)
        store.updateLayerBase(d.id, { x: nx, y: ny })
        writeKeyframe(d.id, 'x', nx); writeKeyframe(d.id, 'y', ny)
      } else if (d.mode === 'rotate') {
        // **关键修复**:renderer 内已经 `translate(base.x + cxLocal, base.y + cyLocal) → rotate`,
        //   即绕 box center world 旋转。base.x/y 不改 → box center world 不动 → visual 绕 center 旋转 ✓
        //   之前补偿 base.x/y 是多余的,反而让 layer 平移。
        const { x: mx, y: my } = screenToCanvas(e.clientX, e.clientY)
        const angle = Math.atan2(my - d.cy, mx - d.cx)
        let rot = d.origRot + (angle - d.startAngle) * 180 / Math.PI
        if (e.shiftKey) rot = Math.round(rot / 15) * 15
        else rot = Math.round(rot)
        store.updateLayerBase(d.id, { rotation: rot })
        writeKeyframe(d.id, 'rotation', rot)
      } else if (d.mode === 'scale') {
        // ── 2026-06-03 round-10 缩放算法重写 ──
        //
        // 设计目标(对齐 design Konva Transformer 默认行为):
        //   1. 默认:对角(opp corner)world 固定,鼠标拖的 corner 跟手
        //   2. Alt:box center world 固定(中心缩放)
        //   3. Shift:等比(锁定 aspect ratio,取两轴绝对值大者)
        //   4. 默认无 Shift:**分轴独立**(非等比,跟 Konva Transformer 默认相同)
        //   5. rotation != 0 支持(unrotate to box-local 算)
        //   6. group children 支持(base.x/y 反推除 absSx;base.scaleX 写回除 absSx 避免父级累积二次)
        //
        // 算法(box-local 系,box center 为原点,unrotated):
        //   鼠标 world delta from startMX/startMY → unrotate to box local:
        //     ldx = wdx·cosR + wdy·sinR
        //     ldy = -wdx·sinR + wdy·cosR
        //   被拖 corner local:(sign_cc.x · cwL/2 · scale, sign_cc.y · chL/2 · scale)
        //   鼠标拖动量 = corner local 位移:
        //     ldx = sign_cc.x · cwL/2 · (sx - origSX)
        //   解 sx:sx = origSX + 2·ldx / (sign_cc.x · cwL)
        //
        // base.x 反推(让 opp world 不动 或 box center world 不动):
        //   box center world target:
        //     默认: BCW_new = oppW - rotated((sign_opp.x · cwL/2 · sx, sign_opp.y · chL/2 · sy))
        //     Alt:  BCW_new = startCxCy(box center world 起始 = d.cx, d.cy)
        //   再反推 base.x(支持 group children 嵌套):
        //     BCW = absOffsetX + (cp.x + cxL) · absSx
        //     cp.x = (BCW - absOffsetX) / absSx - cxL
        //   写回:cp.scaleX_new = sx_total / absSx(顶层 absSx=1 无影响)
        const { x: mx, y: my } = screenToCanvas(e.clientX, e.clientY)
        const isAlt = e.altKey
        const isShift = e.shiftKey
        // 鼠标 world delta → unrotate to box-local
        const wdx = mx - d.startMX
        const wdy = my - d.startMY
        const ldx = wdx * d.cosR + wdy * d.sinR
        const ldy = -wdx * d.sinR + wdy * d.cosR
        // Alt 中心缩放:鼠标位移翻倍效应(corner 移 ldx 对应 box 半宽变化 = ldx,所以 sx 公式不变;
        //   不同点只在 pivot)
        let sxRaw = d.origSX + 2 * ldx / (d.sign_cc.x * (d.cwL || 1))
        let syRaw = d.origSY + 2 * ldy / (d.sign_cc.y * (d.chL || 1))
        // Shift 等比:取轴向 ratio 绝对值大者作为 uniform ratio(跟 Konva 等比一致)
        if (isShift) {
          const rx = sxRaw / (d.origSX || 1)
          const ry = syRaw / (d.origSY || 1)
          const r = Math.abs(rx) >= Math.abs(ry) ? rx : ry
          sxRaw = d.origSX * r
          syRaw = d.origSY * r
        }
        // 防 0/极小:总 scale 不低于 0.01(避免 div by 0 / 反向翻转后续逻辑炸)
        const sxTotal = Math.abs(sxRaw) < 0.01 ? (sxRaw < 0 ? -0.01 : 0.01) : sxRaw
        const syTotal = Math.abs(syRaw) < 0.01 ? (syRaw < 0 ? -0.01 : 0.01) : syRaw
        // 写 child 自身 scale(除回父级 absSx,避免 group 嵌套时 double scale)
        const cpSX = parseFloat((sxTotal / (d.absSx || 1)).toFixed(4))
        const cpSY = parseFloat((syTotal / (d.absSy || 1)).toFixed(4))
        // box center world 反推(rotation 通用):
        //   默认:opp world 不动 → BCW_new = oppW - rotated(sign_opp · cwL/2·sx, sign_opp · chL/2·sy)
        //   Alt: BCW_new = 起始 box center world
        let bcwX, bcwY
        if (isAlt) {
          bcwX = d.cx
          bcwY = d.cy
        } else {
          const oppLx = d.sign_opp.x * (d.cwL / 2) * sxTotal
          const oppLy = d.sign_opp.y * (d.chL / 2) * syTotal
          // rotated(oppLx, oppLy) world offset
          const oppWxOff = d.cosR * oppLx - d.sinR * oppLy
          const oppWyOff = d.sinR * oppLx + d.cosR * oppLy
          bcwX = d.oppX - oppWxOff
          bcwY = d.oppY - oppWyOff
        }
        // cp.x 反推:支持父级 group(absSx/absOffsetX)
        const cpX = (bcwX - d.absOffsetX) / (d.absSx || 1) - d.cxL
        const cpY = (bcwY - d.absOffsetY) / (d.absSy || 1) - d.cyL
        const newBaseX = Math.round(cpX)
        const newBaseY = Math.round(cpY)
        store.updateLayerBase(d.id, { scaleX: cpSX, scaleY: cpSY, x: newBaseX, y: newBaseY })
        writeKeyframe(d.id, 'scaleX', cpSX); writeKeyframe(d.id, 'scaleY', cpSY)
        writeKeyframe(d.id, 'x', newBaseX); writeKeyframe(d.id, 'y', newBaseY)
      } else if (d.mode === 'cornerRadius') {
        // Round-9 alignment(2026-06-03):rect 圆角拖动 — 跟 designer Round 8 同算法。
        // 鼠标 world delta 反向旋转回 local 系 → 算 dx/dy → diag = (dx+dy)/2 → newR = diag / 0.707
        // local 系 start point = (startLx, startLy);drag 中算 local pointer = inv(rad) · (mx-cx, my-cy)
        const { x: mx, y: my } = screenToCanvas(e.clientX, e.clientY)
        const cosR = Math.cos(d.rad), sinR = Math.sin(d.rad)
        // world delta from box center → unrotate to local
        const wdx = mx - d.cx, wdy = my - d.cy
        const localPx = wdx * cosR + wdy * sinR
        const localPy = -wdx * sinR + wdy * cosR
        // dx = startLx - localPx (handle 朝中心方向移动 = local x 减小 = dx 增大)
        // dy = localPy - startLy (handle 朝中心方向移动 = local y 增大 = dy 增大)
        const dx = d.startLx - localPx
        const dy = localPy - d.startLy
        const diag = (dx + dy) / 2
        // newR = startCr + diag / 0.707;clamp [0, maxR]
        let newR = d.startCr + diag / 0.707
        if (newR < 0) newR = 0
        if (newR > d.maxR) newR = d.maxR
        store.updateLayerBase(d.id, { cornerRadius: Math.round(newR) })
        writeKeyframe(d.id, 'cornerRadius', Math.round(newR))
      } else if (d.mode === 'pan') {
        setPreviewPan({ x: d.origPanX + (e.clientX - d.startX), y: d.origPanY + (e.clientY - d.startY) })
      }

      // Round-11(2026-06-03):Marquee 拖动期间持续更新视觉矩形
      //   屏幕坐标记 sx2/sy2(给 div 浮层渲染用),canvas 坐标记 x2/y2(给 hit 完成时 bbox 相交用)
      if (marqueeRef.current) {
        const { x: mxC, y: myC } = screenToCanvas(e.clientX, e.clientY)
        marqueeRef.current.x2 = mxC
        marqueeRef.current.y2 = myC
        marqueeRef.current.sx2 = e.clientX
        marqueeRef.current.sy2 = e.clientY
        setMarquee({
          x1: marqueeRef.current.sx1, y1: marqueeRef.current.sy1,
          x2: e.clientX, y2: e.clientY,
        })
      }
    }
    const onUp = (e) => {
      // Round-11:Marquee 完成处理(对齐 designer KonvaCanvas L1554-1561)
      //   · 拖动 < 5px(屏幕)→ 视作单击空白 = 清选
      //   · 拖动 >= 5px → 找所有 axis-aligned bbox 相交的 layer(限制在 editingId 当前层级)→ selectLayers(命中ids)
      if (marqueeRef.current) {
        const m = marqueeRef.current
        const dragSx = Math.abs((m.sx2 ?? m.sx1) - m.sx1)
        const dragSy = Math.abs((m.sy2 ?? m.sy1) - m.sy1)
        marqueeRef.current = null
        setMarquee(null)
        if (dragSx < 5 && dragSy < 5) {
          // 单击空白:清选(对齐 designer L1342 setSelectedIds([]))
          store.clearSelection()
        } else {
          // Marquee 框选 — bbox 相交测试,limit 到 editingId 当前层 children(钻入态)或顶层 layers
          const sNow = useUnifiedMotionStore.getState()
          const c = canvasRef.current
          const ctx = c?.getContext('2d')
          // 限定测试范围(对齐 designer 协议:marquee 只命中当前层级 layer,不跨钻入层)
          let candidates
          if (editingId) {
            const path = findLayerPath(sNow.layers, editingId)
            const ed = path && path.length ? path[path.length - 1] : null
            candidates = ed && Array.isArray(ed.children) ? ed.children : []
          } else {
            candidates = sNow.layers
          }
          const x1 = Math.min(m.x1, m.x2), y1 = Math.min(m.y1, m.y2)
          const x2 = Math.max(m.x1, m.x2), y2 = Math.max(m.y1, m.y2)
          const hitIds = []
          for (const l of candidates) {
            if (!l.visible || sNow.playhead < l.inPoint || sNow.playhead > l.outPoint) continue
            const b = getLayerBoundsAbsolute(ctx, l.id, sNow.playhead, sNow.layers, false) || getLayerBounds(ctx, l, sNow.playhead, false)
            if (!b) continue
            // 2026-06-02 round-12:marquee 用 visualW/H(跟 bbox 同源)
            const vw = b.visualW != null ? b.visualW : b.w
            const vh = b.visualH != null ? b.visualH : b.h
            const bx1 = b.cx - vw / 2, bx2 = b.cx + vw / 2
            const by1 = b.cy - vh / 2, by2 = b.cy + vh / 2
            // AABB intersection
            if (bx1 < x2 && bx2 > x1 && by1 < y2 && by2 > y1) {
              hitIds.push(l.id)
            }
          }
          if (hitIds.length) store.selectLayers(hitIds)
          else store.clearSelection()
        }
      }
      dragRef.current = null
      isAnimateTransformingRef.current = false
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [store, screenToCanvas, writeKeyframe, previewZoom, editingId])

  // Round-11(2026-06-03):双击钻入 group(对齐 designer KonvaCanvas L1810-1815)
  //   · 双击命中 group / mask 且 children 非空 → setEditingId(group.id)
  //   · 嵌套支持:已 editing outer → 双击 inner group(在 outer.children 内)→ setEditingId(inner.id)
  //   · 双击空白 → 退一级钻入(对齐 designer L1799-1808)
  //   · 双击普通 layer(非 group)→ 暂不做行动(designer 那边是 text 进文本编辑,animate 不支持)
  const handlePreviewDoubleClick = useCallback((e) => {
    const { x: mx, y: my } = screenToCanvas(e.clientX, e.clientY)
    const s = useUnifiedMotionStore.getState()
    const c = canvasRef.current
    const ctx = c?.getContext('2d')

    // 复用嵌套 hit test 算法(同 pointerDown):自顶向下,group 默认整组响应
    const hit = (layerList) => {
      for (let i = layerList.length - 1; i >= 0; i--) {
        const l = layerList[i]
        if (!l.visible || s.playhead < l.inPoint || s.playhead > l.outPoint) continue
        const isGroup = (l.type === 'group' || l.type === 'mask') && Array.isArray(l.children) && l.children.length
        // 跟 pointerDown 一致:editingId 上的 group 递归进 children;其他整组测试
        if (isGroup && editingId === l.id) {
          const inner = hit(l.children)
          if (inner) return inner
          continue
        }
        const b = getLayerBoundsAbsolute(ctx, l.id, s.playhead, s.layers, false) || getLayerBounds(ctx, l, s.playhead, false)
        if (!b) continue
        // 2026-06-02 round-12:双击 hit 也用 visualW/H(stroke / 外接圆边缘可命中)
        const hitW = b.visualW != null ? b.visualW : b.w
        const hitH = b.visualH != null ? b.visualH : b.h
        const hbw = hitW / 2, hbh = hitH / 2
        if (mx >= b.cx - hbw && mx <= b.cx + hbw && my >= b.cy - hbh && my <= b.cy + hbh) return l
      }
      return null
    }
    let target = null
    if (editingId) {
      const path = findLayerPath(s.layers, editingId)
      const ed = path && path.length ? path[path.length - 1] : null
      if (ed && Array.isArray(ed.children)) target = hit(ed.children)
      if (!target) target = hit(s.layers)
    } else {
      target = hit(s.layers)
    }

    if (!target) {
      // 空白双击 → 退一级(对齐 designer L1799-1808)
      if (editingId) {
        const path = findLayerPath(s.layers, editingId)
        const parentId = (path && path.length >= 2) ? path[path.length - 2].id : null
        store.selectLayer(editingId)
        setEditingId(parentId)
      }
      return
    }

    const isGroup = (target.type === 'group' || target.type === 'mask') && Array.isArray(target.children) && target.children.length
    if (isGroup) {
      setEditingId(target.id)
      // 钻入后清选当前 group(避免 group 本身仍高亮),让用户看到子级状态
      store.clearSelection()
    }
    // 非 group 双击:不做行动(animate 暂不支持 text 内联编辑等 designer 行为)
  }, [screenToCanvas, store, editingId])

  // ── Preview zoom (scroll wheel) + pan (middle drag / alt+drag) ──
  // 2026-06-02 passive listener 修复:React 17+ JSX onWheel 默认 passive,
  // 在 handler 里调 e.preventDefault() 会触发 "Unable to preventDefault inside
  // passive event listener invocation" 警告刷屏。改走 useEffect 注册原生 wheel
  // 监听 + { passive: false } 显式声明,preventDefault 才生效且不报警。
  useEffect(() => {
    const el = previewWrapRef.current
    if (!el) return
    const handler = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        setPreviewZoom(z => Math.max(0.05, Math.min(4, z * (e.deltaY > 0 ? 0.92 : 1.08))))
      } else {
        e.preventDefault()
        setPreviewPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler, { passive: false })
  }, [])

  // Hover cursor 切换 + 4 corner 自适应(Round-9 alignment 2026-06-03):
  //  优先级:
  //   1. scale 角内 ≤ 14px → nwse / nesw cursor
  //   2. rotater 圆(nearest corner 外 22px,radius 11)→ **cursor 不变**(designer round 7.2 铁律)
  //   3. cr_handle(rect 右上 inset+diagR,radius 6 容差)→ cursor 不变
  //   4. 其他 → default
  //  cornerRef 同步:取光标距 4 corner 最近的(冻结期间不切换),drawBounds 用它定位 rotater
  const handlePreviewPointerMove = useCallback((e) => {
    if (dragRef.current) return
    const c = canvasRef.current
    if (!c) return
    const s = useUnifiedMotionStore.getState()
    // Round-11:多选(selectedIds.length > 1)时,不显示 anchor cursor — 跟 pointerDown gate 对齐
    const isSingleSel = ((s.selectedIds && s.selectedIds.length === 1) || (!s.selectedIds?.length && !!s.selectedLayerId))
    if (!s.showBounds || !s.selectedLayerId || !isSingleSel) { c.style.cursor = 'default'; return }
    const sl = findLayerInTree(s.layers, s.selectedLayerId)
    if (!sl || !sl.visible || s.playhead < sl.inPoint || s.playhead > sl.outPoint) {
      c.style.cursor = 'default'; return
    }
    const { x: mx, y: my } = screenToCanvas(e.clientX, e.clientY)
    const ctx = c.getContext('2d')
    // 光标 hit test 用 base+kf,与 handlePointerDown hit 路径数据同源
    const b = getLayerBoundsAbsolute(ctx, sl.id, s.playhead, s.layers, false) || getLayerBounds(ctx, sl, s.playhead, false)
    if (!b) return
    // 2026-06-02 修复:用 b.cx/cy(真视觉中心 world,跟 drawBounds / pointerDown 同源)
    const cx = b.cx, cy = b.cy
    // 2026-06-02 round-12:用 visualHW/HH(跟 drawBounds 同源,handles 在真视觉角)
    const vHW = (b.visualHW != null ? b.visualHW : (b.bw || 1) / 2)
    const vHH = (b.visualHH != null ? b.visualHH : (b.bh || 1) / 2)
    const hw = vHW * b.scaleX
    const hh = vHH * b.scaleY
    const rc = getRotatedCorners(cx, cy, hw, hh, b.rotation || 0)
    const px = 1 / previewZoom

    // 同步 cornerRef:取光标距 4 corner 最近(冻结期间不动)→ 触发重画
    if (!isAnimateTransformingRef.current) {
      const nearest = nearestCorner(rc, mx, my)
      if (nearest !== cornerRef.current) {
        cornerRef.current = nearest
        setCornerTick(t => t + 1) // 重画 bbox + rotater
      }
    }

    // ① cr_handle hit(仅 rect):rotated 系下 right-top inset + diagR
    if (sl.type === 'rect') {
      const cr = (b.cornerRadius != null ? b.cornerRadius : (sl.base?.cornerRadius || 0))
      const inset = 16 * px
      const diagR = cr * 0.707
      // rect 在 rotated 系下 local top-right corner = (hw, -hh),inset 后 = (hw - inset - diagR, -hh + inset + diagR)
      const rad = (b.rotation || 0) * Math.PI / 180
      const lxR = hw - inset - diagR
      const lyR = -hh + inset + diagR
      const handleWX = cx + lxR * Math.cos(rad) - lyR * Math.sin(rad)
      const handleWY = cy + lxR * Math.sin(rad) + lyR * Math.cos(rad)
      const dhx = mx - handleWX, dhy = my - handleWY
      if (dhx * dhx + dhy * dhy <= (8 * px) * (8 * px)) {
        c.style.cursor = 'default' // designer round 7.2 同样:cr_handle hover 不改 cursor
        return
      }
    }

    const corners = [
      { name: 'TL', x: rc.TL.x, y: rc.TL.y },
      { name: 'TR', x: rc.TR.x, y: rc.TR.y },
      { name: 'BL', x: rc.BL.x, y: rc.BL.y },
      { name: 'BR', x: rc.BR.x, y: rc.BR.y },
    ]

    // ② scale 角内 ≤ 14px(屏幕 px)
    for (const cc of corners) {
      if (Math.sqrt((mx - cc.x) ** 2 + (my - cc.y) ** 2) <= 14 * px) {
        c.style.cursor = SCALE_CURSORS[cc.name]
        return
      }
    }

    // ③ rotater 圆 hit(nearest corner 外 22px,radius 11 屏幕 px) — cursor 不变
    const rPos = rotaterPosFromCorner(rc, cx, cy, cornerRef.current, 22 * px)
    const drx = mx - rPos.x, dry = my - rPos.y
    if (drx * drx + dry * dry <= (11 * px) * (11 * px)) {
      c.style.cursor = 'default'
      return
    }

    // ④ 14~36px 圆环(rotate 操作区域)cursor 仍按设计态对齐:不改(默认指针)
    //    旧版本用 ROTATE_CURSORS 弧形箭头,跟 designer round 7.2 不一致 → 删除
    //    (保留 ROTATE_CURSORS 常量给老用户视觉对照,不再 set)
    c.style.cursor = 'default'
  }, [screenToCanvas, previewZoom])

  // ── Panel resize ──
  const handleTlResize = useCallback((e) => {
    e.preventDefault()
    const startY = e.clientY, startH = timelineH
    const onMove = (ev) => setTimelineH(Math.max(100, Math.min(500, startH + (startY - ev.clientY))))
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }, [timelineH])

  const handleRightResize = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX, startW = rightW
    const onMove = (ev) => setRightW(Math.max(180, Math.min(450, startW + (startX - ev.clientX))))
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }, [rightW])

  const selectedLayer = findLayerInTree(layers, selectedLayerId)
  const PX_PER_SEC = 80 * tlZoom

  return (
    <div className="ua">
      {/* ── Top bar ── */}
      <div className="ua__top">
        {topbarCenter ? (
          <button className="ua__btn ua__btn--sm" onClick={handleClose} data-tip="返回画板">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        ) : (
          <span className="ua__title">动画合成</span>
        )}
        <div className="ua__spacer" />
        {topbarCenter && (
          <>
            <div className="ua__top-center-slot">{topbarCenter}</div>
            <div className="ua__spacer" />
          </>
        )}
        <button className="ua__btn ua__btn--sm" onClick={() => store.undo()} data-tip="⌘Z">↩</button>
        <button className="ua__btn ua__btn--sm" onClick={() => store.redo()} data-tip="⌘⇧Z">↪</button>
        <div className="ua__sep" />
        <button className={`ua__btn ua__btn--sm${showBounds ? ' ua__btn--accent' : ''}`}
          onClick={() => store.toggleBounds()} data-tip="定界框">⬚</button>
        <div className="ua__sep" />
        <label className="ua__top-field">时长
          <NumDragInput value={duration} min={1} max={120} step={0.5} onChange={v => store.setDuration(v)} title="动画时长 (秒) · 左右拖动调值" />秒
        </label>
        <label className="ua__top-field">FPS
          <NumDragInput value={fps} min={1} max={60} step={1} onChange={v => store.setFps(v)} title="帧率 · 左右拖动调值" />
        </label>
        {/*
         * 导出 MP4(2026-06-02)
         *
         * 路径:WebCodecs VideoEncoder (avc1.640028 / H.264 High@4.0) + mp4-muxer 封装 MP4 容器
         * 帧率:严格按 store.fps(默认 30),每帧 timestamp = i * 1/fps 微秒,不受浏览器节流影响
         * 时长:store.duration(秒),总帧数 = ceil(fps * duration)
         * 透明:MP4 H.264 不支持 alpha,backgroundColor='transparent' 在 exporterMp4 内部强制改白底
         *       透明导出走旁边"导出预合成"按钮(WebM VP9 alpha)
         *
         * 与"导出预合成"区别:格式 mp4 vs webm-alpha;App.jsx onExport L586 现按 blob.type 推 ext
         */}
        <button className={`ua__btn ua__btn--accent${exporting ? ' ua__btn--disabled' : ''}`}
          disabled={exporting}
          data-tip={`导出 MP4(H.264) · ${fps} FPS · ${duration}秒`}
          onClick={async () => {
            if (exporting) return
            store.setPlaying(false); setExporting(true); setExportProgress(0)
            try {
              const s = useUnifiedMotionStore.getState()
              const blob = await exportMotionMp4({ layers: s.layers, canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight, backgroundColor: s.backgroundColor, fps: s.fps, duration: s.duration, onProgress: setExportProgress })
              onExport?.(blob)
            } catch (err) { console.error('[UnifiedComposer] MP4 export failed:', err); alert('MP4 导出失败:' + (err?.message || err)) }
            setExporting(false)
          }}>
          {exporting ? `导出 ${Math.round(exportProgress * 100)}%` : '导出 MP4'}
        </button>
        {/*
         * 导出预合成(2026-06-03 Phase 1 MVP)
         *
         * 用途:把当前 animate 时间轴录成 **透明底 WebM**,自动生成下游 video 节点。
         *      用户再手动拉线从该 video 节点 → VideoComposer(剪辑节点)即完成"预合成导入"。
         *
         * 与"导出"按钮的区别:
         *  - "导出":使用 store.backgroundColor(用户在设计态设的底色,默认 #ffffff 白)
         *  - "导出预合成":强制 backgroundColor='transparent',renderer L525
         *    `if (bg && bg !== 'transparent') ctx.fillRect(...)` 自动跳过填底,VP9/VP8 alpha 保留
         *  - 不修改 store(纯参数覆盖)→ 用户的 designState.backgroundColor 不变
         *
         * 触发的导出走与"导出"完全同一条 onExport 路径(App.jsx unifiedNodeId 那段):
         *  → saveMedia(blob) → loadMediaUrl → store.addNode('video', { mediaUrl, mediaId }) →
         *    store.addConnection(unifiedNodeId, newNodeId)
         *  → 用户从新的 video 节点拉线到 VideoComposer 节点(node.type='videocompose')
         *  → VideoComposer 的 mediaInputs 协议(App.jsx L432)接受任何 type='video' + mediaUrl 的上游
         *
         * Phase 2(后续):连线监听 — UC → 剪辑节点 connection add 自动触发,免去手动按钮 + 拉线步骤。
         */}
        <button className={`ua__btn${exporting ? ' ua__btn--disabled' : ''}`}
          disabled={exporting}
          data-tip="录制为透明底 WebM,作为预合成素材导入剪辑节点"
          onClick={async () => {
            if (exporting) return
            store.setPlaying(false); setExporting(true); setExportProgress(0)
            try {
              const s = useUnifiedMotionStore.getState()
              // 强制 backgroundColor='transparent' 覆盖 store 值;exporter 透传给 renderer,
              // 后者只在 backgroundColor !== 'transparent' 时填底,自然出 alpha=0 的 WebM。
              const blob = await exportMotion({
                layers: s.layers,
                canvasWidth: s.canvasWidth,
                canvasHeight: s.canvasHeight,
                backgroundColor: 'transparent',
                fps: s.fps,
                duration: s.duration,
                onProgress: setExportProgress,
              })
              onExport?.(blob)
            } catch (err) { console.error('[UnifiedComposer] Pre-comp export failed:', err) }
            setExporting(false)
          }}>
          {exporting ? `预合成 ${Math.round(exportProgress * 100)}%` : '导出预合成'}
        </button>
        <button className="btn-secondary" onClick={handleClose}>关闭</button>
      </div>

      {/* ── Main ── */}
      <div className="ua__main" style={{ flex: 1 }}>
        {/* 左侧:fork designer LayersPanel(图层列表样式跟设计态一致) */}
        <aside className="ua__left">
          <LayersPanel expandedGroups={expandedGroupsLP} toggleExpand={toggleExpandLP} />
        </aside>

        <div className="ua__preview" ref={previewWrapRef}>
          <canvas ref={canvasRef}
            onPointerDown={handlePreviewPointerDown}
            onPointerMove={handlePreviewPointerMove}
            onDoubleClick={handlePreviewDoubleClick}
            style={{
              transform: `translate(${previewPan.x}px, ${previewPan.y}px)`,
            }} />
          {/* Round-11(2026-06-03):Marquee 框选浮层 — DOM div 不污染 Canvas 2D 自绘
              坐标:屏幕 px(直接来自 client coord),用 fixed 定位,跨越所有 pan/zoom */}
          {marquee && (() => {
            const wr = previewWrapRef.current?.getBoundingClientRect()
            if (!wr) return null
            const x1 = Math.min(marquee.x1, marquee.x2) - wr.left
            const y1 = Math.min(marquee.y1, marquee.y2) - wr.top
            const w = Math.abs(marquee.x2 - marquee.x1)
            const h = Math.abs(marquee.y2 - marquee.y1)
            return (
              <div className="ua__marquee" style={{
                position: 'absolute', left: x1, top: y1, width: w, height: h,
                border: '1px solid var(--accent, #a78bfa)',
                background: 'color-mix(in srgb, var(--accent, #a78bfa) 12%, transparent)',
                pointerEvents: 'none', zIndex: 5,
              }} />
            )
          })()}
          {/* Round-11:钻入态指示器 — 顶部条显示当前 editing 路径,Esc 退一级 */}
          {editingId && (() => {
            const path = findLayerPath(layers, editingId) || []
            const trail = path.map(p => p.name || p.type).join(' › ')
            return (
              <div className="ua__breadcrumb" style={{
                position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                padding: '4px 12px', borderRadius: 12,
                background: 'color-mix(in srgb, var(--accent, #a78bfa) 18%, var(--glass-bg, rgba(20,20,30,0.7)))',
                border: '1px solid color-mix(in srgb, var(--accent, #a78bfa) 40%, transparent)',
                color: 'var(--accent-fg, #fff)', fontSize: 12, zIndex: 6, pointerEvents: 'none',
                whiteSpace: 'nowrap', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis',
              }} data-tip={`已钻入:${trail}。Esc 退出。`}>
                ⌬ 编辑 {trail}
              </div>
            )
          })()}
          {/* Preview floating controls */}
          <div className="ua__preview-bar">
            <button className="ua__pbtn" onClick={() => setBgMode(m => BG_MODES[(BG_MODES.indexOf(m) + 1) % BG_MODES.length])}
              data-tip="预览背景（不导出）">{BG_LABELS[bgMode]}</button>
            {bgMode === 'color' && (
              <input type="color" className="ua__pbtn-color" value={bgColor} onChange={e => setBgColor(e.target.value)} data-tip="选择预览背景色" />
            )}
            <span className="ua__pbtn ua__pbtn--label">{Math.round(previewZoom * 100)}%</span>
            <button className="ua__pbtn" onClick={() => {
              const wrap = previewWrapRef.current
              if (wrap) {
                const r = wrap.getBoundingClientRect()
                setPreviewZoom(Math.min(1, Math.min(r.width / canvasWidth, r.height / canvasHeight) * 0.85))
              } else setPreviewZoom(0.5)
              setPreviewPan({ x: 0, y: 0 })
            }} data-tip="重置视图">适应</button>
          </div>
        </div>

        <div className="ua__resize-v" onPointerDown={handleRightResize} />

        <div className="ua__right" style={{ width: rightW }}>
          {/* 图层列表已移到左侧 ua__left,这里只剩 KeyframePanel */}
          <div style={{ flex: '1 1 auto', overflow: 'auto', minHeight: 0 }}>
            {selectedLayer ? (
              <KeyframePanel layer={selectedLayer} playhead={playhead} store={store}
                onOpenPresets={(stage) => setPresetPickerStage(stage)} />
            ) : (
              <div className="ua__empty" style={{ padding: 32, textAlign: 'center' }}>
                在左侧选中图层后<br/>这里显示动画关键帧 / 预设
              </div>
            )}
          </div>
          {/* [Eas-Term 移植] AI 动画助手入口(ua__kp-ai-bar)已剥离 */}
        </div>
      </div>

      <div className="ua__resize-h" onPointerDown={handleTlResize} />

      <Timeline layers={layers} selectedLayerId={selectedLayerId} playhead={playhead}
        duration={duration} fps={fps} pxPerSec={PX_PER_SEC} zoom={tlZoom} store={store} height={timelineH}
        expandedLayers={expandedLayersTL} toggleExpand={toggleExpandTL} />

      {presetPickerStage && selectedLayer && (
        <PresetAnimationPicker
          layer={selectedLayer}
          initialStage={presetPickerStage}
          store={store}
          onClose={() => setPresetPickerStage(null)}
        />
      )}

      {/* [Eas-Term 移植] AI 动画助手 modal(MotionAIModal)已剥离 */}
    </div>
  )
}

/* ═══ Keyframe Panel ═══ */
const PRESET_STAGES = [
  { key: 'enter', label: '入场' },
  { key: 'continuous', label: '持续' },
  { key: 'exit', label: '出场' },
]
/**
 * NumDragInput — 横向拖值数字控件(Figma / AE / Blender 标准交互)
 *
 * 交互:
 *  - 横向拖动 → 实时改 value(dx × step)
 *  - 不拖直接 mouseup → 进入编辑模式(input focus + 全选)
 *  - Shift = 10× step(粗调)
 *  - Alt = 0.1× step(细调)
 *  - Enter 确认 / Esc 撤销
 *  - 拖动时整页 cursor: ew-resize
 */
function NumDragInput({ value, step = 1, min, max, onChange, className = '', title }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value ?? 0))
  const inputRef = useRef(null)

  useEffect(() => {
    if (!editing) setDraft(String(value ?? 0))
  }, [value, editing])

  const clamp = (v) => {
    let n = v
    if (typeof min === 'number') n = Math.max(min, n)
    if (typeof max === 'number') n = Math.min(max, n)
    const decimals = step.toString().split('.')[1]?.length || 0
    return parseFloat(n.toFixed(Math.max(2, decimals)))
  }

  const handlePointerDown = (e) => {
    if (editing) return
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startVal = typeof value === 'number' ? value : 0
    let moved = false
    let lastVal = startVal

    const onMove = (ev) => {
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) < 3) return
      moved = true
      const scale = ev.shiftKey ? step * 10 : ev.altKey ? step * 0.1 : step
      const next = clamp(startVal + dx * scale)
      if (next !== lastVal) {
        onChange?.(next)
        lastVal = next
      }
    }
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      if (!moved) {
        setEditing(true)
        requestAnimationFrame(() => {
          inputRef.current?.focus()
          inputRef.current?.select?.()
        })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'ew-resize'
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        className={`ua__numdrag-input ${className}`}
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseFloat(draft)
          if (!isNaN(n)) onChange?.(clamp(n))
          setEditing(false)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.target.blur() }
          if (e.key === 'Escape') { setDraft(String(value)); setEditing(false) }
        }}
      />
    )
  }

  return (
    <div
      className={`ua__numdrag ${className}`}
      onPointerDown={handlePointerDown}
      data-tip={title || '左右拖动改值 · 单击编辑 · Shift 大步 · Alt 细调'}
    >
      {typeof value === 'number' ? parseFloat(value.toFixed(2)) : value}
    </div>
  )
}

function KeyframePanel({ layer, playhead, store, onOpenPresets }) {
  const lt = playhead - layer.inPoint
  const presets = layer.presets || { enter: null, continuous: null, exit: null }
  return (
    <div className="ua__kf-panel">
      {/* Preset animation row */}
      <div className="ua__preset-bar">
        <div className="ua__preset-bar-title">预设动画</div>
        <div className="ua__preset-chips">
          {PRESET_STAGES.map(({ key, label }) => {
            const cfg = presets[key]
            const meta = cfg ? (getPresetMeta(key, cfg.name) || PRESETS_LIB.textChar?.[cfg.name]) : null
            const has = !!meta
            return (
              <div key={key} className={`ua__preset-chip${has ? ' ua__preset-chip--on' : ''}`}>
                <button className="ua__preset-chip-btn" onClick={() => onOpenPresets?.(key)}
                  data-tip={has ? `${label}: ${meta.label}` : `添加${label}动画`}>
                  <span className="ua__preset-chip-stage">{label}</span>
                  <span className="ua__preset-chip-name">{has ? meta.label : '无'}</span>
                </button>
                {has && (
                  <button className="ua__preset-chip-clear" onClick={() => { store.pushUndo(); store.clearLayerPreset(layer.id, key) }}
                    data-tip="清除">×</button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="ua__kf-head">
        关键帧
        <button className="ua__btn ua__btn--sm" onClick={() => { store.pushUndo(); store.addTransformKeyframe(layer.id) }} data-tip="K">+ 全部</button>
      </div>
      {ANIM_PROPS.filter(p => !p.types || p.types.includes(layer.type)).map(({ key, label, step, min, max }) => {
        const kfs = layer.keyframes?.[key] || []
        const baseVal = layer.base[key] ?? (key === 'opacity' || key === 'scaleX' || key === 'scaleY' ? 1 : 0)
        const hasKf = kfs.some(k => Math.abs(k.t - lt) < 0.02)
        const curKf = kfs.find(k => Math.abs(k.t - lt) < 0.02)
        const val = curKf ? curKf.v : baseVal
        return (
          <div key={key} className="ua__kf-row">
            <span className="ua__kf-label">{label}</span>
            <NumDragInput
              className="ua__kf-input"
              value={val}
              step={step}
              min={min}
              max={max}
              onChange={v => {
                store.pushUndo()
                store.updateLayerBase(layer.id, { [key]: v })
                store.setKeyframe(layer.id, key, lt, v)
              }}
              title={`${label} · 左右拖动调值 · Shift 大步 · Alt 细调`}
            />
            <button className={`ua__kf-diamond${hasKf ? ' ua__kf-diamond--on' : ''}`}
              onClick={() => { store.pushUndo(); hasKf ? store.removeKeyframe(layer.id, key, lt) : store.setKeyframe(layer.id, key, lt, baseVal) }}
              data-tip={hasKf ? '删除关键帧' : '添加关键帧'}>◆</button>
            {hasKf && (
              <select className="ua__kf-easing" value={curKf?.easing || 'easeOut'}
                onChange={e => { store.pushUndo(); store.setKeyframe(layer.id, key, lt, curKf.v, e.target.value) }}>
                {EASING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ═══ Timeline ═══ */
const ANIM_PROP_LABELS = {
  x: '位置 X', y: '位置 Y',
  opacity: '不透明度', rotation: '旋转',
  scaleX: '缩放 X', scaleY: '缩放 Y',
  cornerRadius: '圆角',
}
const ANIM_PROP_ORDER = ['x', 'y', 'opacity', 'rotation', 'scaleX', 'scaleY', 'cornerRadius']

/* AE 风格 — 每个 easing 一个独立的 kf 形状 + 颜色,用户能一眼看出 */
const EASING_PRESETS_BEZIER = {
  linear:    [0,    0,    1,    1   ],
  easeIn:    [0.42, 0,    1,    1   ],
  easeOut:   [0,    0,    0.58, 1   ],
  easeInOut: [0.42, 0,    0.58, 1   ],
  spring:    [0.34, 1.56, 0.64, 1.0 ],
}

/** 解析 kf.easing 为字符串类型(用于视觉 / bezier 转换):
 *  - 数组 → 'bezier'(自定义)
 *  - 字符串 → 原值
 */
function getEasingKind(easing) {
  if (Array.isArray(easing) && easing.length === 4) return 'bezier'
  return easing || 'easeOut'
}

/** kf 视觉颜色 — 按 easing 类型(AE-like) */
const KF_COLORS = {
  linear:    '#ffffff',   // 白菱形
  easeIn:    '#fbbf24',   // 黄
  easeOut:   '#34d399',   // 绿
  easeInOut: '#60a5fa',   // 蓝
  spring:    '#f472b6',   // 粉
  hold:      '#a78bfa',   // 紫
  bezier:    '#fde047',   // 亮黄(自定义)
}

/** 渲染 kf 形状 — 不同 easing 不同 SVG,AE-style 区分一目了然 */
function KfShape({ easing, isPreset, isGroupActive }) {
  const kind = getEasingKind(easing)
  const color = isPreset ? 'var(--accent)' : KF_COLORS[kind] || '#fff'
  const stroke = isGroupActive ? 'var(--accent)' : 'rgba(0,0,0,0.4)'
  const sw = isGroupActive ? 2 : 0.8

  // 12×12 viewBox,中心 (6,6)
  switch (kind) {
    case 'linear':
      // 标准菱形(直线插值)
      return (
        <svg viewBox="0 0 12 12" width="12" height="12">
          <polygon points="6,1 11,6 6,11 1,6" fill={color} stroke={stroke} strokeWidth={sw} />
        </svg>
      )
    case 'easeIn':
      // 左实右虚菱形(慢→快,左半填满)
      return (
        <svg viewBox="0 0 12 12" width="12" height="12">
          <polygon points="6,1 11,6 6,11 1,6" fill="none" stroke={color} strokeWidth="1.2" />
          <polygon points="6,1 6,11 1,6" fill={color} />
        </svg>
      )
    case 'easeOut':
      // 右实左虚菱形(快→慢)
      return (
        <svg viewBox="0 0 12 12" width="12" height="12">
          <polygon points="6,1 11,6 6,11 1,6" fill="none" stroke={color} strokeWidth="1.2" />
          <polygon points="6,1 11,6 6,11" fill={color} />
        </svg>
      )
    case 'easeInOut':
      // 沙漏(两个三角对扣 — 中间细 = AE 沙漏标志)
      return (
        <svg viewBox="0 0 12 12" width="12" height="12">
          <polygon points="1,1 11,1 6,6 11,11 1,11 6,6" fill={color} stroke={stroke} strokeWidth={sw} />
        </svg>
      )
    case 'spring':
      // 菱形 + 外圈光晕(弹性)
      return (
        <svg viewBox="0 0 14 14" width="14" height="14">
          <polygon points="7,2 12,7 7,12 2,7" fill={color} stroke={stroke} strokeWidth={sw} />
          <polygon points="7,0 13,7 7,14 1,7" fill="none" stroke={color} strokeWidth="0.7" opacity="0.5" />
        </svg>
      )
    case 'hold':
      // 方块(右半空 — 暗示跳变)
      return (
        <svg viewBox="0 0 12 12" width="12" height="12">
          <rect x="1" y="1" width="10" height="10" fill="none" stroke={color} strokeWidth="1.2" />
          <rect x="1" y="1" width="5" height="10" fill={color} />
        </svg>
      )
    case 'bezier':
      // 圆形(自定义贝塞尔,跟 AE 一样)
      return (
        <svg viewBox="0 0 12 12" width="12" height="12">
          <circle cx="6" cy="6" r="4.5" fill={color} stroke={stroke} strokeWidth={sw} />
          <circle cx="6" cy="6" r="2" fill="rgba(0,0,0,0.4)" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 12 12" width="12" height="12">
          <polygon points="6,1 11,6 6,11 1,6" fill={color} stroke={stroke} strokeWidth={sw} />
        </svg>
      )
  }
}

function Timeline({ layers, selectedLayerId, playhead, duration, fps, pxPerSec, zoom, store, height, expandedLayers: expandedLayersProp, toggleExpand: toggleExpandProp }) {
  const bodyRef = useRef(null)
  const draggingRef = useRef(false)

  // 展开/折叠 layer(显示每属性子轨道)
  //  Round-12: expandedLayers + toggleExpand 由父级 AnimateView 持有(支持钻入时
  //  editingId path 上 group 同步展开)。fallback 本地 state 仅供测试场景(props 未传时)。
  const [expandedLayersLocal, setExpandedLayersLocal] = useState(new Set())
  const expandedLayers = expandedLayersProp || expandedLayersLocal
  const toggleExpand = useCallback((id) => {
    if (toggleExpandProp) { toggleExpandProp(id); return }
    setExpandedLayersLocal(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [toggleExpandProp])

  // graph mode:每 (layerId-prop) 一个开关,开后子轨道高度扩大显示插值曲线
  const [graphTracks, setGraphTracks] = useState(new Set())
  const toggleGraph = useCallback((lid, prop) => {
    setGraphTracks(prev => {
      const k = `${lid}|${prop}`
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }, [])

  // 右键菜单 state
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, layerId, prop, kf }

  // ── kf 选中 state(点击选中,Backspace 删除)──
  const [selectedKfs, setSelectedKfs] = useState(new Set()) // Set of 'layerId|prop|t.toFixed(4)'
  const selectedKfsRef = useRef(selectedKfs)
  useEffect(() => { selectedKfsRef.current = selectedKfs }, [selectedKfs])

  const kfKey = useCallback((layerId, prop, kf) => {
    const t = (kf && typeof kf.t === 'number' && isFinite(kf.t)) ? kf.t : 0
    return `${layerId}|${prop}|${t.toFixed(4)}`
  }, [])

  // ── Timeline Marquee 框选(2026-06-04 task #86 Phase 1)──
  //   - 在 ua__tl-tracks 区(不命中 kf-wrap / tl-bar / stretch-handle)Shift+drag 起 marquee
  //   - 也支持普通 drag,但仅在非 ruler 区(避免破坏 playhead 拖动)
  //   - state.bodyRect = container 屏幕坐标快照(onMove 内省略 getBoundingClientRect)
  //   - state.x1/y1/x2/y2 = body-local 坐标(left/top 相对 bodyRef)
  //   - 用 ref 镜像供 onMove/onUp 闭包读取
  const [tlMarquee, setTlMarquee] = useState(null) // {x1,y1,x2,y2}
  const tlMarqueeRef = useRef(null) // {x1,y1,x2,y2,bodyRect,additive}

  // ── 拉伸手柄(stretch handles)─────────────────────
  //   - 当 selectedKfs 跨 ≥ 2 个 unique time 时,在 tracks 区上方画 2 个手柄
  //   - 拖左手柄:newStart 改,newEnd 保持(整体压缩/延展)
  //   - 拖右手柄:newEnd 改,newStart 保持
  //   - 拖拽期间用 stretchPreview ref 实时驱动 kf 视觉位置(不写 store);
  //     onUp 调 store.batchScaleKeyframes(ops) 一次性原子提交。
  //   - stretchPreview = { oldStart, oldEnd, newStart, newEnd } | null
  //     渲染层用 mapKfTime(originalT) 算出 displayT。
  const [stretchPreview, setStretchPreview] = useState(null)
  const stretchDraggingRef = useRef(null) // 'left' | 'right' | null

  /**
   * 解析 kfKey 回 {layerId, prop, t}
   *  - key 形如 'layerId|prop|t.toFixed(4)'
   *  - layerId 可能含 '|'?目前 nanoid/uuid 不含 '|',但用 lastIndexOf 兜底
   */
  const parseKfKey = useCallback((key) => {
    const i2 = key.lastIndexOf('|')
    const tStr = key.slice(i2 + 1)
    const rest = key.slice(0, i2)
    const i1 = rest.lastIndexOf('|')
    const prop = rest.slice(i1 + 1)
    const layerId = rest.slice(0, i1)
    return { layerId, prop, t: parseFloat(tStr) }
  }, [])

  /**
   * 重映射函数:线性 remap (oldStart, oldEnd) → (newStart, newEnd)
   *  - 若 oldRange 长度为 0(防 NaN/Inf),退化为整体平移 = originalT + (newStart - oldStart)
   */
  const remapTime = useCallback((originalT, oldStart, oldEnd, newStart, newEnd) => {
    const oldRange = oldEnd - oldStart
    if (Math.abs(oldRange) < 1e-6) return originalT + (newStart - oldStart)
    const ratio = (originalT - oldStart) / oldRange
    return newStart + ratio * (newEnd - newStart)
  }, [])

  /**
   * 拖拽期间的视觉位置映射 — 给渲染层用:
   *   kf 在 selectedKfs 中且 stretchPreview 激活 → 返回新 displayT
   *   否则 → 返回 kf.t 原值
   */
  const getDisplayT = useCallback((layerId, prop, kf) => {
    if (!stretchPreview) return kf.t
    const key = kfKey(layerId, prop, kf)
    if (!selectedKfs.has(key)) return kf.t
    const { oldStart, oldEnd, newStart, newEnd } = stretchPreview
    return remapTime(kf.t, oldStart, oldEnd, newStart, newEnd)
  }, [stretchPreview, selectedKfs, kfKey, remapTime])

  // 点击 kf:选中(配合 Shift/Cmd 多选)
  const handleKfClick = useCallback((e, layer, prop, kf) => {
    // 不响应双击的第一次 click(等 doubleclick 后再去重)
    if (e.detail >= 2) return
    e.stopPropagation()
    const key = kfKey(layer.id, prop, kf)
    setSelectedKfs(prev => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key); else next.add(key)
        return next
      }
      return new Set([key])
    })
  }, [kfKey])

  // Backspace / Delete:删选中 kf
  useEffect(() => {
    const fn = (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      const sel = selectedKfsRef.current
      if (sel.size === 0) return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      const s = useUnifiedMotionStore.getState()
      s.pushUndo()
      for (const key of sel) {
        const idx = key.lastIndexOf('|')
        const tStr = key.slice(idx + 1)
        const rest = key.slice(0, idx)
        const propIdx = rest.lastIndexOf('|')
        const prop = rest.slice(propIdx + 1)
        const layerId = rest.slice(0, propIdx)
        const t = parseFloat(tStr)
        const layer = findLayerInTree(s.layers, layerId)
        const kfFound = layer?.keyframes?.[prop]?.find(k => Math.abs(k.t - t) < 0.001)
        // 预设组的 kf 不允许单独删(必须 breakPresetGroup 或 stage 清空)
        if (kfFound?.presetGroupId) continue
        s.removeKeyframeAt(layerId, prop, t)
      }
      setSelectedKfs(new Set())
    }
    // capture phase + 在 UnifiedComposer wrapper 兜底之内层 — React 子组件 effect 先挂,所以 fired
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  }, [])

  // Esc:取消选中
  useEffect(() => {
    const fn = (e) => {
      if (e.key !== 'Escape') return
      if (selectedKfsRef.current.size === 0) return
      // 仅在有选中时拦截,让 wrapper 的 Esc 关闭仍然工作(空选时)
      e.stopPropagation()
      setSelectedKfs(new Set())
    }
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  }, [])

  // ── kf 剪贴板(2026-05-31 用户需求:Cmd+C / Cmd+V)──
  // 内容形式:[{prop, v, easing, originalT}]
  // - Cmd+C:把选中 kf 全部 snapshot
  // - Cmd+V:在选中 layer 同 prop 的 playhead 位置创建新 kf(若多个,保持相对时间)
  const kfClipboardRef = useRef([])

  useEffect(() => {
    const onCopy = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'c') return
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      const sel = selectedKfsRef.current
      if (sel.size === 0) return
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
      const s = useUnifiedMotionStore.getState()
      const items = []
      for (const key of sel) {
        const idx = key.lastIndexOf('|')
        const tStr = key.slice(idx + 1)
        const rest = key.slice(0, idx)
        const propIdx = rest.lastIndexOf('|')
        const p = rest.slice(propIdx + 1)
        const layerId = rest.slice(0, propIdx)
        const t = parseFloat(tStr)
        const layer = findLayerInTree(s.layers, layerId)
        const kfFound = layer?.keyframes?.[p]?.find(k => Math.abs(k.t - t) < 0.001)
        if (kfFound) items.push({
          prop: p,
          v: kfFound.v,
          easing: kfFound.easing ?? 'easeOut',
          originalT: kfFound.t,
        })
      }
      if (items.length === 0) return
      kfClipboardRef.current = items
    }
    window.addEventListener('keydown', onCopy, true)
    return () => window.removeEventListener('keydown', onCopy, true)
  }, [])

  useEffect(() => {
    const onPaste = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'v') return
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      const items = kfClipboardRef.current
      if (!items || items.length === 0) return
      const s = useUnifiedMotionStore.getState()
      const targetLayer = findLayerInTree(s.layers, s.selectedLayerId)
      if (!targetLayer) return // 没选中 layer 无法粘贴
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
      const tBase = s.playhead - targetLayer.inPoint
      const layerDur = (targetLayer.outPoint - targetLayer.inPoint) || 5
      const minOrigT = Math.min(...items.map(it => it.originalT))
      s.pushUndo()
      const newKfMarks = []
      for (const item of items) {
        const relT = item.originalT - minOrigT
        const t = Math.max(0, Math.min(layerDur, tBase + relT))
        s.setKeyframe(targetLayer.id, item.prop, t, item.v, item.easing)
        newKfMarks.push({ prop: item.prop, t })
      }
      // 粘贴的 kf 自动选中(便于继续拖)
      requestAnimationFrame(() => {
        const sNow = useUnifiedMotionStore.getState()
        const newKeys = new Set()
        const layerNow = findLayerInTree(sNow.layers, targetLayer.id)
        for (const mark of newKfMarks) {
          const kf = layerNow?.keyframes?.[mark.prop]?.find(k => Math.abs(k.t - mark.t) < 0.005)
          if (kf) newKeys.add(`${targetLayer.id}|${mark.prop}|${kf.t.toFixed(4)}`)
        }
        setSelectedKfs(newKeys)
      })
    }
    window.addEventListener('keydown', onPaste, true)
    return () => window.removeEventListener('keydown', onPaste, true)
  }, [])

  // 用 ref 防止 effectivePxPerSec 等在 useCallback 内闭包错版本
  const effectivePxPerSecRef = useRef(80)
  // 拖动 kf 状态:groupId 表示正在拖的预设组(null = 单 kf 拖)
  const [draggingGroupId, setDraggingGroupId] = useState(null)

  /**
   * kf 菱形 onPointerDown 处理
   *  - 普通 kf:只拖该 kf 的 t
   *  - 预设 kf:拖整组(同 presetGroupId 所有 kf 一起偏移)
   *  - 边界:整组 / 单 kf 都夹在 [0, layerDur] 内
   *  - 双击:删除该 kf(预设组同组同时删 — 后续可加 modifier)
   */
  const handleKfPointerDown = useCallback((e, layer, prop, kf) => {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const layerDur = (layer.outPoint - layer.inPoint) || 5
    const isPreset = !!kf.presetGroupId
    const pxPerSecLocal = effectivePxPerSecRef.current

    // 拍快照:[{prop, originalT, presetGroupId?}]
    const snapshot = []
    if (isPreset) {
      for (const [p, arr] of Object.entries(layer.keyframes || {})) {
        for (const k of arr) {
          if (k.presetGroupId === kf.presetGroupId) {
            snapshot.push({ prop: p, originalT: k.t, presetGroupId: k.presetGroupId })
          }
        }
      }
    } else {
      snapshot.push({ prop, originalT: kf.t, presetGroupId: null })
    }
    if (snapshot.length === 0) return

    const minT = Math.min(...snapshot.map(s => s.originalT))
    const maxT = Math.max(...snapshot.map(s => s.originalT))

    // 上次 dispatch 后实际 t(用于下次 oldT 匹配)
    const lastT = snapshot.map(s => s.originalT)
    let moved = false

    // pushUndo 一次(在拖动开始)
    store.pushUndo()
    if (isPreset) setDraggingGroupId(kf.presetGroupId)

    const onMove = (ev) => {
      const dx = ev.clientX - startX
      let requestedDelta = dx / pxPerSecLocal
      // clamp:整组 / 单 kf 不超出 [0, layerDur]
      requestedDelta = Math.max(-minT, Math.min(layerDur - maxT, requestedDelta))
      if (!moved && Math.abs(requestedDelta) < 0.01) return
      moved = true

      // 算 ops:[{prop, oldT=lastT[i], newT=originalT+delta, presetGroupId?}]
      const ops = []
      for (let i = 0; i < snapshot.length; i++) {
        const s = snapshot[i]
        const newT = s.originalT + requestedDelta
        if (Math.abs(newT - lastT[i]) < 0.0001) continue
        ops.push({ prop: s.prop, oldT: lastT[i], newT, presetGroupId: s.presetGroupId })
        lastT[i] = newT
      }
      if (ops.length) store.moveMultipleKfsT(layer.id, ops)
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDraggingGroupId(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [store])

  const handleKfDoubleClick = useCallback((e, layer, prop, kf) => {
    e.stopPropagation()
    e.preventDefault()
    // 双击 init kf(单 kf 且非 preset)→ 删除;preset kf 双击 → 提示用 clearLayerPreset
    if (kf.presetGroupId) return // preset kf 不允许单删,通过 KeyframePanel 清掉整组
    store.removeKeyframeAt(layer.id, prop, kf.t)
  }, [store])

  // 自适应宽度:观察容器实际宽度,让时间轴内容至少撑满底部空间
  // (Jitter / AE 标准行为:zoom 1.0 时 1 秒 = container_w / duration px,自然填满;
  //  用户 ctrl+wheel zoom 大后才横向 scroll 超出)
  const [containerWidth, setContainerWidth] = useState(800)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w && w > 0) setContainerWidth(Math.floor(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 左侧留白(0 帧不贴窗口),Jitter / AE 标准为 16px
  const TL_LEFT_PAD = 16

  // ── 自适应宽度计算(必须在 startDrag / handleStretchPointerDown 等 useCallback 之前声明,
  //     否则 useCallback deps 数组引用未初始化的 effectivePxPerSec 触发 TDZ)──
  // 默认让时间轴宽度撑满容器(扣掉左右留白):px/sec 至少 = (container_w - 2*pad) / duration
  // 用户 zoom 后 pxPerSec 会变大,totalWidth 跟着 zoom 拉长(超出容器走 scroll)
  const usableWidth = Math.max(0, containerWidth - TL_LEFT_PAD * 2)
  const naturalPxPerSec = duration > 0 ? usableWidth / duration : pxPerSec
  const effectivePxPerSec = Math.max(pxPerSec, naturalPxPerSec)
  const totalWidth = TL_LEFT_PAD * 2 + Math.max(usableWidth, duration * effectivePxPerSec)
  const frameW = effectivePxPerSec / fps
  // 同步给 ref(handleKfPointerDown 闭包用)— 立即同步,确保 useCallback 闭包内 ref.current 始终新鲜
  effectivePxPerSecRef.current = effectivePxPerSec

  // ── 图层条 in/out 拖拽(2026-06-05 用户需求:图层可"从第 3 秒开始出现 / 拉到 10 秒")──
  // mode: 'in' = 左手柄拖 inPoint(outPoint 不动);'out' = 右手柄拖 outPoint;
  //       'move' = 中段平移(span 不变)。kf 时间是 layer-local(相对 inPoint),
  //       拖 in/平移时动画整体跟随图层 — AE 语义,无需 kf 补偿。
  // outPoint 拉超时间轴时长 → setDuration 自动扩(0.5s 步进,只扩不缩)。
  // pushUndo 一次在 pointerdown;onMove 调 setLayerTiming(本身不推 undo)。
  const beginBarDrag = useCallback((e, layer, mode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const st0 = useUnifiedMotionStore.getState()
    st0.selectLayer(layer.id)
    const startX = e.clientX
    const origIn = layer.inPoint || 0
    const origOut = layer.outPoint ?? st0.duration
    const MIN_SPAN = 0.1
    // 惰性 pushUndo(2026-06-05 审查修:纯点击不产生空 undo 步)
    let pushed = false
    // 锁定 pointerdown 时的换算尺度(审查修:拖 out 超界触发 setDuration 会改
    // effectivePxPerSec,实时读会让手柄跳离光标;锁定后扩容只影响渲染不影响换算)
    const px0 = effectivePxPerSecRef.current || 1
    const onMove = (mv) => {
      const dt = (mv.clientX - startX) / px0
      if (!pushed && Math.abs(dt) > 1e-6) { useUnifiedMotionStore.getState().pushUndo(); pushed = true }
      const st = useUnifiedMotionStore.getState()
      if (mode === 'in') {
        const inP = Math.max(0, Math.min(origOut - MIN_SPAN, origIn + dt))
        st.setLayerTiming(layer.id, Math.round(inP * 100) / 100, origOut)
      } else if (mode === 'out') {
        const outP = Math.max(origIn + MIN_SPAN, origOut + dt)
        st.setLayerTiming(layer.id, origIn, Math.round(outP * 100) / 100)
        if (outP > st.duration) st.setDuration(Math.ceil(outP * 2) / 2)
      } else {
        const span = origOut - origIn
        const inP = Math.max(0, origIn + dt)
        st.setLayerTiming(layer.id, Math.round(inP * 100) / 100, Math.round((inP + span) * 100) / 100)
        if (inP + span > st.duration) st.setDuration(Math.ceil((inP + span) * 2) / 2)
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const startDrag = useCallback((e) => {
    // 既有交互(layer bar 拖 / kf 菱形拖 / 拉伸手柄拖 / kf 右键菜单 / graph mode SVG)优先,直接放过
    if (e.target.closest('.ua__tl-bar')) return
    if (e.target.closest('.ua__tl-kf-wrap')) return
    if (e.target.closest('.ua__tl-stretch-handle')) return
    if (e.target.closest('.ua__tl-graph-toggle')) return
    if (e.target.closest('.ua__tl-expand')) return

    const body = bodyRef.current; if (!body) return
    const rect = body.getBoundingClientRect()

    // ── 在 ruler 区 → setPlayhead(沿用旧行为)──
    //   ruler 即顶部时间刻度,空间惯例 = 调节 playhead 入口
    const inRuler = !!e.target.closest('.ua__tl-ruler')

    // ── tracks 空白区(2026-06-04 task #86)──
    //   起 marquee 框选 kf。Shift+drag = 加选(在 selectedKfs 基础上合并新框选结果)。
    //   非 Shift + drag = 框选完成时 replace selection;若移动 < 4px 视为单击空白,清选。
    const inTracks = !!e.target.closest('.ua__tl-tracks')

    if (inRuler) {
      // ── 既有 playhead 拖动逻辑 ──
      e.preventDefault(); draggingRef.current = true
      const update = (ev) => {
        const body2 = bodyRef.current; if (!body2) return
        const rect2 = body2.getBoundingClientRect()
        store.setPlayhead(Math.max(0, Math.min(duration, (ev.clientX - rect2.left + body2.scrollLeft - TL_LEFT_PAD) / effectivePxPerSec)))
      }
      update(e)
      const onMove = (ev) => { if (draggingRef.current) update(ev) }
      const onUp = () => { draggingRef.current = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
      return
    }

    if (!inTracks) {
      // ua__tl-controls 顶 bar 等其他区域,放过
      return
    }

    // ── Marquee 框选 ──
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const additive = !!e.shiftKey
    const baseSelection = additive ? new Set(selectedKfsRef.current) : new Set()
    // body-local 坐标(用于 div 浮层定位)
    const lx0 = startX - rect.left, ly0 = startY - rect.top
    tlMarqueeRef.current = { x1: lx0, y1: ly0, x2: lx0, y2: ly0, bodyRect: rect, additive, startX, startY, moved: false }
    setTlMarquee({ x1: lx0, y1: ly0, x2: lx0, y2: ly0 })

    const onMove = (ev) => {
      const m = tlMarqueeRef.current; if (!m) return
      const dx = ev.clientX - m.startX, dy = ev.clientY - m.startY
      if (!m.moved && Math.hypot(dx, dy) < 4) return
      m.moved = true
      const body2 = bodyRef.current
      const rect2 = body2 ? body2.getBoundingClientRect() : m.bodyRect
      m.x2 = ev.clientX - rect2.left
      m.y2 = ev.clientY - rect2.top
      setTlMarquee({ x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const m = tlMarqueeRef.current
      tlMarqueeRef.current = null
      setTlMarquee(null)
      if (!m) return

      if (!m.moved) {
        // 视为单击空白:清选(非 additive)
        if (!additive) setSelectedKfs(new Set())
        return
      }

      // ── 框选完成:命中 marquee bbox 内的所有 kf(body-viewport 坐标系)──
      const body2 = bodyRef.current; if (!body2) return
      // m.x1/y1/x2/y2 是 body-viewport(client - body rect),kf 用 getBoundingClientRect()
      // 减 body rect 得到同系坐标 → 直接 bbox 相交比较。scroll 偏移与两边相消。
      // kf 位置(body-content)= tracks-left + kf.t * pxPerSec(body 内 tracks 是 width = totalWidth,
      // 但 tracks 行高累加是 DOM 自然布局,无法纯算式定位 kf 屏幕 y → 直接 query DOM)
      const left = Math.min(m.x1, m.x2)
      const top = Math.min(m.y1, m.y2)
      const right = Math.max(m.x1, m.x2)
      const bot = Math.max(m.y1, m.y2)

      // 用 DOM query:所有 .ua__tl-kf-wrap[data-kf-key] 取 getBoundingClientRect 相对 body rect
      const bodyRect2 = body2.getBoundingClientRect()
      const wraps = body2.querySelectorAll('.ua__tl-kf-wrap[data-kf-key]')
      const hit = new Set()
      for (const el of wraps) {
        const r = el.getBoundingClientRect()
        const cx = r.left - bodyRect2.left + r.width / 2
        const cy = r.top - bodyRect2.top + r.height / 2
        if (cx >= left && cx <= right && cy >= top && cy <= bot) {
          const k = el.getAttribute('data-kf-key')
          if (k) hit.add(k)
        }
      }
      // 合并 / 替换
      const next = new Set(baseSelection)
      for (const k of hit) next.add(k)
      setSelectedKfs(next)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, store, effectivePxPerSec])

  // 2026-06-02 passive listener 修复:同 preview wheel,改走原生 addEventListener + passive:false
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const handler = (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); store.setZoom(zoom + (e.deltaY > 0 ? -0.15 : 0.15)) }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler, { passive: false })
  }, [zoom, store])

  // effectivePxPerSec / totalWidth / frameW / ref 已在前面声明并同步
  const ticks = []
  for (let sec = 0; sec <= Math.ceil(duration); sec++) {
    ticks.push({ x: TL_LEFT_PAD + sec * effectivePxPerSec, label: `${sec}s`, major: true })
    if (frameW > 4) {
      for (let f = 1; f < fps; f++) {
        const x = TL_LEFT_PAD + sec * effectivePxPerSec + f * frameW
        if (x > totalWidth - TL_LEFT_PAD) break
        ticks.push({ x, label: (frameW > 12 || (f % 5 === 0 && frameW > 6)) ? `${f}` : null, major: false })
      }
    }
  }

  // ── 计算选中 kf 的时间范围(给拉伸手柄用)─────────
  //  仅在 unique time 数 ≥ 2 时显示手柄;single time 多 kf(同 t 不同 prop)不算
  //  selRangeOrig: 选中 kf 原始 oldStart/oldEnd(用作 batchScaleKeyframes 的 oldRange)
  //  selRangeDisplay: 拖拽中显示的 newStart/newEnd(若 stretchPreview 激活)
  let selRangeOrig = null
  let selRangeDisplay = null
  if (selectedKfs.size >= 2) {
    const uniqTimes = new Set()
    let minT = Infinity, maxT = -Infinity
    for (const key of selectedKfs) {
      const { t } = parseKfKey(key)
      if (!isFinite(t)) continue
      uniqTimes.add(t.toFixed(4))
      if (t < minT) minT = t
      if (t > maxT) maxT = t
    }
    if (uniqTimes.size >= 2 && isFinite(minT) && isFinite(maxT)) {
      selRangeOrig = { start: minT, end: maxT }
      if (stretchPreview) {
        selRangeDisplay = { start: stretchPreview.newStart, end: stretchPreview.newEnd }
      } else {
        selRangeDisplay = selRangeOrig
      }
    }
  }

  /**
   * 拉伸手柄 pointerdown 处理
   *  - side: 'left' | 'right'
   *  - 记录 oldStart/oldEnd 不变,拖拽更新 newStart 或 newEnd
   *  - clamp:newStart >= 0;newEnd <= duration;newStart < newEnd(保留 1ms 间距防归一)
   *  - onMove → setStretchPreview(实时驱动 kf 视觉)
   *  - onUp → store.batchScaleKeyframes(ops) + 清 preview
   */
  const handleStretchPointerDown = useCallback((side) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selRangeOrig) return
    const oldStart = selRangeOrig.start
    const oldEnd = selRangeOrig.end
    const startX = e.clientX
    stretchDraggingRef.current = side

    // 拍 selectedKfs 快照,onUp 时算 newT
    const snapshot = []
    for (const key of selectedKfsRef.current) {
      const { layerId, prop, t } = parseKfKey(key)
      if (!isFinite(t)) continue
      snapshot.push({ layerId, prop, oldT: t })
    }

    const onMove = (ev) => {
      const dx = ev.clientX - startX
      const dSec = dx / effectivePxPerSec
      let newStart = oldStart
      let newEnd = oldEnd
      if (side === 'left') {
        newStart = Math.max(0, Math.min(oldEnd - 0.05, oldStart + dSec))
      } else {
        newEnd = Math.max(oldStart + 0.05, Math.min(duration, oldEnd + dSec))
      }
      setStretchPreview({ oldStart, oldEnd, newStart, newEnd })
    }
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      stretchDraggingRef.current = null

      const dx = ev.clientX - startX
      const dSec = dx / effectivePxPerSec
      let newStart = oldStart, newEnd = oldEnd
      if (side === 'left') {
        newStart = Math.max(0, Math.min(oldEnd - 0.05, oldStart + dSec))
      } else {
        newEnd = Math.max(oldStart + 0.05, Math.min(duration, oldEnd + dSec))
      }

      // 若几乎没动(< 1px),只清 preview 不写 store
      if (Math.abs(newStart - oldStart) < 1e-4 && Math.abs(newEnd - oldEnd) < 1e-4) {
        setStretchPreview(null)
        return
      }

      // 构造 ops + 更新 selectedKfs 的 key(time 变了 key 也变)
      const ops = []
      const newSelKeys = new Set()
      const oldRange = oldEnd - oldStart
      for (const item of snapshot) {
        let newT
        if (Math.abs(oldRange) < 1e-6) newT = item.oldT + (newStart - oldStart)
        else newT = newStart + (item.oldT - oldStart) / oldRange * (newEnd - newStart)
        ops.push({ layerId: item.layerId, prop: item.prop, oldT: item.oldT, newT })
        newSelKeys.add(`${item.layerId}|${item.prop}|${newT.toFixed(4)}`)
      }
      store.batchScaleKeyframes(ops)
      setSelectedKfs(newSelKeys)
      setStretchPreview(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [selRangeOrig, effectivePxPerSec, duration, store, parseKfKey])

  return (
    <div className="ua__timeline" style={{ height }}>
      <div className="ua__tl-controls">
        <button className="ua__btn ua__btn--sm" onClick={() => store.setPlaying(!store.playing)}>{store.playing ? '⏸' : '▶'}</button>
        <span className="ua__tl-time">{fmt(playhead)}</span>
        <span className="ua__tl-time ua__tl-time--dim">/ {fmt(duration)}</span>
        <div className="ua__spacer" />
        {selectedKfs.size > 0 && (
          <span className="ua__tl-time ua__tl-time--dim" style={{ color: 'var(--accent, #a78bfa)' }}>
            已选 {selectedKfs.size} 帧{selRangeOrig ? ` · ${(selRangeOrig.end - selRangeOrig.start).toFixed(2)}s` : ''}
          </span>
        )}
        <span className="ua__tl-zoom-hint">⌘滚轮缩放</span>
        <button className="ua__btn ua__btn--sm" onClick={() => store.setZoom(zoom - 0.25)}>−</button>
        <span className="ua__tl-zoom-val">{Math.round(zoom * 100)}%</span>
        <button className="ua__btn ua__btn--sm" onClick={() => store.setZoom(zoom + 0.25)}>+</button>
      </div>
      <div className="ua__tl-body" ref={bodyRef} onPointerDown={startDrag}>
        <div className="ua__tl-ruler" style={{ width: totalWidth }}>
          {ticks.map((tk, i) => (
            <React.Fragment key={i}>
              <div className={`ua__tl-tick${tk.major ? '' : ' ua__tl-tick--minor'}`} style={{ left: tk.x }} />
              {tk.label && <span className={`ua__tl-tick-label${tk.major ? '' : ' ua__tl-tick-label--minor'}`} style={{ left: tk.x }}>{tk.label}</span>}
            </React.Fragment>
          ))}
        </div>
        <div className="ua__tl-tracks" style={{ width: totalWidth }}>
          {/* 递归渲染:group 展开后插入 children 行 + 自己的属性子轨道
              depth 控制 label 左缩进(28 + depth × 14)*/}
          {(function renderLayerTracks(layerList, depth) {
            return layerList.flatMap(layer => {
              const left = TL_LEFT_PAD + layer.inPoint * effectivePxPerSec
              const w = (layer.outPoint - layer.inPoint) * effectivePxPerSec
              const expanded = expandedLayers.has(layer.id)
              const isGroup = layer.type === 'group' || layer.type === 'mask'
              const kfTimes = new Set()
              for (const arr of Object.values(layer.keyframes || {})) for (const k of arr) kfTimes.add(k.t)
              const rows = []
              rows.push(
                <div
                  key={`l-${layer.id}`}
                  className={`ua__tl-track ua__tl-track--layer${expanded ? ' is-expanded' : ''}${isGroup ? ' ua__tl-track--group' : ''}`}
                  onClick={e => { e.stopPropagation(); store.selectLayer(layer.id) }}
                  onDoubleClick={e => { e.stopPropagation(); toggleExpand(layer.id) }}
                  data-tip={expanded ? '双击折叠' : '双击展开属性' + (isGroup ? ' / 子图层' : '')}
                >
                  <div className="ua__tl-track-label" style={{ paddingLeft: 8 + depth * 14 }}>
                    <button
                      className="ua__tl-expand"
                      onClick={e => { e.stopPropagation(); toggleExpand(layer.id) }}
                      onDoubleClick={e => e.stopPropagation()}
                      data-tip={expanded ? '折叠' : (isGroup ? '展开属性 + 子图层' : '展开属性')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
                        style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}>
                        <polyline points="9 6 15 12 9 18"/>
                      </svg>
                    </button>
                    <span>{isGroup ? `⌬ ${layer.name}` : layer.name}</span>
                  </div>
                  <div className={`ua__tl-bar${selectedLayerId === layer.id ? ' ua__tl-bar--on' : ''}`}
                    style={{ left, width: w, background: TYPE_COLORS[layer.type] || '#666' }}
                    onPointerDown={e => beginBarDrag(e, layer, 'move')}
                    data-tip={`${layer.name} · ${(layer.inPoint || 0).toFixed(1)}s → ${(layer.outPoint || 0).toFixed(1)}s · 拖中段平移 / 拖两缘调出入点`}
                  >
                    {/* in/out 手柄(2026-06-05):左缘拖出现时刻,右缘拖消失时刻(可超时长自动扩) */}
                    <div className="ua__tl-bar-handle ua__tl-bar-handle--l"
                      onPointerDown={e => beginBarDrag(e, layer, 'in')} />
                    {!expanded && [...kfTimes].map(t => <div key={t} className="ua__tl-kf" style={{ left: t * effectivePxPerSec }} />)}
                    <div className="ua__tl-bar-handle ua__tl-bar-handle--r"
                      onPointerDown={e => beginBarDrag(e, layer, 'out')} />
                  </div>
                </div>
              )
              if (expanded) {
                rows.push(...(function renderPropTracks() {
                  // 只显示"已做动画"的属性子轨道(>1 个 kf,或单 kf 来自预设组)
                  // 单 init kf(自动生成的 t=0)不算做了动画
                  const activeProps = ANIM_PROP_ORDER.filter(prop => {
                    const kfs = layer.keyframes?.[prop] || []
                    if (kfs.length >= 2) return true
                    if (kfs.length === 1 && kfs[0].presetGroupId) return true
                    return false
                  })
                  if (activeProps.length === 0) {
                    return [(
                      <div key={`p-empty-${layer.id}`} className="ua__tl-track ua__tl-track--prop ua__tl-track--empty">
                        <div className="ua__tl-track-label ua__tl-track-label--sub" style={{ opacity: 0.6, paddingLeft: 28 + depth * 14 }}>
                          无关键帧
                        </div>
                        <div className="ua__tl-prop-lane" style={{ left, width: w }}>
                          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-3)' }}>
                            {isGroup ? '此 group 没有 K 帧;子图层可独立做动画' : '拖图层或选预设创建动画'}
                          </span>
                        </div>
                      </div>
                    )]
                  }
                  return activeProps.map(prop => {
                    const kfs = layer.keyframes?.[prop] || []
                    const isGraph = graphTracks.has(`${layer.id}|${prop}`)
                    return (
                      <div key={`${layer.id}-${prop}`} className={`ua__tl-track ua__tl-track--prop${isGraph ? ' is-graph' : ''}`}>
                        <div className="ua__tl-track-label ua__tl-track-label--sub" style={{ paddingLeft: 28 + depth * 14 }}>
                          <button
                            className={`ua__tl-graph-toggle${isGraph ? ' is-on' : ''}`}
                            onClick={e => { e.stopPropagation(); toggleGraph(layer.id, prop) }}
                            data-tip={isGraph ? '关闭曲线视图' : '打开曲线视图(可视化插值速率)'}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 21 C 8 21, 8 3, 12 12 S 16 21, 21 3" />
                            </svg>
                          </button>
                          <span>{ANIM_PROP_LABELS[prop]}</span>
                        </div>
                        <div className="ua__tl-prop-lane" style={{ left, width: w }}>
                          {isGraph && (
                            <KfCurveSVG
                              kfs={kfs}
                              pxPerSec={effectivePxPerSec}
                              barWidth={w}
                              layerId={layer.id}
                              prop={prop}
                              store={store}
                            />
                          )}
                          {kfs.map((kf, i) => {
                            const isGroupActive = !!(kf.presetGroupId && draggingGroupId === kf.presetGroupId)
                            const key = kfKey(layer.id, prop, kf)
                            const isSelected = selectedKfs.has(key)
                            // 拉伸预览期间:选中 kf 的 left 走 displayT,非选中保持原 t
                            const displayT = getDisplayT(layer.id, prop, kf)
                            return (
                              <div
                                key={`${i}-${kf.t}-${kf.presetGroupId || ''}`}
                                data-kf-key={key}
                                className={`ua__tl-kf-wrap${isGroupActive ? ' ua__tl-kf-wrap--group-active' : ''}${isSelected ? ' ua__tl-kf-wrap--selected' : ''}`}
                                style={{ left: displayT * effectivePxPerSec }}
                                onPointerDown={e => handleKfPointerDown(e, layer, prop, kf)}
                                onClick={e => handleKfClick(e, layer, prop, kf)}
                                onDoubleClick={e => handleKfDoubleClick(e, layer, prop, kf)}
                                onContextMenu={e => {
                                  e.preventDefault(); e.stopPropagation()
                                  setCtxMenu({ x: e.clientX, y: e.clientY, layerId: layer.id, prop, kf })
                                }}
                                data-tip={`${ANIM_PROP_LABELS[prop]} = ${typeof kf.v === 'number' ? kf.v.toFixed(2) : kf.v} @ ${kf.t.toFixed(2)}s · easing: ${getEasingKind(kf.easing)}${kf.presetGroupId ? ' · 预设组' : ' · 点选 / Backspace 删 / 右键菜单'}`}
                              >
                                <KfShape easing={kf.easing} isPreset={!!kf.presetGroupId} isGroupActive={isGroupActive} />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })
                })())
                // group 展开后,递归渲染 children layer 行
                if (isGroup && Array.isArray(layer.children) && layer.children.length) {
                  rows.push(...renderLayerTracks(layer.children, depth + 1))
                }
              }
              return rows
            })
          })(layers, 0)}
        </div>
        <div className="ua__tl-playhead" style={{ left: TL_LEFT_PAD + playhead * effectivePxPerSec }} />

        {/* ── Marquee 框选浮层(task #86 Phase 1)── */}
        {tlMarquee && (() => {
          const x1 = Math.min(tlMarquee.x1, tlMarquee.x2)
          const y1 = Math.min(tlMarquee.y1, tlMarquee.y2)
          const w = Math.abs(tlMarquee.x2 - tlMarquee.x1)
          const h = Math.abs(tlMarquee.y2 - tlMarquee.y1)
          // body-local 坐标,加 scrollLeft/Top 转 body-content
          const body = bodyRef.current
          const sl = body?.scrollLeft || 0
          const st = body?.scrollTop || 0
          return (
            <div className="ua__tl-marquee" style={{
              left: x1 + sl, top: y1 + st, width: w, height: h,
            }} />
          )
        })()}

        {/* ── 拉伸手柄(task #86 Phase 1)─ 选中 ≥ 2 个 unique time 时显示 ── */}
        {selRangeDisplay && (
          <>
            <div
              className={`ua__tl-stretch-handle${stretchDraggingRef.current === 'left' ? ' is-dragging' : ''}`}
              style={{ left: TL_LEFT_PAD + selRangeDisplay.start * effectivePxPerSec }}
              onPointerDown={handleStretchPointerDown('left')}
              data-tip={`拉伸起点:${selRangeDisplay.start.toFixed(2)}s(拖动按比例重映射所有选中关键帧)`}
            />
            <div
              className={`ua__tl-stretch-handle${stretchDraggingRef.current === 'right' ? ' is-dragging' : ''}`}
              style={{ left: TL_LEFT_PAD + selRangeDisplay.end * effectivePxPerSec }}
              onPointerDown={handleStretchPointerDown('right')}
              data-tip={`拉伸终点:${selRangeDisplay.end.toFixed(2)}s(拖动按比例重映射所有选中关键帧)`}
            />
          </>
        )}
      </div>
      {ctxMenu && <KfContextMenu ctx={ctxMenu} store={store} layers={layers} onClose={() => setCtxMenu(null)} />}
    </div>
  )
}

/* ═══ Keyframe 插值曲线 SVG(graph mode 显示)═══
   - 横轴:时间 t,纵轴:value(min~max 归一化)
   - 每段用 cubic-bezier path 绘制(SVG 原生 C 命令)
   - 每段显示 2 个手柄(右手柄 = a 出口 / 左手柄 = b 入口),可拖
   - 拖手柄实时改 b.easing(转 cubic-bezier 4 参 array)→ renderer 立即反映
*/
function KfCurveSVG({ kfs, pxPerSec, barWidth, layerId, prop, store }) {
  if (kfs.length < 2) return null
  const sorted = [...kfs].sort((a, b) => a.t - b.t)
  const vMin = Math.min(...sorted.map(k => k.v))
  const vMax = Math.max(...sorted.map(k => k.v))
  const vRange = vMax - vMin || 1
  const SVG_H = 44
  const TOP = 4
  const toX = (t) => t * pxPerSec
  const toY = (v) => TOP + SVG_H * (1 - (v - vMin) / vRange)

  // 取 b.easing 的 cubic-bezier 4 参表示(数组 / 预设名映射 / 默认 easeOut)
  const easingToBezier = (easing) => {
    if (Array.isArray(easing) && easing.length === 4) return easing
    return EASING_PRESETS_BEZIER[easing] || EASING_PRESETS_BEZIER.easeOut
  }

  // 计算手柄拖动位置(局部 0~1 坐标在段内)→ SVG 像素
  const segHandlePositions = []
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i]
    const segDur = b.t - a.t
    if (segDur < 0.001) continue
    const [x1, y1, x2, y2] = easingToBezier(b.easing)
    // 手柄 1:出 a,位置 = a + (segDur*x1, (b.v-a.v)*y1)
    // 手柄 2:入 b,位置 = b + (-segDur*(1-x2), -(b.v-a.v)*(1-y2))
    const h1t = a.t + segDur * x1
    const h1v = a.v + (b.v - a.v) * y1
    const h2t = a.t + segDur * x2
    const h2v = a.v + (b.v - a.v) * y2
    segHandlePositions.push({
      segIdx: i,
      kfBOriginalT: b.t,
      bezier: [x1, y1, x2, y2],
      a: { t: a.t, v: a.v },
      b: { t: b.t, v: b.v },
      segDur,
      h1: { t: h1t, v: h1v },
      h2: { t: h2t, v: h2v },
    })
  }

  // SVG path:每段用 cubic bezier C 命令(横轴 t,纵轴 v;控制点用 SVG 像素表达)
  let pathD = `M ${toX(sorted[0].t)} ${toY(sorted[0].v)}`
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i]
    const segDur = b.t - a.t
    if (segDur < 0.001) { pathD += ` L ${toX(b.t)} ${toY(b.v)}`; continue }
    if (b.easing === 'hold') {
      pathD += ` L ${toX(b.t)} ${toY(a.v)} L ${toX(b.t)} ${toY(b.v)}`
      continue
    }
    if (b.easing === 'spring') {
      // spring 是复杂衰减振荡,SVG cubic 不足以表达,用采样
      const SAMPLE = 24
      for (let s = 1; s <= SAMPLE; s++) {
        const u = s / SAMPLE
        const eased = 1 - Math.cos(u * Math.PI * 2.5) * Math.exp(-6 * u)
        pathD += ` L ${toX(a.t + u * segDur)} ${toY(a.v + (b.v - a.v) * eased)}`
      }
      continue
    }
    const [x1, y1, x2, y2] = easingToBezier(b.easing)
    // SVG 像素:cp1 = (a.t + segDur*x1, a.v + (b.v-a.v)*y1)
    const cp1x = toX(a.t + segDur * x1)
    const cp1y = toY(a.v + (b.v - a.v) * y1)
    const cp2x = toX(a.t + segDur * x2)
    const cp2y = toY(a.v + (b.v - a.v) * y2)
    pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toX(b.t)} ${toY(b.v)}`
  }

  // 手柄拖动 — 修改 b.easing 为 cubic-bezier 4 参
  const onHandlePointerDown = (e, seg, which) => {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const [ix1, iy1, ix2, iy2] = seg.bezier
    const segDur = seg.segDur
    const vDelta = seg.b.v - seg.a.v
    store.pushUndo()

    const onMove = (ev) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      // dx 转回 t 偏移(限定段内)
      const dt = dx / pxPerSec
      // dy 转回 v 偏移(向上为正 v,反向)
      const dv = vDelta === 0 ? 0 : -dy / SVG_H * vRange / vDelta
      let nx1 = ix1, ny1 = iy1, nx2 = ix2, ny2 = iy2
      if (which === 'h1') {
        nx1 = Math.max(0, Math.min(1, ix1 + dt / segDur))
        ny1 = iy1 + dv
      } else {
        nx2 = Math.max(0, Math.min(1, ix2 + dt / segDur))
        ny2 = iy2 + dv
      }
      store.setKeyframeBezier(layerId, prop, seg.kfBOriginalT, [nx1, ny1, nx2, ny2])
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <svg
      className="ua__tl-curve-svg"
      width={barWidth}
      height={SVG_H + TOP * 2}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      viewBox={`0 0 ${barWidth} ${SVG_H + TOP * 2}`}
    >
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity="0.85" />
      {/* 每段手柄:从 kf 引出的线段 + 圆点(可拖) */}
      {segHandlePositions.map((seg, idx) => (
        <g key={idx} className="ua__tl-handles">
          {/* 手柄连接线 */}
          <line x1={toX(seg.a.t)} y1={toY(seg.a.v)} x2={toX(seg.h1.t)} y2={toY(seg.h1.v)}
            stroke="var(--accent)" strokeWidth="1" opacity="0.5" strokeDasharray="2 2" />
          <line x1={toX(seg.b.t)} y1={toY(seg.b.v)} x2={toX(seg.h2.t)} y2={toY(seg.h2.v)}
            stroke="var(--accent)" strokeWidth="1" opacity="0.5" strokeDasharray="2 2" />
          {/* 手柄圆点(可拖) */}
          <circle
            cx={toX(seg.h1.t)} cy={toY(seg.h1.v)} r="4"
            fill="var(--accent)" stroke="white" strokeWidth="1.2"
            style={{ pointerEvents: 'auto', cursor: 'grab' }}
            onPointerDown={e => onHandlePointerDown(e, seg, 'h1')}
          />
          <circle
            cx={toX(seg.h2.t)} cy={toY(seg.h2.v)} r="4"
            fill="var(--accent)" stroke="white" strokeWidth="1.2"
            style={{ pointerEvents: 'auto', cursor: 'grab' }}
            onPointerDown={e => onHandlePointerDown(e, seg, 'h2')}
          />
        </g>
      ))}
      {/* kf 点(在曲线中) */}
      {sorted.map((k, i) => (
        <circle key={`kf-${i}`} cx={toX(k.t)} cy={toY(k.v)} r="2.5" fill="var(--text-1)" stroke="var(--accent)" strokeWidth="1" />
      ))}
    </svg>
  )
}

/* ═══ Keyframe 右键菜单 ═══
   - 5 种 easing
   - hold(持续帧,跳变到下一帧)
   - 复制时间 / 复制值
   - 跳上一帧 / 下一帧(playhead)
   - 删除 / 拆预设组
*/
function KfContextMenu({ ctx, store, layers, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', fn, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', fn, true); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const { x, y, layerId, prop, kf } = ctx
  const isPreset = !!kf.presetGroupId
  const layer = findLayerInTree(layers, layerId)
  const allKfsForProp = layer?.keyframes?.[prop] || []
  const currentEasing = kf.easing || 'easeOut'

  const apply = (easing) => { store.setKeyframeEasing(layerId, prop, kf.t, easing); onClose() }
  const jumpToKf = (delta) => {
    const sorted = [...allKfsForProp].sort((a, b) => a.t - b.t)
    const idx = sorted.findIndex(k => Math.abs(k.t - kf.t) < 0.0001)
    const next = sorted[idx + delta]
    if (next && layer) store.setPlayhead(layer.inPoint + next.t)
    onClose()
  }
  const copyTime = () => { navigator.clipboard?.writeText(kf.t.toFixed(3) + 's'); onClose() }
  const copyValue = () => { navigator.clipboard?.writeText(String(kf.v)); onClose() }
  const remove = () => {
    store.removeKeyframeAt(layerId, prop, kf.t, kf.presetGroupId)
    onClose()
  }
  const breakGroup = () => { store.breakPresetGroup(layerId, kf.presetGroupId); onClose() }

  // 算 viewport clamp
  const W = 200, H = 360
  const left = Math.min(x, window.innerWidth - W - 8)
  const top = Math.min(y, window.innerHeight - H - 8)

  const easingItem = (key, label) => (
    <button
      className={`ua__ctx-item${currentEasing === key ? ' is-active' : ''}`}
      onClick={() => apply(key)}
    >
      <span className="ua__ctx-check">{currentEasing === key ? '●' : ''}</span>
      <span>{label}</span>
    </button>
  )

  return (
    <div ref={ref} className="ua__ctx" style={{ left, top }}>
      <div className="ua__ctx-head">关键帧 · {prop}</div>
      <div className="ua__ctx-section">
        {easingItem('linear', '线性 Linear')}
        {easingItem('easeIn', '缓入 Ease In')}
        {easingItem('easeOut', '缓出 Ease Out')}
        {easingItem('easeInOut', '缓动 Ease In/Out')}
        {easingItem('spring', '弹性 Spring')}
        {easingItem('hold', '持续帧 Hold(跳变)')}
      </div>
      <div className="ua__ctx-sep" />
      <div className="ua__ctx-section">
        <button className="ua__ctx-item" onClick={() => jumpToKf(-1)}>跳到上一关键帧</button>
        <button className="ua__ctx-item" onClick={() => jumpToKf(1)}>跳到下一关键帧</button>
      </div>
      <div className="ua__ctx-sep" />
      <div className="ua__ctx-section">
        <button className="ua__ctx-item" onClick={copyTime}>复制时间 ({kf.t.toFixed(2)}s)</button>
        <button className="ua__ctx-item" onClick={copyValue}>复制值 ({typeof kf.v === 'number' ? kf.v.toFixed(2) : kf.v})</button>
      </div>
      {isPreset && (
        <>
          <div className="ua__ctx-sep" />
          <div className="ua__ctx-section">
            <button className="ua__ctx-item" onClick={breakGroup}>拆开预设组(可单独编辑)</button>
          </div>
        </>
      )}
      <div className="ua__ctx-sep" />
      <button className="ua__ctx-item ua__ctx-item--danger" onClick={remove}>
        删除关键帧
      </button>
    </div>
  )
}
