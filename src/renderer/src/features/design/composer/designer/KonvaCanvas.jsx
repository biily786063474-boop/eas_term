/**
 * KonvaCanvas — main canvas renderer using react-konva
 * Declarative rendering from store. Handles selection, transform,
 * drag, shape-drawing, pen (bezier), pan, effects.
 */
import React, {
  useRef, useEffect, useCallback, useImperativeHandle, forwardRef, useState, useMemo,
} from 'react'
import {
  Stage, Layer, Group, Rect, Ellipse, Line, Text, Circle, Image as KonvaImage, Path, Transformer,
  Star as KonvaStar, RegularPolygon,
} from 'react-konva'
import Konva from 'konva'
// [Eas-Term 移植] 桩掉 taptv 触屏手势 hook —— 改为本地 no-op 桩(见 ./useKonvaTouchGestures.js)
import { useKonvaTouchGestures } from './useKonvaTouchGestures'
import { useUnifiedDesignStore } from './store'
import { SNAP_DIST, ACCENT, ACCENT_LIGHT, ROTATION_COLOR, DARK_BG, DEFAULT_FILL, DEFAULT_STROKE, DEFAULT_STROKE_WIDTH, TEXT_FONT_SIZE, TEXT_LINE_HEIGHT, TEXT_LETTER_SPACING } from './constants'
import { HalftoneFilter, PosterizeFilter, ThresholdFilter, EmbossFilter, DuotoneFilter, SolarizeFilter } from './filters'
import { buildLayoutGrid, buildColorGrid, calcSnap, hexAlphaToRgba } from './gridUtils'
import { pathDToPenNodes } from './pathToPen'
import {
  ellipseToPenNodes,
  rectToPenNodes,
  polygonToPenNodes,
  starToPenNodes,
} from './shapeToPen'

// ── NaN / Infinity 兜底:Konva Transformer 在多选 + 旋转 + 极小拖到 0 等边界
// 条件会产生 NaN/Infinity transform。Math.max/Math.min 都是 NaN 透传 — 直接写
// 回 _designerState.objects[i] 会让节点 width/height/scale 永久 NaN,Konva 后续
// 渲染刷屏 warning + 画板乱掉。所有 Transformer/Drag 写回路径用 safeNum 兜底。
function safeNum(v, fallback) {
  return Number.isFinite(v) ? v : fallback
}
function safePos(v) { return Number.isFinite(v) ? v : 0 }
function safeSize(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
function isFiniteBox(b) {
  return b && Number.isFinite(b.x) && Number.isFinite(b.y) &&
    Number.isFinite(b.width) && Number.isFinite(b.height) &&
    b.width > 0 && b.height > 0
}

let _pasteCounter = Date.now()
function regenIds(obj) {
  const clone = { ...obj, id: `obj_${++_pasteCounter}_${Math.random().toString(36).slice(2,6)}` }
  if (clone.children) clone.children = clone.children.map(regenIds)
  return clone
}

/* ── Layout grid system ── */
/* ── Image loader ── */
function useLoadedImage(src) {
  const [image, setImage] = useState(null)
  useEffect(() => {
    if (!src) { setImage(null); return }
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setImage(img)
    img.onerror = () => setImage(null)
    img.src = src
    return () => { img.onload = null; img.onerror = null }
  }, [src])
  return image
}

/* ── Custom Konva filters ── */
const ShapeImage = React.memo(React.forwardRef(function ShapeImage(props, ref) {
  const { src, adjustments, width, height, ...rest } = props
  const image = useLoadedImage(src)
  const innerRef = useRef(null)

  // Apply Konva filters — re-cache when image, adjustments, or dimensions change
  const applyFilters = useCallback(() => {
    const node = innerRef.current
    if (!node || !image) return
    const adj = adjustments || {}
    const hasAdj = Object.values(adj).some(v => v !== 0 && v !== false)
    if (!hasAdj) {
      node.filters([]); node.clearCache(); return
    }
    const filters = []
    if (adj.brightness != null && adj.brightness !== 0) filters.push(Konva.Filters.Brighten)
    if (adj.contrast != null && adj.contrast !== 0) filters.push(Konva.Filters.Contrast)
    if (adj.hue != null || adj.saturation != null || adj.luminance != null) filters.push(Konva.Filters.HSL)
    if (adj.blur != null && adj.blur > 0) filters.push(Konva.Filters.Blur)
    if (adj.noise != null && adj.noise > 0) filters.push(Konva.Filters.Noise)
    if (adj.grayscale) filters.push(Konva.Filters.Grayscale)
    if (adj.sepia) filters.push(Konva.Filters.Sepia)
    if (adj.invert) filters.push(Konva.Filters.Invert)
    if (adj.pixelate != null && adj.pixelate > 1) filters.push(Konva.Filters.Pixelate)
    if (adj.posterize != null && adj.posterize > 0) filters.push(PosterizeFilter)
    if (adj.threshold != null && adj.threshold > 0) filters.push(ThresholdFilter)
    if (adj.emboss) filters.push(EmbossFilter)
    if (adj.halftone != null && adj.halftone > 0) filters.push(HalftoneFilter)
    if (adj.duotone) filters.push(DuotoneFilter)
    if (adj.solarize) filters.push(SolarizeFilter)

    node.filters(filters)
    if (adj.brightness != null) node.brightness(adj.brightness)
    if (adj.contrast != null) node.contrast(adj.contrast)
    if (adj.hue != null) node.hue(adj.hue)
    if (adj.saturation != null) node.saturation(adj.saturation)
    if (adj.luminance != null) node.luminance(adj.luminance)
    if (adj.blur != null) node.blurRadius(adj.blur)
    if (adj.noise != null) node.noise(adj.noise)
    if (adj.pixelate != null) node.pixelSize(adj.pixelate)
    // Custom filter attrs
    if (adj.posterize) node.setAttr('posterizeLevels', adj.posterize)
    if (adj.threshold) node.setAttr('thresholdVal', adj.threshold)
    if (adj.emboss) node.setAttr('embossStrength', typeof adj.emboss === 'number' ? adj.emboss : 2)
    if (adj.halftone) node.setAttr('halftoneSize', adj.halftone)
    if (adj.duotone) {
      node.setAttr('duotoneDark', adj.duotoneDark || [30, 0, 80])
      node.setAttr('duotoneLight', adj.duotoneLight || [255, 200, 50])
    }
    try { node.cache() } catch (_) {}
  }, [image, adjustments])

  useEffect(() => { applyFilters() }, [applyFilters, width, height])

  const setRef = useCallback((n) => {
    innerRef.current = n
    if (typeof ref === 'function') ref(n)
    else if (ref) ref.current = n
    // Cache immediately on mount if adjustments exist
    if (n) requestAnimationFrame(() => applyFilters())
  }, [ref, applyFilters])

  if (!image) return null
  return <KonvaImage ref={setRef} image={image} width={width} height={height} {...rest} />
}))

/* ── Effects ── */
function applyEffects(obj, props) {
  const fx = obj.effects
  if (!fx) return
  // Outer glow: uses shadow with no offset + optional spread (extra stroke)
  if (fx.outerGlow) {
    props.shadowColor = fx.outerGlow.color || '#7c6aed'
    props.shadowBlur = (fx.outerGlow.blur ?? 15) + (fx.outerGlow.spread ?? 0)
    props.shadowOffsetX = 0; props.shadowOffsetY = 0
    props.shadowOpacity = fx.outerGlow.opacity ?? 0.6
    props.shadowEnabled = true
    if (fx.outerGlow.spread > 0) {
      props.strokeEnabled = true
      props.stroke = fx.outerGlow.color || '#7c6aed'
      props.strokeWidth = (props.strokeWidth || 0) + (fx.outerGlow.spread ?? 0)
    }
  } else if (fx.shadow) {
    props.shadowColor = fx.shadow.color || 'rgba(0,0,0,0.3)'
    props.shadowBlur = fx.shadow.blur ?? 10
    props.shadowOffsetX = fx.shadow.offsetX ?? 4; props.shadowOffsetY = fx.shadow.offsetY ?? 4
    props.shadowOpacity = fx.shadow.opacity ?? 0.2
    props.shadowEnabled = true
  }
  // Inner glow: simulated via inner stroke
  if (fx.innerGlow) {
    props.shadowForStrokeEnabled = false
    const glowWidth = Math.min((fx.innerGlow.blur ?? 8) + (fx.innerGlow.spread ?? 0), 20)
    if (!props.strokeWidth || props.strokeWidth < 1) {
      props.stroke = fx.innerGlow.color || '#ffffff'
      props.strokeWidth = glowWidth
    }
  }
}

/* ── Clip path helper for masks ── */
function drawClipPath(ctx, shape) {
  const mx = shape.x || 0, my = shape.y || 0
  if (shape.type === 'rect') {
    const r = shape.cornerRadius || 0, w = shape.width || 100, h = shape.height || 100
    if (r > 0) {
      ctx.beginPath()
      ctx.moveTo(mx + r, my); ctx.lineTo(mx + w - r, my)
      ctx.quadraticCurveTo(mx + w, my, mx + w, my + r)
      ctx.lineTo(mx + w, my + h - r)
      ctx.quadraticCurveTo(mx + w, my + h, mx + w - r, my + h)
      ctx.lineTo(mx + r, my + h)
      ctx.quadraticCurveTo(mx, my + h, mx, my + h - r)
      ctx.lineTo(mx, my + r)
      ctx.quadraticCurveTo(mx, my, mx + r, my)
      ctx.closePath()
    } else {
      ctx.rect(mx, my, w, h)
    }
  } else if (shape.type === 'ellipse') {
    const rx = shape.radiusX || (shape.width || 100) / 2
    const ry = shape.radiusY || (shape.height || 100) / 2
    ctx.beginPath(); ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2); ctx.closePath()
  } else if ((shape.type === 'line') && shape.points) {
    const pts = shape.points
    ctx.beginPath(); ctx.moveTo(mx + pts[0], my + pts[1])
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(mx + pts[i], my + pts[i + 1])
    ctx.closePath()
  } else if (shape.type === 'pen' && shape.penNodes?.length) {
    // Bezier path from penNodes
    const nodes = shape.penNodes
    ctx.beginPath()
    ctx.moveTo(mx + nodes[0].x, my + nodes[0].y)
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1], cur = nodes[i]
      const cp1x = mx + (prev.cx2 ?? prev.x), cp1y = my + (prev.cy2 ?? prev.y)
      const cp2x = mx + (cur.cx1 ?? cur.x), cp2y = my + (cur.cy1 ?? cur.y)
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, mx + cur.x, my + cur.y)
    }
    ctx.closePath()
  } else if (shape.type === 'star') {
    const np = shape.numPoints || 5
    const outerR = shape.outerRadius || (Math.min(shape.width || 100, shape.height || 100) / 2)
    const innerR = shape.innerRadius || (outerR * 0.4)
    ctx.beginPath()
    for (let i = 0; i < np * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR
      const angle = (i * Math.PI / np) - Math.PI / 2
      const px = mx + Math.cos(angle) * r, py = my + Math.sin(angle) * r
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else if (shape.type === 'polygon') {
    const sides = shape.sides || 6
    const radius = shape.radius || (Math.min(shape.width || 100, shape.height || 100) / 2)
    ctx.beginPath()
    for (let i = 0; i < sides; i++) {
      const angle = (2 * Math.PI * i / sides) - Math.PI / 2
      const px = mx + Math.cos(angle) * radius, py = my + Math.sin(angle) * radius
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else if (shape.type === 'gear') {
    const teeth = shape.teeth || 8
    const outerR = shape.outerRadius || (Math.min(shape.width || 100, shape.height || 100) / 2)
    const innerR = shape.innerRadius || (outerR * 0.7)
    const pts = gearPoints(teeth, outerR, innerR)
    ctx.beginPath()
    ctx.moveTo(mx + pts[0], my + pts[1])
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(mx + pts[i], my + pts[i + 1])
    ctx.closePath()
  } else {
    ctx.rect(mx, my, shape.width || 100, shape.height || 100)
  }
}

/* ── Bezier helpers ── */
// penNodes: [{x, y, cx1, cy1, cx2, cy2}, ...] → SVG path d
export function penNodesToPathD(nodes) {
  if (!nodes || nodes.length === 0) return ''
  let d = `M ${nodes[0].x} ${nodes[0].y}`
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1]
    const cur = nodes[i]
    // Control point 1: outgoing handle of prev node
    const cp1x = prev.cx2 ?? prev.x
    const cp1y = prev.cy2 ?? prev.y
    // Control point 2: incoming handle of current node
    const cp2x = cur.cx1 ?? cur.x
    const cp2y = cur.cy1 ?? cur.y
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${cur.x} ${cur.y}`
  }
  return d
}

/* ── Find pen path endpoint (first or last node) at given world position.
     Used by pen tool to resume drawing an existing path or close it.
     zoom: stage zoom factor — hit radius scales inversely so screen-space hit area stays constant. ── */
function findPenEndpointAt(pos, objects, zoom, ignoreId = null) {
  const HIT_RADIUS = 12 / Math.max(zoom, 0.0001)
  const isWithin = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= HIT_RADIUS
  for (const o of objects) {
    if (!o || o.type !== 'pen' || o.locked || o.visible === false) continue
    if (!Array.isArray(o.penNodes) || o.penNodes.length === 0) continue
    if (ignoreId && o.id === ignoreId) continue
    const ox = o.x || 0, oy = o.y || 0
    const firstN = o.penNodes[0]
    const lastN = o.penNodes[o.penNodes.length - 1]
    const first = { x: ox + firstN.x, y: oy + firstN.y }
    const last  = { x: ox + lastN.x,  y: oy + lastN.y  }
    if (isWithin(pos, first)) return { id: o.id, end: 'first', obj: o }
    if (o.penNodes.length > 1 && isWithin(pos, last)) return { id: o.id, end: 'last', obj: o }
  }
  return null
}

/* ── Reverse pen nodes for resume-from-first-point case.
     When user clicks the FIRST anchor of an existing path, we flip the node array
     so the original first becomes the new last (so subsequent clicks extend from there).
     Bezier handles cx1/cy1 (incoming, from prev node) and cx2/cy2 (outgoing, to next node)
     must also swap, since "previous" and "next" semantics invert after reversal. ── */
function reversePenNodes(nodes) {
  const reversed = [...nodes].reverse()
  return reversed.map(n => {
    const flipped = { x: n.x, y: n.y }
    // Swap incoming <-> outgoing handles
    if (n.cx1 != null || n.cx2 != null) {
      if (n.cx2 != null) { flipped.cx1 = n.cx2; flipped.cy1 = n.cy2 }
      if (n.cx1 != null) { flipped.cx2 = n.cx1; flipped.cy2 = n.cy1 }
    }
    return flipped
  })
}

/* ── Find parent of a child object (recursive across nested groups) ── */
function findParentOf(objects, childId) {
  for (const obj of objects) {
    if (obj.children?.some(c => c.id === childId)) return obj
    if (Array.isArray(obj.children) && obj.children.length) {
      const found = findParentOf(obj.children, childId)
      if (found) return found
    }
  }
  return null
}

/* ── Find an object by id at any depth ── */
function findObjectDeep(objects, id) {
  for (const obj of objects) {
    if (obj.id === id) return obj
    if (Array.isArray(obj.children) && obj.children.length) {
      const f = findObjectDeep(obj.children, id)
      if (f) return f
    }
  }
  return null
}

/* ── Walk up from descendantId to find the ancestor whose direct parent is parentId.
     Returns the id of that direct child, or null if not found / descendant not nested under parent. ── */
function findDirectChildOf(objects, descendantId, parentId) {
  if (descendantId === parentId) return null
  let curr = descendantId
  // Limit to reasonable depth to avoid infinite loops on bad data
  for (let i = 0; i < 64; i++) {
    const par = findParentOf(objects, curr)
    if (!par) return null
    if (par.id === parentId) return curr
    curr = par.id
  }
  return null
}

/* ── Compute the chain of group/mask IDs from root down to targetId (inclusive). ── */
function computeEnteredChain(objects, targetId) {
  if (!targetId) return []
  function walk(list, trail) {
    for (const o of list) {
      const next = [...trail, o.id]
      if (o.id === targetId) return next
      if (Array.isArray(o.children) && o.children.length) {
        const found = walk(o.children, next)
        if (found) return found
      }
    }
    return null
  }
  return walk(objects, []) || []
}

/* ── Gear shape points generator ── */
function gearPoints(teeth, outerR, innerR) {
  const pts = []
  const step = Math.PI / teeth
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = i * step - Math.PI / 2
    pts.push(Math.cos(angle) * r, Math.sin(angle) * r)
  }
  return pts
}

/* ── Per-type shape rendering ── */
// renderCtx: { selectedIds, updateChild, pushUndo, selectChild, objects } — for group/mask child interaction
function renderShape(obj, commonProps, shapeRefs, renderCtx, parentId = null) {
  const refCb = (node) => {
    if (node) shapeRefs.current.set(obj.id, node)
    else shapeRefs.current.delete(obj.id)
  }

  switch (obj.type) {
    case 'rect':
      return <Rect key={obj.id} ref={refCb} {...commonProps} cornerRadius={obj.cornerRadius || 0} />
    case 'ellipse':
      return <Ellipse key={obj.id} ref={refCb} {...commonProps}
        radiusX={obj.radiusX ?? (obj.width || 100) / 2}
        radiusY={obj.radiusY ?? (obj.height || 100) / 2} />
    case 'line':
      return <Line key={obj.id} ref={refCb} {...commonProps}
        points={obj.points || []} closed={!!obj.closed}
        tension={obj.tension ?? 0} />
    case 'pen':
      // Bezier path from penNodes
      return <Path key={obj.id} ref={refCb} {...commonProps}
        data={obj.data || penNodesToPathD(obj.penNodes)} />
    case 'text': {
      const textProps = { ...commonProps }
      if (obj.textSizing === 'fixed') {
        // Fixed mode: keep width/height, enable word wrap
        textProps.wrap = 'word'
      } else {
        // Auto mode: remove width/height, let Konva auto-size
        if (!obj.width) delete textProps.width
        delete textProps.height
      }
      const displayText = obj.vertical
        ? (obj.text || 'Text').split('').join('\n')
        : (obj.text || 'Text')
      return <Text key={obj.id} ref={refCb} {...textProps}
        text={displayText} fontSize={obj.fontSize || 24}
        fontFamily={obj.fontFamily || 'sans-serif'}
        align={obj.vertical ? 'center' : (obj.align || 'left')}
        lineHeight={obj.lineHeight ?? 1.2}
        letterSpacing={obj.letterSpacing ?? 0}
        fillAfterStrokeEnabled={true} />
    }
    case 'image':
      return <ShapeImage key={obj.id} ref={refCb} {...commonProps} src={obj.src} adjustments={obj.adjustments} />
    case 'canvas': {
      // Bitmap painting layer — use live canvas element if available, else fall back to dataURL
      const canvasEl = obj._liveCanvas || null
      if (canvasEl) {
        return <KonvaImage key={obj.id} ref={refCb} {...commonProps} image={canvasEl} />
      }
      return obj._canvasData
        ? <ShapeImage key={obj.id} ref={refCb} {...commonProps} src={obj._canvasData} />
        : <Rect key={obj.id} ref={refCb} {...commonProps} fill="transparent" />
    }
    case 'path':
      return <Path key={obj.id} ref={refCb} {...commonProps} data={obj.data || ''} fillRule={obj.fillRule || 'nonzero'} />
    case 'star':
      return <KonvaStar key={obj.id} ref={refCb} {...commonProps}
        numPoints={obj.numPoints || 5}
        innerRadius={obj.innerRadius || (Math.min(obj.width || 100, obj.height || 100) / 2 * 0.4)}
        outerRadius={obj.outerRadius || (Math.min(obj.width || 100, obj.height || 100) / 2)} />
    case 'polygon':
      return <RegularPolygon key={obj.id} ref={refCb} {...commonProps}
        sides={obj.sides || 6}
        radius={obj.radius || (Math.min(obj.width || 100, obj.height || 100) / 2)} />
    case 'gear': {
      const teeth = obj.teeth || 8
      const outerR = obj.outerRadius || (Math.min(obj.width || 100, obj.height || 100) / 2)
      const innerR = obj.innerRadius || (outerR * 0.7)
      return <Line key={obj.id} ref={refCb} {...commonProps}
        points={gearPoints(teeth, outerR, innerR)} closed={true} />
    }
    case 'group': {
      const chain = renderCtx?.enteredChain || []
      const selfInChain = chain.includes(obj.id)            // I am the entered target or one of its ancestors
      const selfIsInnermost = renderCtx?.enteredGroupId === obj.id   // I am the deepest entered group
      // I act as an integral element only when I sit on the *current interactive layer*:
      //   parent is the entered group (we drilled into parent), OR
      //   I'm at root and nothing is entered yet.
      const enteredId = renderCtx?.enteredGroupId ?? null
      const atCurrentLayer = parentId === enteredId
      const closed = !selfInChain && atCurrentLayer
      const groupSelectMode = (renderCtx?.activeTool ?? 'select') === 'select'

      const buildGroupChild = (child) => {
        const childProps = buildChildProps(child, shapeRefs)
        const childInChain = chain.includes(child.id)
        // Mid-chain (I am opened but not innermost): only the in-chain child
        // remains interactive (it'll handle itself); others stay listening:true
        // with no handlers so clicks bubble.
        if (selfInChain && !selfIsInnermost) {
          childProps.listening = true
          childProps.draggable = false
          return childProps
        }
        // I am the innermost entered group → my immediate children are independently interactive
        if (selfIsInnermost) {
          childProps.listening = true
          // For nested group/mask child: it'll render its own draggable based on chain.
          childProps.draggable = !(child.type === 'group' || child.type === 'mask') ? true : !childInChain
          childProps.onClick = (e) => {
            e.cancelBubble = true
            renderCtx?.handleChildClick?.(e, obj.id, child.id)
          }
          childProps.onTap = childProps.onClick
          childProps.onDragStart = (e) => {
            if (e.evt?.button != null && e.evt.button !== 0) { e.target.stopDrag(); return }
            e.cancelBubble = true
            if (!renderCtx?.selectedIds?.includes(child.id)) {
              renderCtx?.handleChildClick?.(e, obj.id, child.id)
            }
          }
          childProps.onDragEnd = (e) => {
            renderCtx?.pushUndo?.()
            renderCtx?.updateChild(obj.id, child.id, { x: e.target.x(), y: e.target.y() })
          }
          childProps.onTransformEnd = (e) => {
            renderCtx?.handleChildTransform?.(obj.id, child.id, e)
          }
          childProps.onMouseEnter = (e) => renderCtx?.handleMouseEnter?.(e, child.id)
          childProps.onMouseLeave = renderCtx?.handleMouseLeave
          return childProps
        }
        // I am closed → children are visual only, clicks bubble to me
        childProps.listening = true
        childProps.draggable = false
        return childProps
      }

      const groupChildren = obj.children || []
      // Closed group: respond as integral. Click selects, dblclick enters this level
      // and snaps the selection bbox to the deepest element clicked.
      const onGroupDblClick = (e) => {
        if (e.evt?.button != null && e.evt.button !== 0) return
        e.cancelBubble = true
        renderCtx?.enterGroup?.(obj.id)
        // Walk e.target to find the deepest data-id under the click
        let t = e.target
        let deepId = null
        while (t && t !== e.target.getStage()) {
          const id = t.getAttr?.('data-id')
          if (id) { deepId = String(id).replace(/__vis$/, ''); break }
          t = t.getParent?.()
        }
        if (deepId && deepId !== obj.id) {
          // Selection should snap to obj's direct child that contains deepId,
          // not to the leaf itself. (User wants to keep nested groups selected as a whole.)
          const objsNow = useUnifiedDesignStore.getState().objects
          const directChildId = findDirectChildOf(objsNow, deepId, obj.id)
          if (directChildId) {
            useUnifiedDesignStore.getState().setSelectedIds([directChildId])
          } else {
            // deepId equals a direct child or somehow outside this group — fall back
            useUnifiedDesignStore.getState().setSelectedIds([deepId])
          }
        } else {
          // Clicked on the group's own fill area — select the last child for visual feedback
          const last = (obj.children || [])[ (obj.children || []).length - 1 ]
          if (last) useUnifiedDesignStore.getState().setSelectedIds([last.id])
        }
      }
      // Ctrl/Cmd+click pierces nesting: drill straight into the deepest hit element.
      const onGroupClick = (e) => {
        const pierce = e.evt?.ctrlKey || e.evt?.metaKey
        if (pierce) {
          let t = e.target
          let deepId = null
          while (t && t !== e.target.getStage()) {
            const id = t.getAttr?.('data-id')
            if (id) { deepId = String(id).replace(/__vis$/, ''); break }
            t = t.getParent?.()
          }
          if (deepId) {
            const objsNow = useUnifiedDesignStore.getState().objects
            const parent = findParentOf(objsNow, deepId)
            renderCtx?.enterGroup?.(parent?.id ?? null)
            useUnifiedDesignStore.getState().setSelectedIds([deepId])
            e.cancelBubble = true
            return
          }
        }
        commonProps.onClick?.(e)
      }
      return (
        <Group key={obj.id} ref={refCb} x={commonProps.x} y={commonProps.y}
          rotation={commonProps.rotation} scaleX={commonProps.scaleX} scaleY={commonProps.scaleY}
          skewX={obj.skewX ?? 0} skewY={obj.skewY ?? 0}
          opacity={commonProps.opacity} visible={commonProps.visible}
          listening={groupSelectMode}
          draggable={groupSelectMode && closed}
          onClick={groupSelectMode && closed ? onGroupClick : undefined}
          onTap={groupSelectMode && closed ? onGroupClick : undefined}
          onDblClick={groupSelectMode && closed ? onGroupDblClick : undefined}
          onDblTap={groupSelectMode && closed ? onGroupDblClick : undefined}
          onDragStart={groupSelectMode && closed ? commonProps.onDragStart : undefined}
          onDragMove={groupSelectMode && closed ? commonProps.onDragMove : undefined}
          onDragEnd={groupSelectMode && closed ? commonProps.onDragEnd : undefined}
          onTransformEnd={groupSelectMode && closed ? commonProps.onTransformEnd : undefined}
          onMouseEnter={groupSelectMode && closed ? commonProps.onMouseEnter : undefined}
          onMouseLeave={groupSelectMode && closed ? commonProps.onMouseLeave : undefined}
          data-id={obj.id}>
          {groupChildren.map(child => renderShape(child, buildGroupChild(child), shapeRefs, renderCtx, obj.id))}
        </Group>
      )
    }
    case 'mask': {
      const children = obj.children || []
      const isMaskEntered = renderCtx?.enteredGroupId === obj.id
      if (children.length < 2) {
        return (
          <Group key={obj.id} ref={refCb} x={commonProps.x} y={commonProps.y}
            opacity={commonProps.opacity} visible={commonProps.visible} draggable={!isMaskEntered}
            onClick={commonProps.onClick} onTap={commonProps.onTap}
            data-id={obj.id}>
            {children.map(child => renderShape(child, buildChildProps(child, shapeRefs), shapeRefs, renderCtx, obj.id))}
          </Group>
        )
      }
      const maskShape = children[0]
      const content = children.slice(1)
      const isEntered = renderCtx?.enteredGroupId === obj.id
      const isMaskShapeSelected = renderCtx?.selectedIds?.includes(maskShape.id)

      // Same logic as group: not entered → listen but no handlers (bubble to parent); entered → interactive
      const buildMaskChild = (child, opts = {}) => {
        const childProps = buildChildProps(child, shapeRefs)
        if (opts.visualOnly) return childProps
        if (!isEntered) {
          childProps.listening = true
          childProps.draggable = false
          return childProps
        }
        childProps.listening = true
        childProps.draggable = true
        childProps.onClick = (e) => {
          e.cancelBubble = true
          renderCtx?.handleChildClick?.(e, obj.id, child.id)
        }
        childProps.onTap = childProps.onClick
        childProps.onDragStart = (e) => {
          if (e.evt?.button != null && e.evt.button !== 0) { e.target.stopDrag(); return }
          e.cancelBubble = true
          if (!renderCtx?.selectedIds?.includes(child.id)) {
            renderCtx?.handleChildClick?.(e, obj.id, child.id)
          }
        }
        childProps.onDragEnd = (e) => {
          renderCtx?.pushUndo?.()
          renderCtx?.updateChild(obj.id, child.id, { x: e.target.x(), y: e.target.y() })
        }
        childProps.onTransformEnd = (e) => {
          renderCtx?.handleChildTransform?.(obj.id, child.id, e)
        }
        childProps.onMouseEnter = (e) => renderCtx?.handleMouseEnter?.(e, child.id)
        childProps.onMouseLeave = renderCtx?.handleMouseLeave
        return childProps
      }

      // Mask bounding box for hit area = mask shape (children[0]) bounds
      const mw = maskShape.width || maskShape.radius * 2 || maskShape.outerRadius * 2 || 100
      const mh = maskShape.height || maskShape.radius * 2 || maskShape.outerRadius * 2 || 100

      return (
        <Group key={obj.id} ref={refCb} x={commonProps.x} y={commonProps.y}
          rotation={commonProps.rotation} scaleX={commonProps.scaleX} scaleY={commonProps.scaleY}
          skewX={obj.skewX ?? 0} skewY={obj.skewY ?? 0}
          opacity={commonProps.opacity} visible={commonProps.visible}
          draggable={!isMaskEntered}
          onClick={commonProps.onClick} onTap={commonProps.onTap}
          onDragStart={(e) => {
            if ((e.evt?.button != null && e.evt.button !== 0) || isMaskEntered) { e.target.stopDrag(); return }
            const cur = useUnifiedDesignStore.getState().selectedIds
            if (!cur.includes(obj.id)) renderCtx?.setSelectedIds([obj.id])
          }}
          onDragEnd={(e) => {
            if (isMaskEntered) return
            commonProps.onDragEnd?.(e)
          }}
          onTransformEnd={commonProps.onTransformEnd}
          onMouseEnter={commonProps.onMouseEnter} onMouseLeave={commonProps.onMouseLeave}
          data-id={obj.id}>
          {/* Interactive layer — full shapes outside clip for drag/hit.
              Near-zero opacity keeps hit detection active while visually invisible. */}
          {content.map(child => renderShape(child, {
            ...buildMaskChild(child),
            shadowEnabled: false, opacity: 0.004,
          }, shapeRefs, renderCtx, obj.id))}
          {/* Clipped visual layer — shows content only within mask area */}
          <Group clipFunc={(ctx) => { drawClipPath(ctx, maskShape) }} listening={false}>
            {content.map(child => {
              const vp = buildMaskChild(child, { visualOnly: true })
              vp.listening = false; vp.draggable = false
              // Use a visual-only key suffix to avoid duplicate keys with the interactive layer
              const vChild = { ...child, id: child.id + '__vis' }
              return renderShape(vChild, { ...vp, 'data-id': child.id + '__vis' }, { current: new Map() }, renderCtx)
            })}
          </Group>
          {/* Mask shape — no visual outline unless selected; stroke-only hit area when entered */}
          {renderShape(maskShape, {
            ...buildMaskChild(maskShape),
            fill: '', stroke: isMaskShapeSelected ? '#7c6aed' : 'transparent',
            strokeWidth: isMaskShapeSelected ? 1.5 : 0,
            dash: isMaskShapeSelected ? [4, 4] : undefined,
            opacity: 1, name: '__mask_outline',
            fillEnabled: false, hitStrokeWidth: isEntered ? 14 : 0,
          }, shapeRefs, renderCtx)}
        </Group>
      )
    }
    default:
      return <Rect key={obj.id} ref={refCb} {...commonProps} />
  }
}

// Build props for children inside groups/masks
function buildChildProps(child, shapeRefs) {
  const props = {
    'data-id': child.id,
    x: child.x ?? 0, y: child.y ?? 0,
    fill: child.fill ?? '', stroke: child.stroke ?? '',
    strokeWidth: child.strokeWidth ?? 0,
    lineCap: child.lineCap || 'butt', lineJoin: child.lineJoin || 'miter',
    strokeScaleEnabled: false,
    opacity: child.opacity ?? 1,
    rotation: child.rotation ?? 0, scaleX: child.scaleX ?? 1, scaleY: child.scaleY ?? 1,
    // Bug-3 fix: 嵌套 path/pen/group/mask 也可能 decompose 出 skew,要传给 Konva 节点
    skewX: child.skewX ?? 0, skewY: child.skewY ?? 0,
    globalCompositeOperation: child.blendMode || 'source-over',
    visible: child.visible !== false, draggable: false, listening: false,
    hitStrokeWidth: (!child.fill || child.fill === 'transparent' || child.fillType === 'none') ? 20 : 12,
  }
  if (child.width != null) props.width = child.width
  if (child.height != null) props.height = child.height
  if (child.cornerRadius) props.cornerRadius = child.cornerRadius
  if (child.fillRule) props.fillRule = child.fillRule
  // Gradient support for children
  if (child.fillType === 'gradient' && child.gradientColors) {
    const w = child.width || 100, h = child.height || 100
    const rad = ((child.gradientAngle || 0) * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const projLen = Math.abs(w * cos) + Math.abs(h * sin)
    const cx = w / 2, cy = h / 2, dx = (cos * projLen) / 2, dy = (sin * projLen) / 2
    props.fillLinearGradientStartPoint = { x: cx - dx, y: cy - dy }
    props.fillLinearGradientEndPoint = { x: cx + dx, y: cy + dy }
    const gc = child.gradientColors
    props.fillLinearGradientColorStops = [0, hexAlphaToRgba(gc.c1 || '#000', gc.a1), 1, hexAlphaToRgba(gc.c2 || '#fff', gc.a2)]
    delete props.fill
  } else if (child.fillType === 'radial' && child.gradientColors) {
    const w = child.width || 100, h = child.height || 100
    const gc = child.gradientColors
    const r = Math.max(w, h) / 2
    props.fillRadialGradientStartPoint = { x: w / 2, y: h / 2 }
    props.fillRadialGradientEndPoint = { x: w / 2, y: h / 2 }
    props.fillRadialGradientStartRadius = 0
    props.fillRadialGradientEndRadius = r
    props.fillRadialGradientColorStops = [0, hexAlphaToRgba(gc.c1 || '#000', gc.a1), 1, hexAlphaToRgba(gc.c2 || '#fff', gc.a2)]
    delete props.fill
  }
  applyEffects(child, props)
  return props
}

/* ── Main component ── */
const KonvaCanvas = forwardRef(function KonvaCanvas({ editingId, onExitEdit, onEnterEdit }, ref) {
  const stageRef = useRef(null)
  const transformerRef = useRef(null)
  const shapeRefs = useRef(new Map())
  const drawingRef = useRef(null)

  // Bug-1 fix(round 7 DEFINITIVE): 抛弃 Konva 内置 rotater,改自定义渲染层。
  // 前 6 轮 anchorStyleFunc + forceUpdate 路线无解 — Konva 内置 rotater 算法在
  // 非方形 box / transform 中期都有同步漏洞。Round 7 思路:
  //   1. Transformer rotateEnabled={false} 完全关掉内置 rotater
  //   2. Stage Layer 同层渲染 React Konva Group(custom rotater 圆形 + ↻ 图标)
  //   3. customRotaterRef 持 Group node,命令式 .position()/.visible() 更新避免 re-render
  //   4. 位置更新触发点:
  //      - useEffect [selectedIds, objects, zoom, stagePos] — selection / 数据变 → 重算
  //      - transformer onTransform — transform 期间每帧重算(直接读 Konva node)
  //      - 节点 onDragMove(global) — 节点拖动同步
  //      - stage mousemove(可选,4 corner 自适应)
  //   5. 自定义 rotater 自己 onMouseDown → 进入 rotating 模式;stage mousemove 算角度
  //      → store.updateObject({rotation}) → 节点旋转 → useEffect 重算 rotater 位置
  // 完全脱离 Konva Transformer 对 rotater 的内部算法,行为 100% 可预测。
  const customRotaterRef = useRef(null) // Konva Group node ref(rotater 视觉 + 命中)
  const isTransformingRef = useRef(false) // 内置 8 anchor transform 中(用于冻结 4 corner 切换)
  const cornerRef = useRef('tr') // 当前最近 corner('tl'|'tr'|'br'|'bl')— Figma 式自适应
  const mousemoveRAFRef = useRef(0) // RAF 节流标记
  const customRotateStateRef = useRef(null) // 自定义 rotater 拖拽中 state: { startAngle, startRotation, cx, cy, objId }

  // Pan
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const isPanningRef = useRef(false)
  const scaleStrokeRef = useRef(false) // K key: scale stroke with transform
  const panStartRef = useRef({ x: 0, y: 0, sx: 0, sy: 0 })

  // Marquee selection
  const [marquee, setMarquee] = useState(null) // {x1,y1,x2,y2} in canvas coords
  const marqueeRef = useRef(null)

  // Text drag-create preview (separate from marquee — different visual)
  const [textDrawBox, setTextDrawBox] = useState(null) // {x1,y1,x2,y2}

  // Entered group — double-click drills into groups, one level at a time
  const [enteredGroupId, setEnteredGroupId] = useState(null)

  // Smart guides during drag
  const [guides, setGuides] = useState([])

  // Clipboard for Ctrl+C/V
  const clipboardRef = useRef(null)
  // Last action for Ctrl+D repeat (stores {type, data})
  const lastActionRef = useRef(null)

  // Inline text editing
  const [editingTextId, setEditingTextId] = useState(null)

  // Hover highlight
  const [hoveredId, setHoveredId] = useState(null)

  // Pen bezier state
  const penRef = useRef(null)

  const objects = useUnifiedDesignStore(s => s.objects)
  const canvasWidth = useUnifiedDesignStore(s => s.canvasWidth)
  const canvasHeight = useUnifiedDesignStore(s => s.canvasHeight)
  const backgroundColor = useUnifiedDesignStore(s => s.backgroundColor)
  const zoom = useUnifiedDesignStore(s => s.zoom)
  const activeTool = useUnifiedDesignStore(s => s.activeTool)
  const bgOpacity = useUnifiedDesignStore(s => s.bgOpacity)
  const colorGrid = useUnifiedDesignStore(s => s.colorGrid)
  const colorGridColors = useUnifiedDesignStore(s => s.colorGridColors)
  const gridType = useUnifiedDesignStore(s => s.gridType)
  const gridSize = useUnifiedDesignStore(s => s.gridSize)
  const gridSizeY = useUnifiedDesignStore(s => s.gridSizeY)
  const gridColumns = useUnifiedDesignStore(s => s.gridColumns)
  const gridMargin = useUnifiedDesignStore(s => s.gridMargin)
  const gridGutter = useUnifiedDesignStore(s => s.gridGutter)

  // iPad 触屏:双指捏合缩放 + 双指平移(单指仍交给 Konva 选择/拖对象)
  useKonvaTouchGestures(
    stageRef,
    () => ({ scale: zoom, pos: stagePos }),
    ({ scale, pos }) => { useUnifiedDesignStore.getState().setZoom(scale); setStagePos(pos) },
    { min: 0.1, max: 8 },
  )
  const gridRows = useUnifiedDesignStore(s => s.gridRows)
  const gridRowHeight = useUnifiedDesignStore(s => s.gridRowHeight)
  const gridRowGutter = useUnifiedDesignStore(s => s.gridRowGutter)
  const selectedIds = useUnifiedDesignStore(s => s.selectedIds)

  const addObject = useUnifiedDesignStore(s => s.addObject)
  const updateObject = useUnifiedDesignStore(s => s.updateObject)
  const updateChild = useUnifiedDesignStore(s => s.updateChild)
  const pushUndo = useUnifiedDesignStore(s => s.pushUndo)
  const setSelectedIds = useUnifiedDesignStore(s => s.setSelectedIds)
  const setActiveTool = useUnifiedDesignStore(s => s.setActiveTool)

  // Handle click on a child inside a group/mask
  const handleChildClick = useCallback((e, parentId, childId) => {
    if (useUnifiedDesignStore.getState().activeTool !== 'select') return
    handleMouseLeave() // clear hover
    const isCtrl = e.evt?.ctrlKey || e.evt?.metaKey
    const isShift = e.evt?.shiftKey
    if (isCtrl) {
      // Ctrl+Click: direct select child, enter parent
      setEnteredGroupId(parentId)
      setSelectedIds([childId])
    } else if (enteredGroupId === parentId) {
      // Parent is entered — Shift adds/removes, plain replaces
      if (isShift) {
        const cur = useUnifiedDesignStore.getState().selectedIds
        setSelectedIds(cur.includes(childId) ? cur.filter(id => id !== childId) : [...cur, childId])
      } else {
        setSelectedIds([childId])
      }
    } else {
      // Parent not entered: select the parent group
      setSelectedIds([parentId])
    }
  }, [enteredGroupId, setSelectedIds])

  // Handle transform end on a child inside a group/mask
  const handleChildTransform = useCallback((parentId, childId, e) => {
    const node = e.target
    pushUndo()
    const parent = useUnifiedDesignStore.getState().objects.find(o => o.id === parentId)
    const child = parent?.children?.find(c => c.id === childId)
    if (!child) return
    if (child.type === 'ellipse') {
      updateChild(parentId, childId, { x: node.x(), y: node.y(), rotation: node.rotation(),
        radiusX: Math.max(1, (child.radiusX || 50) * Math.abs(node.scaleX())),
        radiusY: Math.max(1, (child.radiusY || 50) * Math.abs(node.scaleY())), scaleX: 1, scaleY: 1 })
    } else if (child.type === 'text') {
      updateChild(parentId, childId, { x: node.x(), y: node.y(), rotation: node.rotation(),
        fontSize: Math.max(8, Math.round((child.fontSize || 24) * Math.abs(node.scaleY()))), scaleX: 1, scaleY: 1 })
    } else if (child.type === 'star') {
      const s = Math.abs(node.scaleX())
      updateChild(parentId, childId, { x: node.x(), y: node.y(), rotation: node.rotation(),
        outerRadius: Math.max(5, (child.outerRadius || 50) * s),
        innerRadius: Math.max(2, (child.innerRadius || 20) * s),
        width: (child.width || 100) * s, height: (child.height || 100) * s, scaleX: 1, scaleY: 1 })
    } else if (child.type === 'polygon') {
      const s = Math.abs(node.scaleX())
      updateChild(parentId, childId, { x: node.x(), y: node.y(), rotation: node.rotation(),
        radius: Math.max(5, (child.radius || 50) * s),
        width: (child.width || 100) * s, height: (child.height || 100) * s, scaleX: 1, scaleY: 1 })
    } else if (child.type === 'gear') {
      const s = Math.abs(node.scaleX())
      updateChild(parentId, childId, { x: node.x(), y: node.y(), rotation: node.rotation(),
        outerRadius: Math.max(5, (child.outerRadius || 50) * s),
        innerRadius: Math.max(2, (child.innerRadius || 35) * s),
        width: (child.width || 100) * s, height: (child.height || 100) * s, scaleX: 1, scaleY: 1 })
    } else if (child.type === 'path' || child.type === 'pen' || child.type === 'group' || child.type === 'mask') {
      // Bug-3 fix: entered-group 路径里嵌套的 path/group/mask 也要保留 skew
      const nskx = safeNum(node.skewX?.() ?? 0, 0)
      const nsky = safeNum(node.skewY?.() ?? 0, 0)
      updateChild(parentId, childId, {
        x: node.x(), y: node.y(), rotation: node.rotation(),
        scaleX: node.scaleX(), scaleY: node.scaleY(),
        skewX: nskx, skewY: nsky,
      })
      return // 不 reset scale
    } else {
      updateChild(parentId, childId, { x: node.x(), y: node.y(), rotation: node.rotation(),
        width: Math.max(1, node.width() * Math.abs(node.scaleX())),
        height: Math.max(1, node.height() * Math.abs(node.scaleY())), scaleX: 1, scaleY: 1 })
    }
    node.scaleX(1); node.scaleY(1)
  }, [pushUndo, updateChild])

  // Hover highlight — imperative Konva node stroke overlay, no React re-render
  const hoverRestoreRef = useRef(null) // { node, origStroke, origStrokeWidth }
  const handleMouseEnter = useCallback((e, id) => {
    if (useUnifiedDesignStore.getState().activeTool !== 'select') return
    if (useUnifiedDesignStore.getState().selectedIds.includes(id)) return
    const node = shapeRefs.current.get(id)
    if (!node || typeof node.stroke !== 'function') return
    // Save original stroke
    hoverRestoreRef.current = {
      node, id,
      origStroke: node.stroke(), origStrokeWidth: node.strokeWidth(),
    }
    node.stroke('#7c6aed')
    node.strokeWidth(Math.max(node.strokeWidth(), 1.5))
    node.getLayer()?.batchDraw()
    setHoveredId(id)
  }, [])
  const handleMouseLeave = useCallback(() => {
    const r = hoverRestoreRef.current
    if (r?.node) {
      r.node.stroke(r.origStroke)
      r.node.strokeWidth(r.origStrokeWidth)
      r.node.getLayer()?.batchDraw()
    }
    hoverRestoreRef.current = null
    setHoveredId(null)
  }, [])

  // Compute the chain of nested group/mask IDs from root down to enteredGroupId
  const enteredChain = useMemo(
    () => computeEnteredChain(objects, enteredGroupId),
    [objects, enteredGroupId]
  )

  // setEnter helper that's safe to call with any depth target
  const enterGroup = useCallback((id) => setEnteredGroupId(id), [])

  // Context for recursive rendering
  const renderCtx = useMemo(() => ({
    selectedIds, updateChild, pushUndo, handleChildClick, handleChildTransform,
    enteredGroupId, enteredChain, enterGroup, objects,
    hoveredId, handleMouseEnter, handleMouseLeave, activeTool,
  }), [selectedIds, updateChild, pushUndo, handleChildClick, handleChildTransform, enteredGroupId, enteredChain, enterGroup, objects, hoveredId, handleMouseEnter, handleMouseLeave, activeTool])

  // Fit frame on mount — guard against 0×0 container (modal not yet laid out)
  // and against canvasWidth/Height ≤ 0 (corrupt savedState). Division by zero
  // would yield NaN / -Infinity which then poisons every Konva transform.
  useEffect(() => {
    const container = stageRef.current?.container()
    if (!container) return
    const cw = container.clientWidth, ch = container.clientHeight
    if (cw <= 0 || ch <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return
    const pad = 60
    const rawFit = Math.min((cw - pad * 2) / canvasWidth, (ch - pad * 2) / canvasHeight, 1)
    const fitZoom = Number.isFinite(rawFit) && rawFit > 0 ? rawFit : 1
    useUnifiedDesignStore.getState().setZoom(fitZoom)
    setStagePos({ x: (cw - canvasWidth * fitZoom) / 2, y: (ch - canvasHeight * fitZoom) / 2 })
  }, []) // eslint-disable-line

  // Expose stage globally for store-level operations (align, etc.)
  useEffect(() => {
    window.__ucStage = stageRef.current
    return () => { window.__ucStage = null }
  })

  useImperativeHandle(ref, () => ({
    getStage: () => stageRef.current,
    toDataURL: (opts) => {
      const stage = stageRef.current
      if (!stage) return null
      const oldPos = { x: stage.x(), y: stage.y() }
      const oldScale = { x: stage.scaleX(), y: stage.scaleY() }
      stage.position({ x: 0, y: 0 })
      stage.scale({ x: 1, y: 1 })
      stage.size({ width: canvasWidth, height: canvasHeight })
      const url = stage.toDataURL({ pixelRatio: opts?.pixelRatio || 2, ...opts })
      stage.position(oldPos); stage.scale(oldScale)
      stage.size({ width: canvasWidth * zoom, height: canvasHeight * zoom })
      return url
    },
  }))

  // Sync Transformer — skip locked objects
  // tr.nodes(nodes) 内部已经监听每个 node 的 rotation/scale/x/y change,
  // node 属性改变会自动触发 transformer 重算 anchor + box。无需手动 forceUpdate。
  // (上轮诊断把"旋转手柄位置不对"误认为"transformer 不重算",实际是 rotateAnchorAngle
  // 默认值 0(顶中)的问题,见 Transformer JSX 的 rotateAnchorAngle/Offset。)
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    const allObjs = useUnifiedDesignStore.getState().objects
    const nodes = selectedIds.filter(id => {
      // Check top-level lock
      const obj = allObjs.find(o => o.id === id)
      if (obj) return !obj.locked
      // Check child lock
      for (const o of allObjs) {
        const c = o.children?.find(ch => ch.id === id)
        if (c) return !c.locked
      }
      return true
    }).map(id => shapeRefs.current.get(id)).filter(Boolean)
    tr.nodes(nodes)
    tr.getLayer()?.batchDraw()
  }, [selectedIds, objects])

  // Round 7 DEFINITIVE: 自定义 rotater 位置更新 + 4 corner 自适应
  //   - Stage mousemove(节流 RAF):算光标距 4 corner 哪个最近 → cornerRef.current
  //     变化时刷新 customRotater 位置(命令式,不 setState)
  //   - 拖拽中(isTransformingRef=true)冻结 corner 切换 + 仍然实时跟 transform 后 box
  //     (在 onTransform 里单独调 updateCustomRotaterPosition)
  // 真核心位置算法 updateCustomRotaterPosition:
  //   - 读 Konva Transformer 4 corner anchor 的 absolutePosition(屏幕坐标 = stage 坐标)
  //   - 根据 cornerRef.current 选择 corner,沿"corner 到 box center 反方向"延伸 DIAG_PX
  //   - 命令式写到 customRotaterRef.current.position() + .visible(true)
  //   - 没选中 → .visible(false)
  const updateCustomRotaterPosition = useCallback(() => {
    const tr = transformerRef.current
    const rotater = customRotaterRef.current
    if (!tr || !rotater) return
    if (!tr.nodes || tr.nodes().length === 0) {
      rotater.visible(false)
      rotater.getLayer()?.batchDraw()
      return
    }
    const tl = tr.findOne('.top-left')
    const trA = tr.findOne('.top-right')
    const br = tr.findOne('.bottom-right')
    const bl = tr.findOne('.bottom-left')
    if (!tl || !trA || !br || !bl) {
      rotater.visible(false)
      rotater.getLayer()?.batchDraw()
      return
    }
    // 屏幕坐标(已含 stage scale/pos + transformer rotation)
    const corners = {
      tl: tl.getAbsolutePosition(),
      tr: trA.getAbsolutePosition(),
      br: br.getAbsolutePosition(),
      bl: bl.getAbsolutePosition(),
    }
    // 任一 NaN → 隐藏
    for (const c of Object.values(corners)) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) {
        rotater.visible(false)
        rotater.getLayer()?.batchDraw()
        return
      }
    }
    const c = cornerRef.current
    const corner = corners[c] || corners.tr
    // box center(4 corner 平均)
    const cx = (corners.tl.x + corners.tr.x + corners.br.x + corners.bl.x) / 4
    const cy = (corners.tl.y + corners.tr.y + corners.br.y + corners.bl.y) / 4
    // 单位向量 (center → corner),沿这个方向再延伸 DIAG 屏幕 px
    const vx = corner.x - cx
    const vy = corner.y - cy
    const len = Math.hypot(vx, vy)
    const DIAG = 22 // 屏幕 px
    let outX = corner.x, outY = corner.y
    if (len > 0.001) {
      outX = corner.x + (vx / len) * DIAG
      outY = corner.y + (vy / len) * DIAG
    }
    // customRotater 在 Stage 顶层 Layer,坐标是 Layer 局部 = stage 屏幕坐标 / stage scale
    // 但我们让 rotater Layer 不缩放(用 Stage 直接 attach),这里位置就是屏幕坐标
    // 我们把 rotater 放在跟 shapes 同 Layer,Stage 有 scale 所以要转回 Layer 坐标:
    const stage = stageRef.current
    if (stage) {
      // Stage 坐标 → Layer 坐标(同 Layer 因为 scale 应用在 Stage)
      const sx = stage.x(), sy = stage.y()
      const sScale = stage.scaleX() || 1
      // Konva: layerCoord = (stageCoord - stagePos) / stageScale
      const layerX = (outX - sx) / sScale
      const layerY = (outY - sy) / sScale
      rotater.position({ x: layerX, y: layerY })
      // 半径补偿:rotater 在 layer 坐标但视觉要 stage 屏幕 px,scale 反向
      rotater.scale({ x: 1 / sScale, y: 1 / sScale })
    } else {
      rotater.position({ x: outX, y: outY })
    }
    rotater.visible(true)
    rotater.getLayer()?.batchDraw()
  }, [])

  // 选中变化 / objects 变 / zoom / pan 任何会改 corner anchor 位置的源 → 立即重算
  useEffect(() => {
    // 给 Konva 一个 tick 把 Transformer 的新 anchor 位置算出来再读
    const id = requestAnimationFrame(() => updateCustomRotaterPosition())
    return () => cancelAnimationFrame(id)
  }, [selectedIds, objects, zoom, stagePos, updateCustomRotaterPosition])

  // Stage mousemove:4 corner 自适应 — 光标距哪个 corner 最近就把 rotater 移到那里外侧
  // 拖拽中(isTransformingRef=true)冻结(防 rotater 拖一半跳走)
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onMove = () => {
      if (mousemoveRAFRef.current) return
      mousemoveRAFRef.current = requestAnimationFrame(() => {
        mousemoveRAFRef.current = 0
        const tr = transformerRef.current
        if (!tr) return
        if (isTransformingRef.current) return
        if (!tr.nodes || tr.nodes().length === 0) return
        const pos = stage.getPointerPosition()
        if (!pos) return
        const tl = tr.findOne('.top-left')
        const trA = tr.findOne('.top-right')
        const br = tr.findOne('.bottom-right')
        const bl = tr.findOne('.bottom-left')
        if (!tl || !trA || !br || !bl) return
        const ptl = tl.getAbsolutePosition()
        const ptr = trA.getAbsolutePosition()
        const pbr = br.getAbsolutePosition()
        const pbl = bl.getAbsolutePosition()
        const d2 = (a, b) => {
          const dx = a.x - b.x, dy = a.y - b.y
          return dx * dx + dy * dy
        }
        const dists = [
          ['tl', d2(pos, ptl)],
          ['tr', d2(pos, ptr)],
          ['br', d2(pos, pbr)],
          ['bl', d2(pos, pbl)],
        ]
        let nearest = dists[0]
        for (let i = 1; i < dists.length; i++) {
          if (dists[i][1] < nearest[1]) nearest = dists[i]
        }
        if (nearest[0] !== cornerRef.current) {
          cornerRef.current = nearest[0]
          updateCustomRotaterPosition()
        }
      })
    }
    stage.on('mousemove.cornerAdaptive', onMove)
    return () => {
      stage.off('mousemove.cornerAdaptive')
      if (mousemoveRAFRef.current) {
        cancelAnimationFrame(mousemoveRAFRef.current)
        mousemoveRAFRef.current = 0
      }
    }
  }, [updateCustomRotaterPosition])

  // Round 7 DEFINITIVE: 自定义 rotater 旋转交互
  //   - onMouseDown:cancelBubble 防 Stage 误判 + 记录起始 angle 和 rotation
  //   - stage.on('mousemove.customRotate'):算 cursor → bbox center 的角度差 → 写 store.rotation
  //   - stage mouseup:清理
  //   单选 + 非 group child 才允许(group child 旋转走另一通道,跟 Konva 原 rotater 一致)
  //   按 Shift 时 snap 到 15° 倍数(跟 Konva 原 rotater 行为一致)
  //
  // Round 7.1 中心旋转铁律(2026-06-02):
  //   Konva 节点旋转默认绕 origin (0,0),非 box 中心 → 旋转过程 box 中心会沿弧线移动。
  //   用户要求:无论拖 rotater 还是任何旋转入口,box 中心(getClientRect)必须保持不动。
  //   实现:
  //   1) 记录 pivot(parent-local 坐标系下 box 中心)
  //   2) 用 `node.getClientRect({relativeTo: node.getParent()})` 拿 parent-local box(已应用本节点 rot+scale)
  //   3) localOffset = rotate((boxCenter - nodeOrigin), -startRot)
  //      → 这是"未旋转时" box 中心相对 origin 的向量,旋转无关常量
  //   4) onMove:newOrigin = pivot - rotate(localOffset, newRot)
  //      → 把 newRot + newX + newY 一起 patch 到 store,box 中心永远 = pivot
  //   parent 自己 rot/scale 不影响 child 在 parent local 空间的此项计算(child 只在自己 local 旋转)。
  const handleCustomRotaterMouseDown = useCallback((e) => {
    e.cancelBubble = true
    if (e.evt?.preventDefault) e.evt.preventDefault()
    const tr = transformerRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const nodes = tr.nodes()
    if (nodes.length !== 1) return // 多选先不支持 custom rotate(跟原 Konva 行为对齐)
    const node = nodes[0]
    const objId = node.getAttr('data-id')
    if (!objId) return
    // 判断是 top-level 还是 child
    const store = useUnifiedDesignStore.getState()
    let obj = store.objects.find(o => o.id === objId)
    let parentObj = null
    if (!obj) {
      for (const o of store.objects) {
        const c = o.children?.find(ch => ch.id === objId)
        if (c) { obj = c; parentObj = o; break }
      }
    }
    if (!obj) return
    // bbox center for angle tracking(屏幕坐标系)
    const crScreen = node.getClientRect({ skipShadow: true, skipStroke: true, relativeTo: stage })
    if (!isFiniteBox(crScreen)) return
    const sx = stage.x(), sy = stage.y(), ss = stage.scaleX() || 1
    const cxScreen = crScreen.x * ss + sx + (crScreen.width * ss) / 2
    const cyScreen = crScreen.y * ss + sy + (crScreen.height * ss) / 2
    const pos = stage.getPointerPosition()
    if (!pos) return
    // pivot 在 parent-local 坐标系下 box center(node.x/y 也在此空间,与之同坐标系)
    const parentNode = node.getParent()
    const crLocal = node.getClientRect({ skipShadow: true, skipStroke: true, relativeTo: parentNode })
    if (!isFiniteBox(crLocal)) return
    const pivotLx = crLocal.x + crLocal.width / 2
    const pivotLy = crLocal.y + crLocal.height / 2
    const startRotation = obj.rotation || 0
    const startX = obj.x || 0
    const startY = obj.y || 0
    // 推导未旋转坐标系下 box center 相对 origin 的向量(常量,与 rot 无关)
    const dx0 = pivotLx - startX
    const dy0 = pivotLy - startY
    const rad0 = -startRotation * Math.PI / 180 // 反向消除当前旋转
    const cos0 = Math.cos(rad0), sin0 = Math.sin(rad0)
    const localOffsetX = cos0 * dx0 - sin0 * dy0
    const localOffsetY = sin0 * dx0 + cos0 * dy0
    const startAngle = Math.atan2(pos.y - cyScreen, pos.x - cxScreen) * 180 / Math.PI
    customRotateStateRef.current = {
      objId, parentObjId: parentObj?.id || null,
      cx: cxScreen, cy: cyScreen,
      pivotLx, pivotLy,
      localOffsetX, localOffsetY,
      startAngle, startRotation,
    }
    pushUndo()
    isTransformingRef.current = true // 借用 isTransforming 冻结 corner 切换 + Stage handler

    const onMove = () => {
      const st = customRotateStateRef.current
      const stage2 = stageRef.current
      if (!st || !stage2) return
      const p = stage2.getPointerPosition()
      if (!p) return
      const curAngle = Math.atan2(p.y - st.cy, p.x - st.cx) * 180 / Math.PI
      let delta = curAngle - st.startAngle
      let newRot = st.startRotation + delta
      // 归一化到 [-180, 180]
      while (newRot > 180) newRot -= 360
      while (newRot <= -180) newRot += 360
      // Shift 锁 15°
      const evt = window.event
      const isShift = evt?.shiftKey
      if (isShift) newRot = Math.round(newRot / 15) * 15
      // Round 7.1 中心补偿:反推新 origin 让 box 中心保持在 pivot
      const radN = newRot * Math.PI / 180
      const cosN = Math.cos(radN), sinN = Math.sin(radN)
      const newX = st.pivotLx - (cosN * st.localOffsetX - sinN * st.localOffsetY)
      const newY = st.pivotLy - (sinN * st.localOffsetX + cosN * st.localOffsetY)
      // 写 store(一次 patch rot + x + y,避免中间态)
      const store2 = useUnifiedDesignStore.getState()
      if (st.parentObjId) {
        store2.updateChild(st.parentObjId, st.objId, { rotation: newRot, x: newX, y: newY })
      } else {
        store2.updateObject(st.objId, { rotation: newRot, x: newX, y: newY })
      }
      // 重算 rotater 位置(节点 rotation 已变,corner anchor 自动跟,我们读最新)
      // 用 RAF 防同帧多次写引发重复 layout
      requestAnimationFrame(() => updateCustomRotaterPosition())
    }
    const onUp = () => {
      stage.off('mousemove.customRotate')
      stage.off('mouseup.customRotate')
      stage.off('touchmove.customRotate')
      stage.off('touchend.customRotate')
      window.removeEventListener('mouseup', onUp)
      customRotateStateRef.current = null
      isTransformingRef.current = false
      updateCustomRotaterPosition()
    }
    stage.on('mousemove.customRotate', onMove)
    stage.on('mouseup.customRotate', onUp)
    stage.on('touchmove.customRotate', onMove)
    stage.on('touchend.customRotate', onUp)
    // window mouseup 兜底(光标移出 stage 后松手)
    window.addEventListener('mouseup', onUp, { once: true })
  }, [pushUndo, updateCustomRotaterPosition])

  const getPointerPos = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return { x: 0, y: 0 }
    const pos = stage.getPointerPosition()
    if (!pos) return { x: 0, y: 0 }
    return { x: (pos.x - stagePos.x) / zoom, y: (pos.y - stagePos.y) / zoom }
  }, [zoom, stagePos])

  // Pan cursor
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat) document.body.style.cursor = 'grab'
      if (e.code === 'KeyK') scaleStrokeRef.current = true
    }
    const onKeyUp = (e) => {
      if (e.code === 'Space') document.body.style.cursor = ''
      if (e.code === 'KeyK') scaleStrokeRef.current = false
    }
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [])

  // Finalize pen path
  // closed: when true, append ' Z' to path d and set closed=true on the object.
  // Used by the "click first anchor to close" gesture in pen-tool mousedown.
  const finalizePen = useCallback((opts = {}) => {
    const p = penRef.current
    if (!p) return
    if (p.nodes.length < 2) {
      useUnifiedDesignStore.getState().removeObject(p.id)
    } else {
      const closed = !!opts.closed
      const d = penNodesToPathD(p.nodes) + (closed ? ' Z' : '')
      updateObject(p.id, { data: d, penNodes: p.nodes, ...(closed ? { closed: true } : {}) })
      pushUndo()
      setSelectedIds([p.id])
    }
    penRef.current = null
    setActiveTool('select')
  }, [updateObject, pushUndo, setSelectedIds, setActiveTool])

  // Escape / Enter to finish pen
  useEffect(() => {
    if (activeTool !== 'pen') return
    const handler = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.stopPropagation()
        finalizePen()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [activeTool, finalizePen])

  /* ── Stage mouse handlers ── */
  const handleStageMouseDown = useCallback((e) => {
    // Pan
    const isSpace = e.evt && document.body.style.cursor === 'grab'
    const isMiddle = e.evt?.button === 1
    if (isSpace || isMiddle) {
      isPanningRef.current = true
      panStartRef.current = { x: e.evt.clientX, y: e.evt.clientY, sx: stagePos.x, sy: stagePos.y }
      document.body.style.cursor = 'grabbing'; return
    }

    const tool = useUnifiedDesignStore.getState().activeTool
    // 防御:anchor/handle 名为 __anchor,不算"空白" — cancelBubble 已经在
    // anchor onMouseDown 阻止冒泡,这里是双保险,防御 Konva 版本差异 / 触屏。
    const isAnchorTarget = e.target?.name?.() === '__anchor'
    const clickedOnEmpty = !isAnchorTarget && (
      e.target === e.target.getStage() ||
      (e.target.getAttr('data-id') === undefined && e.target.getParent() === e.target.getStage()?.findOne('Layer'))
    )

    // Select: click empty = exit group or deselect, drag empty = marquee
    if (tool === 'select') {
      if (clickedOnEmpty) {
        // Anchor edit mode: clicking empty area finishes editing
        if (editingId) { onExitEdit?.(); return }
        if (enteredGroupId) {
          // Exit entered group, select the group itself
          setSelectedIds([enteredGroupId])
          setEnteredGroupId(null)
        } else {
          setSelectedIds([])
        }
        const pos = getPointerPos()
        marqueeRef.current = { x1: pos.x, y1: pos.y }
        setMarquee({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
      }
      return
    }

    // Pen (bezier): click to add nodes
    if (tool === 'pen') {
      const pos = getPointerPos()
      const allObjs = useUnifiedDesignStore.getState().objects
      const curZoom = useUnifiedDesignStore.getState().zoom || 1

      if (!penRef.current) {
        // === Resume mode — click on existing pen endpoint to continue drawing ===
        const hit = findPenEndpointAt(pos, allObjs, curZoom)
        if (hit) {
          // If user clicked the FIRST anchor, reverse the node array so the original
          // first becomes the new last (subsequent clicks extend from that side).
          const nodes = hit.end === 'last'
            ? [...hit.obj.penNodes]
            : reversePenNodes(hit.obj.penNodes)
          // If reversed, persist the new node order back to the object so the
          // rendered Path matches the in-progress penRef state.
          if (hit.end === 'first') {
            updateObject(hit.id, { penNodes: nodes, data: penNodesToPathD(nodes) })
          }
          penRef.current = { id: hit.id, nodes, dragging: false, dragIdx: nodes.length - 1 }
          // Wait for next mousedown to add a new node — don't push one immediately.
          return
        }

        // Start new pen path
        const id = addObject({
          type: 'pen', x: 0, y: 0, width: 0, height: 0,
          data: '', penNodes: [], fill: '', stroke: '#000000', strokeWidth: 2,
        })
        penRef.current = { id, nodes: [{ x: pos.x, y: pos.y }], dragging: true, dragIdx: 0 }
        updateObject(id, { data: `M ${pos.x} ${pos.y}` })
      } else {
        // === Close mode — click on current pen's starting anchor to close path ===
        const cur = penRef.current
        if (cur.nodes.length > 1) {
          const curObj = allObjs.find(o => o.id === cur.id)
          const ox = curObj?.x || 0
          const oy = curObj?.y || 0
          const firstN = cur.nodes[0]
          const firstWorld = { x: ox + firstN.x, y: oy + firstN.y }
          const HIT_RADIUS = 12 / Math.max(curZoom, 0.0001)
          if (Math.hypot(pos.x - firstWorld.x, pos.y - firstWorld.y) <= HIT_RADIUS) {
            // Close: finalizePen({closed:true}) appends ' Z' to the path d-string.
            // We use Konva Path (not Line) for pen — the `closed` flag is rendered
            // via the SVG path's Z command, not Konva's closed attribute.
            finalizePen({ closed: true })
            return
          }
        }

        // Phase 1 (#3): Pen 工具单击 vs 拖拽契约(已正确,留注释存档)
        // ─────────────────────────────────────────────────────────────
        // ① 落点 mousedown:总是 push 新 corner 锚点(无 cx1/cx2)
        // ② 起手 dragging=true:若 mouseup 前用户拖出 distance,handleStageMouseMove
        //    L1453-1465 会同时写 cx1/cy1/cx2/cy2(对称镜像 — 默认 smooth)
        // ③ 若用户没拖直接 mouseup,锚点保持 corner(直线段)
        // → 单击落 corner / 拖拽落 smooth,与 Figma / Illustrator 行为一致
        const newNode = { x: pos.x, y: pos.y }
        penRef.current.nodes.push(newNode)
        penRef.current.dragging = true
        penRef.current.dragIdx = penRef.current.nodes.length - 1
        const d = penNodesToPathD(penRef.current.nodes)
        updateObject(penRef.current.id, { data: d, penNodes: [...penRef.current.nodes] })
      }
      return
    }

    // Text — click for auto-mode, drag for fixed-frame mode.
    // Object is created on mousedown; mouseup decides which mode based on drag distance.
    if (tool === 'text') {
      const pos = getPointerPos()
      pushUndo()
      const id = addObject({
        type: 'text', x: pos.x, y: pos.y, width: 0, height: 0,
        text: '', fontSize: 32, fontFamily: 'Inter, sans-serif',
        fill: '#000000', stroke: '', strokeWidth: 0,
        textSizing: 'fixed',
      })
      drawingRef.current = { id, startX: pos.x, startY: pos.y, tool: 'text' }
      setTextDrawBox({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
      return
    }

    // Shape drawing
    const pos = getPointerPos()
    const defaults = {
      type: tool, x: pos.x, y: pos.y, width: 0, height: 0,
      fill: tool === 'line' ? '' : '#cccccc', stroke: tool === 'line' ? '#000000' : '', strokeWidth: tool === 'line' ? 2 : 0,
    }
    if (tool === 'line') defaults.points = [0, 0, 0, 0]
    if (tool === 'ellipse') { defaults.radiusX = 0; defaults.radiusY = 0 }
    if (tool === 'star') { defaults.numPoints = 5; defaults.innerRadius = 0; defaults.outerRadius = 0 }
    if (tool === 'polygon') { defaults.sides = 6; defaults.radius = 0 }
    if (tool === 'gear') { defaults.teeth = 8; defaults.innerRadius = 0; defaults.outerRadius = 0 }
    const id = addObject(defaults)
    drawingRef.current = { id, startX: pos.x, startY: pos.y, tool }
  }, [getPointerPos, addObject, pushUndo, setSelectedIds, setActiveTool, stagePos, updateObject,
      editingId, onExitEdit, enteredGroupId, setMarquee])

  const handleStageMouseMove = useCallback((e) => {
    if (isPanningRef.current) {
      const dx = e.evt.clientX - panStartRef.current.x
      const dy = e.evt.clientY - panStartRef.current.y
      setStagePos({ x: panStartRef.current.sx + dx, y: panStartRef.current.sy + dy }); return
    }

    // Pen: drag to set bezier handles
    if (penRef.current?.dragging) {
      const pos = getPointerPos()
      const p = penRef.current
      const idx = p.dragIdx
      const node = p.nodes[idx]
      const dx = pos.x - node.x, dy = pos.y - node.y
      // Outgoing handle (cx2) = drag direction, incoming handle (cx1) = mirror
      node.cx2 = node.x + dx; node.cy2 = node.y + dy
      node.cx1 = node.x - dx; node.cy1 = node.y - dy
      const d = penNodesToPathD(p.nodes)
      updateObject(p.id, { data: d, penNodes: [...p.nodes] })
      return
    }

    // Marquee drag
    if (marqueeRef.current) {
      const pos = getPointerPos()
      setMarquee({ ...marqueeRef.current, x2: pos.x, y2: pos.y })
      return
    }

    const d = drawingRef.current
    if (!d) return
    const pos = getPointerPos()
    const shiftKey = !!e.evt?.shiftKey
    const altKey = !!e.evt?.altKey

    if (d.tool === 'line') {
      let lx = pos.x - d.startX, ly = pos.y - d.startY
      // Shift: constrain to 0°/45°/90° angles
      if (shiftKey) {
        const a = Math.abs(lx), b = Math.abs(ly)
        if (a > b * 2) ly = 0
        else if (b > a * 2) lx = 0
        else { const m = Math.max(a, b); lx = m * Math.sign(lx); ly = m * Math.sign(ly) }
      }
      updateObject(d.id, { points: [0, 0, lx, ly] }); return
    }

    let w = pos.x - d.startX, h = pos.y - d.startY

    // Shift: equal ratio — use the larger dimension for both
    if (shiftKey) {
      const maxDim = Math.max(Math.abs(w), Math.abs(h))
      w = maxDim * Math.sign(w || 1)
      h = maxDim * Math.sign(h || 1)
    }

    const absW = Math.abs(w), absH = Math.abs(h)
    const updates = {}

    if (d.tool === 'ellipse') {
      if (altKey) {
        // Alt: expand from center (startX/Y is center)
        updates.x = d.startX; updates.y = d.startY
        updates.radiusX = absW; updates.radiusY = absH
      } else {
        updates.radiusX = absW / 2; updates.radiusY = absH / 2
        updates.x = d.startX + w / 2; updates.y = d.startY + h / 2
      }
    } else if (d.tool === 'star') {
      const r = Math.max(absW, absH) / (altKey ? 1 : 2)
      updates.x = d.startX; updates.y = d.startY
      updates.outerRadius = r; updates.innerRadius = r * 0.4
      updates.width = r * 2; updates.height = r * 2
    } else if (d.tool === 'polygon') {
      const r = Math.max(absW, absH) / (altKey ? 1 : 2)
      updates.x = d.startX; updates.y = d.startY
      updates.radius = r; updates.width = r * 2; updates.height = r * 2
    } else if (d.tool === 'gear') {
      const r = Math.max(absW, absH) / (altKey ? 1 : 2)
      updates.x = d.startX; updates.y = d.startY
      updates.outerRadius = r; updates.innerRadius = r * 0.7
      updates.width = r * 2; updates.height = r * 2
    } else {
      // rect, text, image, etc.
      if (altKey) {
        // Alt: expand from center
        updates.x = d.startX - absW; updates.y = d.startY - absH
        updates.width = absW * 2; updates.height = absH * 2
      } else {
        updates.x = w < 0 ? d.startX + w : d.startX
        updates.y = h < 0 ? d.startY + h : d.startY
        updates.width = absW; updates.height = absH
      }
      if (d.tool === 'text') {
        setTextDrawBox({ x1: updates.x, y1: updates.y, x2: updates.x + updates.width, y2: updates.y + updates.height })
      }
    }
    updateObject(d.id, updates)
  }, [getPointerPos, updateObject, stagePos])

  const handleStageMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false; document.body.style.cursor = ''; return
    }
    // Pen: stop dragging handle
    if (penRef.current?.dragging) {
      penRef.current.dragging = false; return
    }

    // Marquee: find objects inside selection rect
    if (marqueeRef.current) {
      const m = marqueeRef.current
      const pos = getPointerPos()
      const x1 = Math.min(m.x1, pos.x), y1 = Math.min(m.y1, pos.y)
      const x2 = Math.max(m.x1, pos.x), y2 = Math.max(m.y1, pos.y)
      marqueeRef.current = null
      setMarquee(null)
      // Only select if dragged more than 5px
      if (x2 - x1 > 5 || y2 - y1 > 5) {
        const objs = useUnifiedDesignStore.getState().objects
        const hit = objs.filter(o => {
          if (o.visible === false || o.locked || o.type === 'canvas') return false
          // Prefer Konva node's real getClientRect — path / pen / star / gear /
          // polygon have no width/height fields, so a width-height fallback hits
          // the wrong area. ShapeRefs map is populated by renderShape (L310+),
          // so any rendered top-level object has a live node here.
          const node = shapeRefs.current.get(o.id)
          if (node) {
            try {
              const r = node.getClientRect({ relativeTo: node.getLayer() })
              return r.x < x2 && r.x + r.width > x1 && r.y < y2 && r.y + r.height > y1
            } catch {}
          }
          // Fallback (kept for safety — only fires if a node isn't mounted yet)
          const ox = o.x || 0, oy = o.y || 0
          const ow = o.width || (o.radiusX ? o.radiusX * 2 : 100)
          const oh = o.height || (o.radiusY ? o.radiusY * 2 : 100)
          // For ellipse, origin is center
          const left = o.type === 'ellipse' ? ox - (o.radiusX || 50) : ox
          const top = o.type === 'ellipse' ? oy - (o.radiusY || 50) : oy
          return left < x2 && left + ow > x1 && top < y2 && top + oh > y1
        })
        if (hit.length) setSelectedIds(hit.map(o => o.id))
      }
      return
    }

    const d = drawingRef.current
    if (!d) return
    drawingRef.current = null

    // Text: click-vs-drag finalization. Always keep the object and enter edit.
    if (d.tool === 'text') {
      setTextDrawBox(null)
      const obj = useUnifiedDesignStore.getState().objects.find(o => o.id === d.id)
      if (!obj) return
      const w = obj.width || 0, h = obj.height || 0
      const isClick = w < 8 && h < 8
      if (isClick) {
        // Click-create: auto-resize mode anchored at original mousedown position
        useUnifiedDesignStore.getState().updateObject(d.id, {
          textSizing: 'auto', width: undefined, height: undefined,
          x: d.startX, y: d.startY,
        })
      } else {
        // Drag-create: keep fixed-frame mode with the dragged box
        useUnifiedDesignStore.getState().updateObject(d.id, { textSizing: 'fixed' })
      }
      setSelectedIds([d.id]); setActiveTool('select')
      requestAnimationFrame(() => startTextEdit(d.id))
      return
    }

    const obj = useUnifiedDesignStore.getState().objects.find(o => o.id === d.id)
    if (obj && d.tool !== 'pen') {
      // Ellipse uses radiusX/Y, star/polygon/gear use outerRadius/radius
      const tooSmall = obj.type === 'ellipse'
        ? (obj.radiusX || 0) < 2 && (obj.radiusY || 0) < 2
        : obj.type === 'star' || obj.type === 'gear'
        ? (obj.outerRadius || 0) < 3
        : obj.type === 'polygon'
        ? (obj.radius || 0) < 3
        : (obj.width != null && obj.width < 3) && (obj.height != null && obj.height < 3)
          && (!obj.points || obj.points.length < 4)
      if (tooSmall) { useUnifiedDesignStore.getState().removeObject(d.id); return }
    }
    pushUndo(); setSelectedIds([d.id]); setActiveTool('select')
  }, [pushUndo, setSelectedIds, setActiveTool, getPointerPos])

  // Start inline text editing
  const startTextEdit = useCallback((textId) => {
    const objs = useUnifiedDesignStore.getState().objects
    let obj = objs.find(o => o.id === textId)
    let parentObj = null
    if (!obj) {
      // Check children
      for (const o of objs) {
        const c = o.children?.find(ch => ch.id === textId)
        if (c) { obj = c; parentObj = o; break }
      }
    }
    if (!obj || obj.type !== 'text') return

    setEditingTextId(textId)
    // Hide Konva text node
    const konvaNode = shapeRefs.current.get(textId)
    if (konvaNode) konvaNode.visible(false)
    transformerRef.current?.nodes([])

    // Calculate absolute position on screen
    const stage = stageRef.current
    if (!stage) return
    const container = stage.container()
    const containerRect = container.getBoundingClientRect()

    // Build absolute transform: parent offset + object position + stage transform
    let absX = obj.x || 0, absY = obj.y || 0
    if (parentObj) { absX += parentObj.x || 0; absY += parentObj.y || 0 }
    const screenX = containerRect.left + absX * zoom + stagePos.x
    const screenY = containerRect.top + absY * zoom + stagePos.y

    const ta = document.createElement('textarea')
    ta.value = obj.text || ''
    const isFixed = obj.textSizing === 'fixed'
    const fixedW = isFixed && obj.width ? obj.width * zoom : 0
    const fixedH = isFixed && obj.height ? obj.height * zoom : 0
    ta.style.cssText = `
      position: fixed; left: ${screenX}px; top: ${screenY}px;
      ${isFixed && fixedW ? `width: ${fixedW}px; height: ${fixedH}px;` : 'min-width: 60px; min-height: 1.5em;'}
      font-size: ${(obj.fontSize || 24) * zoom}px;
      font-family: ${obj.fontFamily || 'sans-serif'};
      color: ${obj.fill || '#000'};
      background: transparent; border: 1.5px solid var(--accent, #7c6aed);
      border-radius: 3px; padding: 2px 4px; margin: 0;
      outline: none; resize: none; overflow: ${isFixed ? 'auto' : 'hidden'}; white-space: pre-wrap;
      ${isFixed ? 'word-wrap: break-word;' : ''}
      line-height: 1.2; z-index: 9999; box-sizing: border-box;
      transform-origin: top left; transform: rotate(${obj.rotation || 0}deg);
    `
    document.body.appendChild(ta)
    ta.focus()
    ta.select()

    // Auto-resize (only in auto mode)
    const autoSize = isFixed ? null : () => {
      ta.style.height = 'auto'
      ta.style.height = ta.scrollHeight + 'px'
      ta.style.width = Math.max(60, ta.scrollWidth + 8) + 'px'
    }
    if (autoSize) { autoSize(); ta.addEventListener('input', autoSize) }

    const finish = () => {
      const newText = ta.value
      if (autoSize) ta.removeEventListener('input', autoSize)
      ta.removeEventListener('blur', finish)
      ta.removeEventListener('keydown', onKey)
      document.body.removeChild(ta)
      // Remove empty text objects (e.g. created-then-escaped)
      if (!newText.trim()) {
        if (parentObj) {
          // Can't easily remove child here, just set placeholder
          updateChild(parentObj.id, textId, { text: 'Text' })
        } else {
          useUnifiedDesignStore.getState().removeObject(textId)
          setSelectedIds([])
        }
        setEditingTextId(null)
        return
      }
      if (newText !== (obj.text || '')) {
        pushUndo()
        if (parentObj) {
          updateChild(parentObj.id, textId, { text: newText })
        } else {
          updateObject(textId, { text: newText })
        }
      }
      // Restore Konva node
      const kn = shapeRefs.current.get(textId)
      if (kn) kn.visible(true)
      setEditingTextId(null)
      // Re-attach transformer
      setTimeout(() => {
        const tr = transformerRef.current
        if (tr) {
          const nodes = [textId].map(id => shapeRefs.current.get(id)).filter(Boolean)
          tr.nodes(nodes); tr.getLayer()?.batchDraw()
        }
      }, 0)
    }
    const onKey = (ev) => {
      if (ev.key === 'Escape') { ta.value = obj.text || ''; finish() }
      // Cmd/Ctrl + Enter confirms; plain Enter inserts a newline (textarea default)
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); finish() }
    }
    ta.addEventListener('blur', finish)
    ta.addEventListener('keydown', onKey)
  }, [zoom, stagePos, pushUndo, updateObject, updateChild, setSelectedIds])

  // Double-click: finish pen OR edit text OR drill into group/mask
  const handleStageDblClick = useCallback((e) => {
    if (penRef.current) { finalizePen(); return }
    if (useUnifiedDesignStore.getState().activeTool !== 'select') return

    // 编辑锚点模式 + 双击空白画板 → 完成编辑(penNodes 已经 onDragMove 实时
    // 写回 store,不需要二次 save)
    if (editingId) {
      let t = e.target
      let cid = null
      while (t && t !== e.target.getStage()) {
        cid = t.getAttr('data-id')
        if (cid) break
        t = t.getParent()
      }
      // 双击空白 或 双击的 shape 不是当前编辑对象 → 退出编辑
      if (!cid || cid !== editingId) {
        onExitEdit?.()
        return
      }
    }

    // Find clicked shape's data-id by walking up the Konva node tree
    let target = e.target
    let clickedId = null
    while (target && target !== e.target.getStage()) {
      clickedId = target.getAttr('data-id')
      if (clickedId) break
      target = target.getParent()
    }

    const sids = useUnifiedDesignStore.getState().selectedIds
    const objs = useUnifiedDesignStore.getState().objects

    // If selected text shape is double-clicked → inline edit
    if (sids.length === 1) {
      const sel = objs.find(o => o.id === sids[0])
      if (sel?.type === 'text') { startTextEdit(sel.id); return }
      // Pen object double-click → enter anchor edit mode (lossless — penNodes
      // are the source of truth).
      if (sel?.type === 'pen' && sel.penNodes?.length) {
        onEnterEdit?.(sel.id)
        return
      }
      // Phase 1 (#5): Path object double-click → auto convert to pen + enter edit.
      // Earlier behavior intentionally excluded path (用户必须右键"转可编辑")
      // because Q/A → C 转换可能有亚像素漂移。Phase 1 改 UX:直接转(右键菜单
      // "转可编辑"选项保留不删,作为显式入口)。失败/空 alert 提示,不静默。
      if (sel?.type === 'path' && !sel.penNodes?.length) {
        let penNodes
        try {
          penNodes = pathDToPenNodes(sel.data || '')
        } catch (err) {
          window.alert(`路径解析失败:${err?.message || err}\n\n这通常是因为 SVG 包含不支持的命令。`)
          return
        }
        if (!penNodes.length) {
          window.alert('SVG 路径解析为空,无法进入编辑。')
          return
        }
        pushUndo()
        const newData = penNodesToPathD(penNodes)
        updateObject(sel.id, { type: 'pen', penNodes, data: newData })
        onEnterEdit?.(sel.id)
        return
      }
      // Phase 1 (#5 extension): primitive shape double-click → convert to pen
      // and enter anchor edit. See shapeToPen.js for the per-shape conversion
      // math (KAPPA=0.5522 for ellipse / rounded-rect corners).
      //
      // Position invariant: ellipse / star / polygon → pen keeps obj.x/y as
      //   the visual center (penNodes are center-relative, range -r..r). This
      //   preserves rotation/scale pivot — Konva.Ellipse / RegularPolygon /
      //   Star all pivot at center, and Konva.Path pivots at (0,0) of its
      //   local frame, so center-relative penNodes around obj.x/y are pivot-
      //   compatible. Rect pivots at top-left already, so its penNodes use
      //   [0..w, 0..h] and obj.x/y stays.
      //
      // Failure mode: try/catch + alert mirrors path→pen branch above. We do
      //   NOT silently fall through to "enter group" below — that would be
      //   confusing UX.
      if (sel && ['ellipse', 'rect', 'polygon', 'star'].includes(sel.type) && !sel.penNodes?.length) {
        let result
        try {
          if (sel.type === 'ellipse') result = ellipseToPenNodes(sel)
          else if (sel.type === 'rect') result = rectToPenNodes(sel)
          else if (sel.type === 'polygon') result = polygonToPenNodes(sel)
          else if (sel.type === 'star') result = starToPenNodes(sel)
        } catch (err) {
          window.alert(`${sel.type} 转换为可编辑路径失败:${err?.message || err}`)
          return
        }
        if (!result || !result.penNodes?.length) {
          window.alert(`${sel.type} 转换为可编辑路径失败(空结果)。`)
          return
        }
        pushUndo()
        const newData = penNodesToPathD(result.penNodes) + (result.closed ? ' Z' : '')
        // Note: primitive-specific fields (radiusX/Y, sides, numPoints,
        // outer/innerRadius, radius, cornerRadius, width/height) are left in
        // place — the pen renderer at L385-386 only reads `data`, so dead
        // fields are harmless. Keeping them allows a future "convert back to
        // primitive" feature without data loss.
        updateObject(sel.id, {
          type: 'pen',
          penNodes: result.penNodes,
          data: newData,
          closed: !!result.closed,
        })
        onEnterEdit?.(sel.id)
        return
      }
      // Check if it's a child text
      if (!sel) {
        for (const o of objs) {
          const c = o.children?.find(ch => ch.id === sids[0])
          if (c?.type === 'text') { startTextEdit(c.id); return }
        }
      }
    }

    // Empty area double-click → pop one entered level (mirrors Esc behavior)
    if (!clickedId) {
      if (enteredGroupId) {
        const exited = enteredGroupId
        const parent = findParentOf(objs, enteredGroupId)
        setEnteredGroupId(parent?.id ?? null)
        setSelectedIds([exited])
      }
      return
    }

    // Group/mask drill-in is normally handled by the Group's own onDblClick.
    // Fallback: if user double-clicks a group element directly, enter it.
    const targetObj = findObjectDeep(objs, clickedId)
    if (targetObj && (targetObj.type === 'group' || targetObj.type === 'mask') && targetObj.children?.length) {
      setEnteredGroupId(clickedId)
      return
    }
  }, [finalizePen, setSelectedIds, startTextEdit, enteredGroupId, onEnterEdit, editingId, onExitEdit, pushUndo, updateObject])

  // Shape click (top-level objects)
  const handleShapeClick = useCallback((e, id) => {
    if (useUnifiedDesignStore.getState().activeTool !== 'select') return
    e.cancelBubble = true
    // Clear hover highlight on click
    handleMouseLeave()
    const cur = useUnifiedDesignStore.getState().selectedIds
    if (e.evt?.shiftKey) {
      setSelectedIds(cur.includes(id) ? cur.filter(sid => sid !== id) : [...cur, id])
    } else {
      // If clicking a shape already in multi-selection, keep the selection intact
      if (cur.length > 1 && cur.includes(id)) return
      setSelectedIds([id])
    }
    // If clicking outside the current entered chain, exit entered state.
    if (enteredGroupId) {
      const objsNow = useUnifiedDesignStore.getState().objects
      const chain = computeEnteredChain(objsNow, enteredGroupId)
      const parent = findParentOf(objsNow, id)
      // If the clicked object is the entered group, or its direct child, or any chain ancestor — keep entered.
      const stillInside = id === enteredGroupId || (parent && (parent.id === enteredGroupId || chain.includes(parent.id)))
      if (!stillInside) setEnteredGroupId(null)
    }
  }, [setSelectedIds, enteredGroupId])

  const handleDragEnd = useCallback((e, id) => {
    const objs = useUnifiedDesignStore.getState().objects
    const parent = findParentOf(objs, id)
    const target = parent
      ? parent.children.find(c => c.id === id)
      : objs.find(o => o.id === id)
    // NaN 兜底:e.target.x()/y() 在极端 fast drag / 旋转过的父容器内可能 NaN
    const nx = safeNum(e.target.x(), target?.x || 0)
    const ny = safeNum(e.target.y(), target?.y || 0)
    pushUndo()
    if (parent) {
      updateChild(parent.id, id, { x: nx, y: ny })
    } else {
      updateObject(id, { x: nx, y: ny })
    }
  }, [pushUndo, updateObject, updateChild])

  const handleTransformEnd = useCallback((e) => {
    const node = e.target; const id = node.getAttr('data-id')
    if (!id) return
    // 关键 NaN/Infinity 兜底:Konva Transformer 在多选 + 旋转 + 极小拖到 0 等
    // 边界条件,node.x()/y()/width()/height()/scaleX()/scaleY()/rotation() 任一
    // 都可能是 NaN/Infinity。Math.max(1, NaN)=NaN, NaN*N=NaN → 直接写回 store
    // 会让 _designerState.objects[i].width=NaN 永久污染整次会话(NaN 不会经过
    // JSON 序列化在同会话恢复,Konva 后续渲染刷屏 warning)
    // 找到当前 obj 用于 fallback
    const objs = useUnifiedDesignStore.getState().objects
    const parent = findParentOf(objs, id)
    const target = parent
      ? parent.children.find(c => c.id === id)
      : objs.find(o => o.id === id)
    if (!target) return
    // 读取所有 transform 字段并兜底
    const nx = safeNum(node.x(), target.x || 0)
    const ny = safeNum(node.y(), target.y || 0)
    const nrot = safeNum(node.rotation(), target.rotation || 0)
    const nsx = safeNum(node.scaleX(), 1)
    const nsy = safeNum(node.scaleY(), 1)
    const nw = safeNum(node.width(), target.width || 100)
    const nh = safeNum(node.height(), target.height || 100)
    // Bug-3 fix(round 3): Konva._handleAnchorDrag 用 Transform.decompose 算
    // 旋转 + 缩放组合的 attrs,**可能返回非零 skewX/skewY**(group 之前有 scale ≠ 1
    // 再旋转,或旋转后不等比缩放)。decompose 用 polar 分解:
    //   skew = atan2(a*c+b*d, a*b+c*d)  ← 非零当 rotation × asymmetric-scale 组合
    // node.setAttrs(attrs) 直接把 skewX/skewY 写到 Konva node。group 视觉 OK
    // 因为 Konva 渲染时 apply skew。但 store 只写 {x,y,rotation,scaleX,scaleY}
    // → React render → <Group> 不带 skew → Konva 把 node.skewX/skewY reset 为 0
    // → group 视觉跳变,children 看起来"大幅位置改变"。
    // 修法:对保留 scaleX/scaleY 的分支(path/pen/group/mask),也读 + 写回 skew。
    const nskx = safeNum(node.skewX?.() ?? 0, 0)
    const nsky = safeNum(node.skewY?.() ?? 0, 0)
    const absSX = Math.abs(nsx)
    const absSY = Math.abs(nsy)
    pushUndo()
    // K key held: also scale strokeWidth proportionally
    const kScale = scaleStrokeRef.current ? absSX : null
    // Check if this is a child inside a group/mask
    if (parent) {
      const child = target
      if (child.type === 'ellipse') {
        updateChild(parent.id, id, { x: nx, y: ny, rotation: nrot,
          radiusX: Math.max(1, safeSize((child.radiusX || 50) * absSX, 1)),
          radiusY: Math.max(1, safeSize((child.radiusY || 50) * absSY, 1)), scaleX: 1, scaleY: 1 })
      } else if (child.type === 'text') {
        updateChild(parent.id, id, { x: nx, y: ny, rotation: nrot,
          fontSize: Math.max(8, Math.round(safeSize((child.fontSize || 24) * absSY, 24))), scaleX: 1, scaleY: 1 })
      } else if (child.type === 'star') {
        const s = absSX
        updateChild(parent.id, id, { x: nx, y: ny, rotation: nrot,
          outerRadius: Math.max(5, safeSize((child.outerRadius || 50) * s, 50)),
          innerRadius: Math.max(2, safeSize((child.innerRadius || 20) * s, 20)),
          width: safeSize((child.width || 100) * s, 100), height: safeSize((child.height || 100) * s, 100), scaleX: 1, scaleY: 1 })
      } else if (child.type === 'polygon') {
        const s = absSX
        updateChild(parent.id, id, { x: nx, y: ny, rotation: nrot,
          radius: Math.max(5, safeSize((child.radius || 50) * s, 50)),
          width: safeSize((child.width || 100) * s, 100), height: safeSize((child.height || 100) * s, 100), scaleX: 1, scaleY: 1 })
      } else if (child.type === 'gear') {
        const s = absSX
        updateChild(parent.id, id, { x: nx, y: ny, rotation: nrot,
          outerRadius: Math.max(5, safeSize((child.outerRadius || 50) * s, 50)),
          innerRadius: Math.max(2, safeSize((child.innerRadius || 35) * s, 35)),
          width: safeSize((child.width || 100) * s, 100), height: safeSize((child.height || 100) * s, 100), scaleX: 1, scaleY: 1 })
      } else if (child.type === 'path' || child.type === 'pen' || child.type === 'group' || child.type === 'mask') {
        // Bug-3 fix: 同时写回 skewX/skewY,保留 Konva decompose 出的完整 transform
        updateChild(parent.id, id, { x: nx, y: ny, rotation: nrot, scaleX: nsx, scaleY: nsy, skewX: nskx, skewY: nsky })
        // Don't reset node scale — let React apply the stored value
        if (kScale && child.strokeWidth > 0) updateChild(parent.id, id, { strokeWidth: Math.max(0.5, safeSize(child.strokeWidth * kScale, child.strokeWidth)) })
        return
      } else {
        updateChild(parent.id, id, { x: nx, y: ny, rotation: nrot,
          width: Math.max(1, safeSize(nw * absSX, 1)),
          height: Math.max(1, safeSize(nh * absSY, 1)), scaleX: 1, scaleY: 1 })
      }
      // 重置 scale 时也加 finite 防御(Konva 拒 setattr NaN 但不报错)
      try { node.scaleX(1); node.scaleY(1) } catch {}
      if (kScale && child.strokeWidth > 0) {
        updateChild(parent.id, id, { strokeWidth: Math.max(0.5, safeSize(child.strokeWidth * kScale, child.strokeWidth)) })
      }
      return
    }
    const obj = target
    if (obj.type === 'ellipse') {
      updateObject(id, { x: nx, y: ny, rotation: nrot,
        radiusX: Math.max(1, safeSize((obj.radiusX || 50) * absSX, 1)),
        radiusY: Math.max(1, safeSize((obj.radiusY || 50) * absSY, 1)), scaleX: 1, scaleY: 1 })
    } else if (obj.type === 'text') {
      if (obj.textSizing === 'fixed') {
        // Fixed mode: resize the bounding box, keep fontSize
        updateObject(id, { x: nx, y: ny, rotation: nrot,
          width: Math.max(20, safeSize(nw * absSX, 20)),
          height: Math.max(20, safeSize(nh * absSY, 20)),
          scaleX: 1, scaleY: 1 })
      } else {
        // Auto mode: scale fontSize (current behavior)
        updateObject(id, { x: nx, y: ny, rotation: nrot,
          fontSize: Math.max(8, Math.round(safeSize((obj.fontSize || 24) * absSY, 24))), scaleX: 1, scaleY: 1 })
      }
    } else if (obj.type === 'star') {
      const s = absSX
      updateObject(id, { x: nx, y: ny, rotation: nrot,
        outerRadius: Math.max(5, safeSize((obj.outerRadius || 50) * s, 50)),
        innerRadius: Math.max(2, safeSize((obj.innerRadius || 20) * s, 20)),
        width: safeSize((obj.width || 100) * s, 100), height: safeSize((obj.height || 100) * s, 100), scaleX: 1, scaleY: 1 })
    } else if (obj.type === 'polygon') {
      const s = absSX
      updateObject(id, { x: nx, y: ny, rotation: nrot,
        radius: Math.max(5, safeSize((obj.radius || 50) * s, 50)),
        width: safeSize((obj.width || 100) * s, 100), height: safeSize((obj.height || 100) * s, 100), scaleX: 1, scaleY: 1 })
    } else if (obj.type === 'gear') {
      const s = absSX
      updateObject(id, { x: nx, y: ny, rotation: nrot,
        outerRadius: Math.max(5, safeSize((obj.outerRadius || 50) * s, 50)),
        innerRadius: Math.max(2, safeSize((obj.innerRadius || 35) * s, 35)),
        width: safeSize((obj.width || 100) * s, 100), height: safeSize((obj.height || 100) * s, 100), scaleX: 1, scaleY: 1 })
    } else if (obj.type === 'path' || obj.type === 'pen' || obj.type === 'group' || obj.type === 'mask') {
      // path/pen/group/mask: size defined by data/children, keep scaleX/scaleY
      // node.scaleX() already includes the stored scale — use directly
      // Bug-3 fix: 同时写回 skewX/skewY,保留 Konva decompose 出的完整 transform。
      // 否则 React render 把 skew reset 为 0,group 视觉跳变(children 看起来大幅位移)。
      updateObject(id, { x: nx, y: ny, rotation: nrot, scaleX: nsx, scaleY: nsy, skewX: nskx, skewY: nsky })
      if (kScale && obj.strokeWidth > 0) updateObject(id, { strokeWidth: Math.max(0.5, safeSize(obj.strokeWidth * kScale, obj.strokeWidth)) })
      return // don't reset node scale
    } else {
      updateObject(id, { x: nx, y: ny, rotation: nrot,
        width: Math.max(1, safeSize(nw * absSX, 1)),
        height: Math.max(1, safeSize(nh * absSY, 1)), scaleX: 1, scaleY: 1 })
    }
    try { node.scaleX(1); node.scaleY(1) } catch {}
    if (kScale && obj.strokeWidth > 0) {
      updateObject(id, { strokeWidth: Math.max(0.5, safeSize(obj.strokeWidth * kScale, obj.strokeWidth)) })
    }
    // 注:旧版在此 forceUpdate 修旋转手柄位置;实际 Konva setNodes 内部已经监听
    // rotation/scale/x/y change,无需手动 forceUpdate。Bug 1 真正修法是改
    // rotateAnchorAngle/Offset 到右上角(见 Transformer JSX)。
  }, [pushUndo, updateObject, updateChild])

  // Keyboard: delete + Escape to exit group
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'Escape' && enteredGroupId) {
        e.preventDefault(); e.stopPropagation()
        // Pop one level: jump to parent (or null if at top), select the just-exited group
        const objsNow = useUnifiedDesignStore.getState().objects
        const exited = enteredGroupId
        const parent = findParentOf(objsNow, enteredGroupId)
        setEnteredGroupId(parent?.id ?? null)
        setSelectedIds([exited])
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation()
        const ids = useUnifiedDesignStore.getState().selectedIds
        if (!ids.length) return
        pushUndo()
        const objs = useUnifiedDesignStore.getState().objects
        ids.forEach(id => {
          const parent = findParentOf(objs, id)
          if (parent) {
            const newChildren = parent.children.filter(c => c.id !== id)
            if (newChildren.length <= 1 && parent.type === 'mask') {
              useUnifiedDesignStore.getState().ungroupObject(parent.id)
            } else {
              useUnifiedDesignStore.getState().updateObject(parent.id, { children: newChildren })
            }
          } else {
            useUnifiedDesignStore.getState().removeObject(id)
          }
        })
        setSelectedIds([])
      }

      // Ctrl+G: group selected
      if (e.key === 'g' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        const ids = useUnifiedDesignStore.getState().selectedIds
        if (ids.length >= 1) { pushUndo(); useUnifiedDesignStore.getState().groupObjects(ids) }
        return
      }
      // Shift+A: create Auto Layout group (or toggle on existing group)
      // Ctrl+M: create mask from selected
      if (e.key === 'm' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        const ids = useUnifiedDesignStore.getState().selectedIds
        if (ids.length >= 2) { pushUndo(); useUnifiedDesignStore.getState().createMask(ids) }
        return
      }

      // Ctrl+C: copy selected
      if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const ids = useUnifiedDesignStore.getState().selectedIds
        if (!ids.length) return
        const objs = useUnifiedDesignStore.getState().objects
        const copied = ids.map(id => {
          let o = objs.find(x => x.id === id)
          if (!o) { for (const p of objs) { const c = p.children?.find(ch => ch.id === id); if (c) { o = c; break } } }
          return o ? JSON.parse(JSON.stringify(o)) : null
        }).filter(Boolean)
        if (copied.length) clipboardRef.current = copied
        return
      }
      // Ctrl+V: paste
      if (e.key === 'v' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (!clipboardRef.current?.length) return
        e.preventDefault()
        pushUndo()
        const newIds = []
        clipboardRef.current.forEach(src => {
          const cloned = regenIds(src)
          const newId = useUnifiedDesignStore.getState().addObject({
            ...cloned, x: (src.x || 0) + 20, y: (src.y || 0) + 20,
          })
          newIds.push(newId)
        })
        setSelectedIds(newIds)
        // Offset clipboard for subsequent pastes
        clipboardRef.current = clipboardRef.current.map(o => ({ ...o, x: (o.x || 0) + 20, y: (o.y || 0) + 20 }))
        // Record for Ctrl+D repeat
        lastActionRef.current = { type: 'paste', clipboard: clipboardRef.current.map(o => JSON.parse(JSON.stringify(o))) }
        return
      }

      // Ctrl+D: duplicate selected with last offset (from alt-drag), or default +20,+20
      if (e.key === 'd' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        const ids = useUnifiedDesignStore.getState().selectedIds
        if (!ids.length) return
        pushUndo()
        const last = lastActionRef.current
        const dx = (last?.type === 'alt-copy') ? last.dx : 20
        const dy = (last?.type === 'alt-copy') ? last.dy : 20
        const objs = useUnifiedDesignStore.getState().objects
        const newIds = []
        ids.forEach(id => {
          let o = objs.find(x => x.id === id)
          if (!o) { for (const p of objs) { const c = p.children?.find(ch => ch.id === id); if (c) { o = c; break } } }
          if (!o) return
          const cloned = regenIds(JSON.parse(JSON.stringify(o)))
          const newId = useUnifiedDesignStore.getState().addObject({
            ...cloned, x: (o.x || 0) + dx, y: (o.y || 0) + dy,
          })
          newIds.push(newId)
        })
        if (newIds.length) {
          setSelectedIds(newIds)
          // Keep the same offset for next Ctrl+D
          lastActionRef.current = { type: 'alt-copy', dx, dy }
        }
        return
      }

      // Z-order shortcuts: Ctrl+[ / Ctrl+] move one step, Ctrl+Shift+[ / Ctrl+Shift+] top/bottom
      if ((e.key === '[' || e.key === ']') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); e.stopPropagation()
        const ids = useUnifiedDesignStore.getState().selectedIds
        if (ids.length !== 1) return
        const id = ids[0]
        const store = useUnifiedDesignStore.getState()
        const parent = findParentOf(store.objects, id)
        pushUndo()

        if (parent) {
          // Child inside group/mask — reorder within parent.children
          const arr = parent.children
          const curIdx = arr.findIndex(c => c.id === id)
          if (curIdx === -1) return
          let newIdx
          if (e.shiftKey) {
            newIdx = e.key === ']' ? arr.length - 1 : 0
          } else {
            newIdx = e.key === ']' ? curIdx + 1 : curIdx - 1
          }
          store.reorderChild(parent.id, id, newIdx)
        } else {
          // Top-level object
          const curIdx = store.objects.findIndex(o => o.id === id)
          if (curIdx === -1) return
          let newIdx
          if (e.shiftKey) {
            newIdx = e.key === ']' ? store.objects.length - 1 : 0
          } else {
            newIdx = e.key === ']' ? curIdx + 1 : curIdx - 1
          }
          store.reorderObject(id, newIdx)
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [pushUndo, setSelectedIds, enteredGroupId])

  // Wheel — use refs to avoid re-binding listener on every zoom/pan change
  const zoomRef = useRef(zoom)
  const stagePosRef = useRef(stagePos)
  zoomRef.current = zoom
  stagePosRef.current = stagePos

  useEffect(() => {
    const container = stageRef.current?.container()
    if (!container) return
    const handler = (e) => {
      e.preventDefault()
      // Guard refs — if zoom got poisoned somehow (legacy state, race), reset to 1
      // before doing math, otherwise mx/my become NaN and propagate to stagePos.
      const curZoom = (Number.isFinite(zoomRef.current) && zoomRef.current > 0) ? zoomRef.current : 1
      const cp = stagePosRef.current
      const curPos = {
        x: Number.isFinite(cp?.x) ? cp.x : 0,
        y: Number.isFinite(cp?.y) ? cp.y : 0,
      }
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        const newZoom = Math.max(0.1, Math.min(5, curZoom + delta))
        const pointer = stageRef.current.getPointerPosition()
        if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
          const mx = (pointer.x - curPos.x) / curZoom, my = (pointer.y - curPos.y) / curZoom
          const nx = pointer.x - mx * newZoom
          const ny = pointer.y - my * newZoom
          if (Number.isFinite(nx) && Number.isFinite(ny)) setStagePos({ x: nx, y: ny })
        }
        useUnifiedDesignStore.getState().setZoom(newZoom)
      } else {
        const dx = Number.isFinite(e.deltaX) ? e.deltaX : 0
        const dy = Number.isFinite(e.deltaY) ? e.deltaY : 0
        setStagePos(p => ({ x: (p.x || 0) - dx, y: (p.y || 0) - dy }))
      }
    }
    container.addEventListener('wheel', handler, { passive: false })
    return () => container.removeEventListener('wheel', handler)
  }, []) // eslint-disable-line — refs avoid stale closures

  /* ── Build shapes ── */
  const shapeElements = useMemo(() => {
    return objects.filter(obj => obj.visible !== false).map((obj) => {
      const isCanvas = obj.type === 'canvas'
      const isSelectable = activeTool === 'select' && !obj.locked && !isCanvas
      const isDraggable = isSelectable
      const commonProps = {
        'data-id': obj.id, x: obj.x ?? 0, y: obj.y ?? 0,
        stroke: obj.stroke ?? '', strokeWidth: obj.strokeWidth ?? 0,
        lineCap: obj.lineCap || 'butt', lineJoin: obj.lineJoin || 'miter',
        strokeScaleEnabled: false,
        opacity: obj.opacity ?? 1, rotation: obj.rotation ?? 0,
        scaleX: obj.scaleX ?? 1, scaleY: obj.scaleY ?? 1,
        // Bug-3 fix: 同时透出 skewX/skewY,让 path/pen 走 ...commonProps 时也带 skew
        skewX: obj.skewX ?? 0, skewY: obj.skewY ?? 0,
        globalCompositeOperation: obj.blendMode || 'source-over',
        visible: obj.visible !== false, draggable: isDraggable,
        onClick: (e) => handleShapeClick(e, obj.id),
        onTap: (e) => handleShapeClick(e, obj.id),
        onDragStart: (e) => {
          if (e.evt?.button != null && e.evt.button !== 0) { e.target.stopDrag(); return }
          e.target._dragOrigin = { x: obj.x || 0, y: obj.y || 0 }
          // Alt+drag: create copy at origin immediately (visible while dragging)
          if (e.evt?.altKey) {
            // 强制 commit 当前 inline edit(text/title 等正在编辑的 textarea/input)
            // → blur 触发 onChange + 写回 store,确保 alt-copy 拿到最新属性
            // 否则复制出来的是 store 里编辑前的旧值,用户改的字号/字体丢失
            try { document.activeElement?.blur?.() } catch {}
            pushUndo()
            // 从 store **重新拉一份最新 obj**(避免 closure 引用编辑前的旧 obj)
            const freshObj = useUnifiedDesignStore.getState().objects.find(o => o.id === obj.id) || obj
            const cloned = regenIds(JSON.parse(JSON.stringify(freshObj)))
            const copyId = useUnifiedDesignStore.getState().addObject({ ...cloned, x: freshObj.x || 0, y: freshObj.y || 0 })
            e.target._altCopyId = copyId
          }
          const cur = useUnifiedDesignStore.getState().selectedIds
          if (!cur.includes(obj.id)) setSelectedIds([obj.id])
        },
        onDragMove: (e) => {
          const node = e.target
          // Shift: constrain to X or Y axis
          if (e.evt?.shiftKey && node._dragOrigin) {
            const o = node._dragOrigin
            const dx = Math.abs(node.x() - o.x)
            const dy = Math.abs(node.y() - o.y)
            if (dx >= dy) node.y(o.y)
            else node.x(o.x)
          }
          // Smart guides: snap to other objects + canvas edges
          const store = useUnifiedDesignStore.getState()
          const others = store.objects.filter(o => o.id !== obj.id && o.visible !== false && o.type !== 'canvas')
          const dragBox = { x: node.x(), y: node.y(), w: obj.width || 100, h: obj.height || 100 }
          const gl = buildLayoutGrid(store, store.canvasWidth, store.canvasHeight)
          const gt = (gl.snapX.length || gl.snapY.length) ? { x: gl.snapX, y: gl.snapY } : null
          const snap = calcSnap(dragBox, others, store.canvasWidth, store.canvasHeight, gt)
          if (snap.dx) node.x(node.x() + snap.dx)
          if (snap.dy) node.y(node.y() + snap.dy)
          setGuides(snap.guides)
        },
        onDragEnd: (e) => {
          const origin = e.target._dragOrigin
          if (origin && e.target._altCopyId) {
            // Record delta for Ctrl+D repeat
            const dx = e.target.x() - origin.x
            const dy = e.target.y() - origin.y
            lastActionRef.current = { type: 'alt-copy', dx, dy }
          }
          delete e.target._dragOrigin
          delete e.target._altCopyId
          setGuides([])
          handleDragEnd(e, obj.id)
        },
        onTransformEnd: handleTransformEnd,
        onMouseEnter: (e) => handleMouseEnter(e, obj.id),
        onMouseLeave: handleMouseLeave,
        ...(isSelectable ? {
          hitStrokeWidth: (!obj.fill || obj.fill === 'transparent' || obj.fillType === 'none') ? 20 : 12,
        } : { listening: false }),
      }
      if (obj.width != null) commonProps.width = obj.width
      if (obj.height != null) commonProps.height = obj.height
      if (obj.fillType === 'gradient' && obj.gradientColors) {
        const w = obj.width || 100, h = obj.height || 100
        const rad = ((obj.gradientAngle || 0) * Math.PI) / 180
        const cos = Math.cos(rad), sin = Math.sin(rad)
        const projLen = Math.abs(w * cos) + Math.abs(h * sin)
        const cx = w / 2, cy = h / 2, dx = (cos * projLen) / 2, dy = (sin * projLen) / 2
        commonProps.fillLinearGradientStartPoint = { x: cx - dx, y: cy - dy }
        commonProps.fillLinearGradientEndPoint = { x: cx + dx, y: cy + dy }
        const _gc = obj.gradientColors
        commonProps.fillLinearGradientColorStops = [0, hexAlphaToRgba(_gc.c1 || '#000', _gc.a1), 1, hexAlphaToRgba(_gc.c2 || '#fff', _gc.a2)]
      } else if (obj.fillType === 'radial' && obj.gradientColors) {
        const w = obj.width || 100, h = obj.height || 100
        const _gc = obj.gradientColors
        const r = Math.max(w, h) / 2
        commonProps.fillRadialGradientStartPoint = { x: w / 2, y: h / 2 }
        commonProps.fillRadialGradientEndPoint = { x: w / 2, y: h / 2 }
        commonProps.fillRadialGradientStartRadius = 0
        commonProps.fillRadialGradientEndRadius = r
        commonProps.fillRadialGradientColorStops = [0, hexAlphaToRgba(_gc.c1 || '#000', _gc.a1), 1, hexAlphaToRgba(_gc.c2 || '#fff', _gc.a2)]
      } else {
        commonProps.fill = obj.fill ?? ''
      }
      applyEffects(obj, commonProps)
      return renderShape(obj, commonProps, shapeRefs, renderCtx)
    })
  }, [objects, activeTool, handleShapeClick, handleDragEnd, handleTransformEnd])


  const cursor = useMemo(() => {
    if (activeTool === 'select') return 'default'
    if (activeTool === 'pen') return 'crosshair'
    return 'crosshair'
  }, [activeTool])

  // Stage size
  const [stageSize, setStageSize] = useState({ w: 1200, h: 800 })
  useEffect(() => {
    const container = stageRef.current?.container()?.parentElement
    if (!container) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setStageSize({ w: width, h: height })
    })
    ro.observe(container)
    setStageSize({ w: container.clientWidth, h: container.clientHeight })
    return () => ro.disconnect()
  }, [])

  /* ── Render ── */
  // Last-line defense: any NaN/Infinity here floods Konva with warnings
  // and breaks the canvas. Always pass finite numbers to Stage.
  const safeStageW = Number.isFinite(stageSize.w) && stageSize.w > 0 ? stageSize.w : 1
  const safeStageH = Number.isFinite(stageSize.h) && stageSize.h > 0 ? stageSize.h : 1
  const safeStageX = Number.isFinite(stagePos.x) ? stagePos.x : 0
  const safeStageY = Number.isFinite(stagePos.y) ? stagePos.y : 0
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return (
    <Stage ref={stageRef} width={safeStageW} height={safeStageH}
      x={safeStageX} y={safeStageY} scaleX={safeZoom} scaleY={safeZoom}
      onMouseDown={handleStageMouseDown} onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp} onDblClick={handleStageDblClick}
      onTouchStart={handleStageMouseDown} onTouchMove={handleStageMouseMove}
      onTouchEnd={handleStageMouseUp}
      /* touchAction none:iOS WKWebView 缺它时单指 touchmove 被浏览器原生
         滚动手势抢走(touchcancel 打断 Konva 拖拽)→ iPad 图形拖不动。
         Konva 官方移动端要求;鼠标行为零影响。 */
      style={{ cursor, touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}>
      <Layer>
        <Rect key="__pb__" name="__export_hide" x={-5000} y={-5000} width={10000 + canvasWidth} height={10000 + canvasHeight}
          fill="#1a1a1a" listening={false} />
        <Rect key="__bg__" x={0} y={0} width={canvasWidth} height={canvasHeight}
          fill={backgroundColor === 'transparent' ? '' : (backgroundColor || '#ffffff')}
          opacity={bgOpacity ?? 1} listening={true}
          shadowColor="rgba(0,0,0,0.3)" shadowBlur={20} shadowEnabled={true} />

        {/* Color block grid (3:6:1) */}
        {colorGrid && buildColorGrid(colorGrid, colorGridColors, canvasWidth, canvasHeight).map((b, i) => (
          <Rect key={`__cb_${i}`} name="__export_hide" x={b.x} y={b.y} width={b.w} height={b.h}
            fill={b.fill} opacity={b.opacity} listening={false} perfectDrawEnabled={false} />
        ))}
        {/* Divider lines between color blocks */}
        {colorGrid && (() => {
          const isH = colorGrid === 'horizontal'
          const p1 = isH ? canvasHeight * 0.3 : canvasWidth * 0.3
          const p2 = isH ? canvasHeight * 0.9 : canvasWidth * 0.9
          return <>
            <Line key="__cbd1" name="__export_hide" points={isH ? [0, p1, canvasWidth, p1] : [p1, 0, p1, canvasHeight]}
              stroke="rgba(124,106,237,0.4)" strokeWidth={1} dash={[6, 4]} listening={false} />
            <Line key="__cbd2" name="__export_hide" points={isH ? [0, p2, canvasWidth, p2] : [p2, 0, p2, canvasHeight]}
              stroke="rgba(124,106,237,0.4)" strokeWidth={1} dash={[6, 4]} listening={false} />
          </>
        })()}

        {/* Layout grid overlay */}
        {gridType && (() => {
          const gl = buildLayoutGrid({ gridType, gridSize, gridSizeY, gridColumns, gridMargin, gridGutter, gridRows, gridRowHeight, gridRowGutter }, canvasWidth, canvasHeight)
          return <>
            {gl.rects.map((r, i) => (
              <Rect key={`__gr_${i}`} name="__export_hide" x={r.x} y={r.y} width={r.w} height={r.h}
                fill={r.fill} listening={false} perfectDrawEnabled={false} />
            ))}
            {gl.lines.map((g, i) => (
              <Line key={`__gl_${i}`} name="__export_hide" points={g.pts} stroke={g.stroke} strokeWidth={1}
                listening={false} perfectDrawEnabled={false} />
            ))}
          </>
        })()}

        {shapeElements}

        {/* Pen preview: show nodes & handles while drawing */}
        {penRef.current && penRef.current.nodes.map((n, i) => {
          const hasHandle = n.cx2 != null
          return (
            <React.Fragment key={`__pen_n_${i}`}>
              {/* Control handle lines */}
              {hasHandle && (
                <>
                  <Line key={`__pen_hl1_${i}`} points={[n.cx1, n.cy1, n.x, n.y]}
                    stroke="#7c6aed" strokeWidth={1 / zoom} dash={[3 / zoom, 3 / zoom]} listening={false} />
                  <Line key={`__pen_hl2_${i}`} points={[n.x, n.y, n.cx2, n.cy2]}
                    stroke="#7c6aed" strokeWidth={1 / zoom} dash={[3 / zoom, 3 / zoom]} listening={false} />
                  <Circle key={`__pen_hc1_${i}`} x={n.cx1} y={n.cy1} radius={3 / zoom}
                    fill="#7c6aed" stroke="#fff" strokeWidth={1 / zoom} listening={false} />
                  <Circle key={`__pen_hc2_${i}`} x={n.cx2} y={n.cy2} radius={3 / zoom}
                    fill="#7c6aed" stroke="#fff" strokeWidth={1 / zoom} listening={false} />
                </>
              )}
              {/* Anchor node */}
              <Circle key={`__pen_a_${i}`} x={n.x} y={n.y} radius={4 / zoom}
                fill="#fff" stroke="#7c6aed" strokeWidth={2 / zoom} listening={false} />
            </React.Fragment>
          )
        })}

        {/* Anchor handles in edit mode */}
        {editingId && (() => {
          const editObj = objects.find(o => o.id === editingId)
          if (!editObj) return null
          // Pen/path with penNodes — show anchors + handles
          if (editObj.penNodes?.length) {
            const nodesList = editObj.penNodes
            // Closed-path 首尾判定:首尾锚点坐标重合(<0.5px 容差)→ 视为闭合,
            // 则首锚点的"上一段"是倒数第二个,末锚点的"下一段"是第二个。
            // 用于 corner→smooth 时基于"前后段"方向计算 handle 初始角度/长度。
            const isClosed = (() => {
              if (nodesList.length < 3) return false
              const f = nodesList[0], l = nodesList[nodesList.length - 1]
              return Math.hypot(f.x - l.x, f.y - l.y) < 0.5
            })()
            const prevIdx = (i) => {
              if (i > 0) return i - 1
              return isClosed ? nodesList.length - 2 : -1  // closed: skip duplicate last
            }
            const nextIdx = (i) => {
              if (i < nodesList.length - 1) return i + 1
              return isClosed ? 1 : -1  // closed: skip duplicate first
            }
            return nodesList.map((n, i) => {
              const isSmooth = n.cx2 != null || n.cx1 != null
              // Phantom-handle 起手判定:corner 锚点 Alt+drag 拉出对称 handle。
              // 拖手柄(cx1/cx2)Alt 含义不同(打断镜像),不要混。
              return (
                <React.Fragment key={`__ea_${editObj.id}_${i}`}>
                  {isSmooth && (
                    <>
                      {/* Handle lines:用 Konva x/y prop 整体偏移到 editObj 位置 — points
                          是 penNodes 局部坐标,跟下方锚点 Circle 的绝对坐标系对齐。
                          cx1/cx2 任一可能为 null(asymmetric / 单边 handle),
                          各自单独判断,缺哪根不画哪根。 */}
                      {n.cx1 != null && (
                        <Line x={editObj.x || 0} y={editObj.y || 0} points={[n.cx1, n.cy1, n.x, n.y]}
                          stroke="#7c6aed" strokeWidth={1 / zoom} dash={[3 / zoom, 3 / zoom]} listening={false} />
                      )}
                      {n.cx2 != null && (
                        <Line x={editObj.x || 0} y={editObj.y || 0} points={[n.x, n.y, n.cx2, n.cy2]}
                          stroke="#7c6aed" strokeWidth={1 / zoom} dash={[3 / zoom, 3 / zoom]} listening={false} />
                      )}
                      {/* Draggable handle 1 (entry: cx1/cy1).
                          Figma 默认:拖一根 handle → 对侧 handle 以锚点为中心镜像。
                          按住 Alt(macOS Option)→ 只动当前 handle,打破镜像。
                          Phase 1 (#4):若对侧本来 null(corner-on-one-side),
                          未按 Alt → 自动建立对称 handle(隐式 corner→smooth 升级)。
                          按 Alt → 保持对侧 null(asymmetric corner-handle 维持)。
                          name="__anchor" + onMouseDown cancelBubble:防止事件冒泡到
                          Stage,绕开 handleStageMouseDown 的 clickedOnEmpty 误判,
                          否则会把 editingId 状态搞乱(L963 退出 / L968 清选区)。*/}
                      {n.cx1 != null && (
                        <Circle name="__anchor"
                          x={(editObj.x || 0) + n.cx1} y={(editObj.y || 0) + n.cy1}
                          radius={3 / zoom} fill="#7c6aed" stroke="#fff" strokeWidth={1 / zoom}
                          hitStrokeWidth={24 / zoom}
                          draggable
                          onMouseDown={(e) => { e.cancelBubble = true }}
                          onTouchStart={(e) => { e.cancelBubble = true }}
                          onDragMove={(e) => {
                            const nodes = [...editObj.penNodes]
                            const nd = { ...nodes[i] }
                            const newCx1 = e.target.x() - (editObj.x || 0)
                            const newCy1 = e.target.y() - (editObj.y || 0)
                            nd.cx1 = newCx1; nd.cy1 = newCy1
                            // Phase 1 (#4):Alt 未按下 → 对侧总是建立 / 同步镜像
                            // (cx2 == null 也走这里 — 隐式 corner→smooth 升级)
                            if (!e.evt?.altKey) {
                              nd.cx2 = 2 * nd.x - newCx1
                              nd.cy2 = 2 * nd.y - newCy1
                            }
                            nodes[i] = nd
                            updateObject(editObj.id, { penNodes: nodes, data: penNodesToPathD(nodes) })
                          }} onDragEnd={() => pushUndo()} />
                      )}
                      {/* Draggable handle 2 (exit: cx2/cy2) — 对称逻辑 */}
                      {n.cx2 != null && (
                        <Circle name="__anchor"
                          x={(editObj.x || 0) + n.cx2} y={(editObj.y || 0) + n.cy2}
                          radius={3 / zoom} fill="#7c6aed" stroke="#fff" strokeWidth={1 / zoom}
                          hitStrokeWidth={24 / zoom}
                          draggable
                          onMouseDown={(e) => { e.cancelBubble = true }}
                          onTouchStart={(e) => { e.cancelBubble = true }}
                          onDragMove={(e) => {
                            const nodes = [...editObj.penNodes]
                            const nd = { ...nodes[i] }
                            const newCx2 = e.target.x() - (editObj.x || 0)
                            const newCy2 = e.target.y() - (editObj.y || 0)
                            nd.cx2 = newCx2; nd.cy2 = newCy2
                            // Phase 1 (#4):Alt 未按下 → 对侧总是建立 / 同步镜像
                            if (!e.evt?.altKey) {
                              nd.cx1 = 2 * nd.x - newCx2
                              nd.cy1 = 2 * nd.y - newCy2
                            }
                            nodes[i] = nd
                            updateObject(editObj.id, { penNodes: nodes, data: penNodesToPathD(nodes) })
                          }} onDragEnd={() => pushUndo()} />
                      )}
                    </>
                  )}
                  {/* Anchor point — name + cancelBubble 同上。
                      Phase 1 (#2):视觉区分 — corner 锚点画方形 Rect,smooth 画圆形 Circle。
                      Phase 1 (#1):Phantom handle — corner 锚点 Alt+drag 拉出对称 handle。
                      Phase 1 (#2):双击锚点 — corner ↔ smooth 切换。 */}
                  {isSmooth ? (
                    <Circle name="__anchor"
                      x={(editObj.x || 0) + n.x} y={(editObj.y || 0) + n.y}
                      radius={5 / zoom} fill="#fff" stroke="#7c6aed" strokeWidth={2 / zoom}
                      hitStrokeWidth={20 / zoom}
                      draggable
                      onMouseDown={(e) => { e.cancelBubble = true }}
                      onTouchStart={(e) => { e.cancelBubble = true }}
                      onDblClick={(e) => {
                        // smooth → corner:删除 cx1/cy1/cx2/cy2
                        e.cancelBubble = true
                        pushUndo()
                        const nodes = [...editObj.penNodes]
                        const nd = { ...nodes[i] }
                        delete nd.cx1; delete nd.cy1; delete nd.cx2; delete nd.cy2
                        nodes[i] = nd
                        updateObject(editObj.id, { penNodes: nodes, data: penNodesToPathD(nodes) })
                      }}
                      onDragMove={(e) => {
                        const nodes = [...editObj.penNodes]
                        const nd = { ...nodes[i] }
                        const ox = e.target.x() - (editObj.x || 0) - nd.x
                        const oy = e.target.y() - (editObj.y || 0) - nd.y
                        nd.x += ox; nd.y += oy
                        if (nd.cx1 != null) { nd.cx1 += ox; nd.cy1 += oy }
                        if (nd.cx2 != null) { nd.cx2 += ox; nd.cy2 += oy }
                        nodes[i] = nd
                        updateObject(editObj.id, { penNodes: nodes, data: penNodesToPathD(nodes) })
                      }} onDragEnd={() => pushUndo()} />
                  ) : (
                    // Corner anchor — Rect 方形 + Phantom handle Alt+drag
                    // Konva Rect 是从左上角 (x,y) 渲染,要 offset 让 (n.x,n.y) 是中心
                    <Rect name="__anchor"
                      x={(editObj.x || 0) + n.x - 4 / zoom} y={(editObj.y || 0) + n.y - 4 / zoom}
                      width={8 / zoom} height={8 / zoom}
                      fill="#fff" stroke="#7c6aed" strokeWidth={2 / zoom}
                      hitStrokeWidth={20 / zoom}
                      draggable
                      onMouseDown={(e) => { e.cancelBubble = true }}
                      onTouchStart={(e) => { e.cancelBubble = true }}
                      onDblClick={(e) => {
                        // corner → smooth:基于前/后锚点方向计算对称 handle
                        // handle 长度 = min(到前段距离, 到后段距离) / 3
                        e.cancelBubble = true
                        pushUndo()
                        const nodes = [...editObj.penNodes]
                        const nd = { ...nodes[i] }
                        const pi = prevIdx(i), ni = nextIdx(i)
                        const prev = pi >= 0 ? nodesList[pi] : null
                        const next = ni >= 0 ? nodesList[ni] : null
                        let dirX = 0, dirY = 0, segLen = 0
                        if (prev && next) {
                          // 双侧都有 — handle 方向 = next - prev(切线方向)
                          dirX = next.x - prev.x; dirY = next.y - prev.y
                          const distPrev = Math.hypot(nd.x - prev.x, nd.y - prev.y)
                          const distNext = Math.hypot(nd.x - next.x, nd.y - next.y)
                          segLen = Math.min(distPrev, distNext) / 3
                        } else if (prev) {
                          // 末端锚点 — 沿 prev → cur 方向
                          dirX = nd.x - prev.x; dirY = nd.y - prev.y
                          segLen = Math.hypot(dirX, dirY) / 3
                        } else if (next) {
                          // 首锚点 — 沿 cur → next 方向
                          dirX = next.x - nd.x; dirY = next.y - nd.y
                          segLen = Math.hypot(dirX, dirY) / 3
                        }
                        const dirLen = Math.hypot(dirX, dirY) || 1
                        const ux = dirX / dirLen, uy = dirY / dirLen
                        // cx2 = 沿切线正向(指向 next),cx1 = 反向(指向 prev)
                        nd.cx2 = nd.x + ux * segLen; nd.cy2 = nd.y + uy * segLen
                        nd.cx1 = nd.x - ux * segLen; nd.cy1 = nd.y - uy * segLen
                        nodes[i] = nd
                        updateObject(editObj.id, { penNodes: nodes, data: penNodesToPathD(nodes) })
                      }}
                      onDragStart={(e) => {
                        // Phase 1 (#1):Alt+drag 起手 → 进入 phantom-handle 模式
                        // 记录起始位置 + 模式标记。onDragMove 据此决定是移动 anchor 还是拉手柄。
                        e.target.setAttr('__anchorStartX', e.target.x())
                        e.target.setAttr('__anchorStartY', e.target.y())
                        e.target.setAttr('__phantomMode', !!e.evt?.altKey)
                      }}
                      onDragMove={(e) => {
                        const nodes = [...editObj.penNodes]
                        const nd = { ...nodes[i] }
                        const isPhantom = e.target.getAttr('__phantomMode')
                        if (isPhantom) {
                          // Phantom handle 模式:anchor 不动,从锚点中心拉出对称 handle
                          const startX = e.target.getAttr('__anchorStartX')
                          const startY = e.target.getAttr('__anchorStartY')
                          // Konva drag 实时位置 - 起始位置 = 拉伸 delta
                          const dx = e.target.x() - startX
                          const dy = e.target.y() - startY
                          // 锁回锚点视觉位置(Rect 视觉位置 = 渲染 x/y).否则 Rect 会跟手指走。
                          e.target.x(startX)
                          e.target.y(startY)
                          nd.cx2 = nd.x + dx; nd.cy2 = nd.y + dy
                          nd.cx1 = nd.x - dx; nd.cy1 = nd.y - dy
                        } else {
                          // 普通拖动:anchor 移动 + handle 跟随
                          // Rect 渲染锚点为 n.x + offset - 4/zoom(Rect 是左上角原点),
                          // 反推时要加回 4/zoom 才能拿到 anchor 中心局部坐标。
                          const ox = e.target.x() + 4 / zoom - (editObj.x || 0) - nd.x
                          const oy = e.target.y() + 4 / zoom - (editObj.y || 0) - nd.y
                          nd.x += ox; nd.y += oy
                          if (nd.cx1 != null) { nd.cx1 += ox; nd.cy1 += oy }
                          if (nd.cx2 != null) { nd.cx2 += ox; nd.cy2 += oy }
                        }
                        nodes[i] = nd
                        updateObject(editObj.id, { penNodes: nodes, data: penNodesToPathD(nodes) })
                      }}
                      onDragEnd={(e) => {
                        e.target.setAttr('__phantomMode', false)
                        pushUndo()
                      }} />
                  )}
                </React.Fragment>
              )
            })
          }
          // Line with flat points
          if (editObj.points?.length >= 2) {
            const pts = editObj.points
            const handles = []
            for (let i = 0; i < pts.length; i += 2) {
              const pi = i
              handles.push(
                <Circle key={`__a_${editObj.id}_${i}`} name="__anchor"
                  x={(editObj.x || 0) + pts[pi]} y={(editObj.y || 0) + pts[pi + 1]}
                  radius={5 / zoom} fill="#fff" stroke="#7c6aed" strokeWidth={2 / zoom}
                  hitStrokeWidth={20 / zoom}
                  draggable
                  onMouseDown={(e) => { e.cancelBubble = true }}
                  onTouchStart={(e) => { e.cancelBubble = true }}
                  onDragMove={(e) => {
                    const newPts = [...pts]
                    newPts[pi] = e.target.x() - (editObj.x || 0)
                    newPts[pi + 1] = e.target.y() - (editObj.y || 0)
                    updateObject(editObj.id, { points: newPts })
                  }} onDragEnd={() => pushUndo()} />
              )
            }
            return handles
          }
          return null
        })()}

        {/* Smart guide lines during drag */}
        {guides.map((g, i) => (
          <Line key={`guide-${i}`} name="__export_hide"
            points={g.x != null ? [g.x, g.from, g.x, g.to] : [g.from, g.y, g.to, g.y]}
            stroke="#ff3366" strokeWidth={1} dash={[6, 3]}
            listening={false} perfectDrawEnabled={false} />
        ))}

        {/* Per-child selection outlines when inside a group with multiple selections */}
        {enteredGroupId && selectedIds.length > 1 && activeTool === 'select' && selectedIds.map(sid => {
          const node = shapeRefs.current.get(sid)
          if (!node) return null
          const rect = node.getClientRect({ relativeTo: node.getLayer() })
          if (!rect || !rect.width) return null
          return (
            <Rect key={`sel-${sid}`}
              x={rect.x} y={rect.y} width={rect.width} height={rect.height}
              stroke="#a78bfa" strokeWidth={1.5} dash={[4, 3]}
              fill="transparent" listening={false} />
          )
        })}

        {activeTool === 'select' && !editingId && (
          <Transformer key="__tr__" ref={transformerRef} rotateEnabled={false}
            anchorSize={6} anchorCornerRadius={1}
            anchorStroke="#a78bfa" anchorFill="#fff"
            borderStroke="#a78bfa" borderStrokeWidth={1}
            // Round 7 DEFINITIVE: Konva 内置 rotater 完全禁用(rotateEnabled=false)。
            // 前 6 轮 anchorStyleFunc + forceUpdate 路线无解,Konva 内置 rotater 算法在
            // 非方形 box / transform 期间都有同步漏洞。改为同 Layer 渲染自定义 Konva Group
            // 作为 rotater(见 customRotater JSX + updateCustomRotaterPosition useCallback)。
            // 完全脱离 Konva Transformer 对 rotater 的内部处理。
            keepRatio={(() => {
              // Auto-mode text must keep ratio to avoid non-uniform stretch
              if (selectedIds.length !== 1) return false
              const objs = useUnifiedDesignStore.getState().objects
              let o = objs.find(o => o.id === selectedIds[0])
              if (!o) { for (const p of objs) { const c = p.children?.find(ch => ch.id === selectedIds[0]); if (c) { o = c; break } } }
              return o?.type === 'text' && o.textSizing !== 'fixed'
            })()}
            enabledAnchors={['top-left','top-center','top-right','middle-left','middle-right',
              'bottom-left','bottom-center','bottom-right']}
            onTransformStart={() => { isTransformingRef.current = true }}
            onTransformEnd={() => {
              isTransformingRef.current = false
              // Round 7:松手后立即同步自定义 rotater 到 transform 后新边角
              updateCustomRotaterPosition()
            }}
            onTransform={() => {
              const tr = transformerRef.current
              if (!tr) return
              const nodes = tr.nodes()
              if (nodes.length !== 1) return
              const node = nodes[0]
              const id = node.getAttr('data-id')
              const store = useUnifiedDesignStore.getState()
              let obj = store.objects.find(o => o.id === id)
              // Check group children too
              if (!obj) {
                for (const o of store.objects) {
                  const c = o.children?.find(ch => ch.id === id)
                  if (c) { obj = c; break }
                }
              }
              if (!obj) return
              // Fixed-text: resize bounding box, don't stretch
              if (obj.type === 'text' && obj.textSizing === 'fixed') {
                // NaN 兜底:scaleX/Y / width/height 来自 Konva transform,边界条件
                // 可能 NaN。Math.max(20, NaN)=NaN 会让 node.width(NaN) 污染 Konva
                const sx = safeNum(node.scaleX(), 1)
                const sy = safeNum(node.scaleY(), 1)
                const nw = safeNum(node.width(), obj.width || 100)
                const nh = safeNum(node.height(), obj.height || 40)
                const newW = Math.max(20, nw * Math.abs(sx))
                const newH = Math.max(20, nh * Math.abs(sy))
                if (Number.isFinite(newW) && Number.isFinite(newH)) {
                  node.width(newW)
                  node.height(newH)
                  node.scaleX(1)
                  node.scaleY(1)
                }
              }
              // Round 7:transform 期间每帧同步自定义 rotater 到 transform 中的新 box
              updateCustomRotaterPosition()
            }}
            boundBoxFunc={(old, nb) => {
              // 关键 NaN/Infinity 兜底:Math.abs(NaN)=NaN, NaN<5=false 直接透
              // 一旦 nb 任一字段非 finite,返回 old(Konva 自己也会拒收 NaN box)
              if (!isFiniteBox(nb)) return old
              if (Math.abs(nb.width) < 5 || Math.abs(nb.height) < 5) return old
              // Bug-3 (round 2): 旋转 box 的 nb.x/y/width/height 是 unrotated 坐标,
              // 跟屏幕坐标不在一个坐标系。强行 snap 会把 unrotated 原点拉到屏幕坐标
              // → 位置漂移 + 形变。所以:旋转过的 box 完全跳过 snap。
              const rotAngle = Math.abs(((nb.rotation || 0) % 360))
              if (rotAngle > 0.5 && rotAngle < 359.5) return nb
              // Bug-2 fix(round 3): 之前用 edge-change EPS=0.5 检测哪些边在动,
              // 但快速拖 + jittery 鼠标会让"未拖的边"被算成 changed → 多余 snap → 形状跳。
              // 改用 Konva.Transformer._movingAnchorName(内部 API 但 v10 稳定),
              // 它精确告诉我们用户当前拖哪个 anchor。从 anchor 名字硬推导哪些边在动:
              //   - top-* → top edge
              //   - bottom-* → bottom edge
              //   - *-left → left edge
              //   - *-right → right edge
              //   - top-center / bottom-center 只有一条边
              //   - 4 个 corner 是两条边同时拖
              // 这跟拖速 / 鼠标抖动无关,精确度 100%。
              const tr = transformerRef.current
              const anchor = tr?._movingAnchorName || ''
              const lChanged = anchor.includes('left')
              const rChanged = anchor.includes('right')
              const tChanged = anchor.startsWith('top')
              const bChanged = anchor.startsWith('bottom')
              // 任何边都没动(anchor 空/非法)→ 不 snap,直接返回 nb
              if (!lChanged && !rChanged && !tChanged && !bChanged) return nb
              // Snap edges to other objects, canvas, and grid during resize
              const store = useUnifiedDesignStore.getState()
              const selIds = new Set(store.selectedIds)
              const others = store.objects.filter(o => !selIds.has(o.id) && o.visible !== false && o.type !== 'canvas')
              const cw = store.canvasWidth, ch = store.canvasHeight
              const gl = store.gridType ? buildLayoutGrid(store, cw, ch) : { snapX: [], snapY: [] }
              const allX = [0, cw / 2, cw, ...gl.snapX]
              const allY = [0, ch / 2, ch, ...gl.snapY]
              for (const o of others) {
                const ox = o.x || 0, oy = o.y || 0, ow = o.width || 100, oh = o.height || 100
                allX.push(ox, ox + ow / 2, ox + ow)
                allY.push(oy, oy + oh / 2, oy + oh)
              }
              const S = SNAP_DIST
              const edges = { l: nb.x, r: nb.x + nb.width, t: nb.y, b: nb.y + nb.height }
              // Snap only edges the user is actually dragging (anchor-derived)
              for (const t of allX) {
                if (lChanged && Math.abs(edges.l - t) < S) { nb = { ...nb, width: nb.width + (nb.x - t), x: t } }
                else if (rChanged && Math.abs(edges.r - t) < S) { nb = { ...nb, width: t - nb.x } }
              }
              for (const t of allY) {
                if (tChanged && Math.abs(edges.t - t) < S) { nb = { ...nb, height: nb.height + (nb.y - t), y: t } }
                else if (bChanged && Math.abs(edges.b - t) < S) { nb = { ...nb, height: t - nb.y } }
              }
              // 出口再 sanitize:snap 过程改 nb.x/nb.width 时若 t 是 NaN(allX 里
              // 混入 NaN,虽然上面 cw/ch 兜底,但万一)也兜回 old
              if (!isFiniteBox(nb)) return old
              return nb
            }}
            ignoreStroke />
        )}

        {/* Round 7 DEFINITIVE: 自定义 rotater 渲染层(完全脱离 Konva 内置 rotater)。
            位置由 updateCustomRotaterPosition 命令式写入 customRotaterRef,
            初始 visible=false 避免闪屏(选中触发 useEffect 即刻显示)。
            Group 内 Circle 是命中区 + 视觉背景,Path 是 ↻ 图标。
            scale 通过 updateCustomRotaterPosition 设 1/stageScale 以保持屏幕 px 不变。
            Round 7.2(2026-06-02):hover 不改 cursor 形态(用户要求保持默认指针)。*/}
        {activeTool === 'select' && !editingId && (
          <Group
            ref={customRotaterRef}
            name="__custom_rotater"
            visible={false}
            listening
            onMouseDown={handleCustomRotaterMouseDown}
            onTouchStart={handleCustomRotaterMouseDown}
          >
            {/* 背景圆 */}
            <Circle x={0} y={0} radius={11} fill="#fff" stroke="#a78bfa" strokeWidth={1.5} />
            {/* ↻ 图标(简化 path:开口圆 + 箭头) */}
            <Path
              x={0} y={0}
              data="M -5 -1 A 5 5 0 1 1 -1 -5 L -3 -5 M -1 -5 L -1 -3"
              stroke="#7c6aed" strokeWidth={1.5} fill="" lineCap="round" lineJoin="round" listening={false}
            />
          </Group>
        )}

        {/* Corner radius drag handle — wrapped in a Group that mirrors the rect's
            position + rotation, so the handle follows rotated rects too (2026-06-03
            round-8 fix:before this we early-returned when obj.rotation !== 0 → handle
            silently disappeared for any rotated rect). Circle sits at the rect's local
            top-right inset; the outer Group applies obj.rotation around (ox, oy). */}
        {selectedIds.length === 1 && activeTool === 'select' && (() => {
          const objs = useUnifiedDesignStore.getState().objects
          const selId = selectedIds[0]
          let obj = objs.find(o => o.id === selId)
          let parentObj = null
          if (!obj) {
            for (const o of objs) {
              const c = o.children?.find(ch => ch.id === selId)
              if (c) { obj = c; parentObj = o; break }
            }
          }
          if (!obj || obj.type !== 'rect') return null
          const r = obj.cornerRadius || 0
          const w = obj.width || 100, h = obj.height || 100
          const maxR = Math.min(w, h) / 2
          const inset = 16 / zoom
          // Layer-space origin: parent offset + child offset.
          // NOTE: parent rotation is not yet propagated (edge case). For unrotated
          // parents this matches the original layout exactly.
          const ox = (parentObj ? (parentObj.x || 0) : 0) + (obj.x || 0)
          const oy = (parentObj ? (parentObj.y || 0) : 0) + (obj.y || 0)
          const rot = obj.rotation || 0
          const diagR = r * 0.707
          // Local coords inside the Group (rect's own coordinate system, origin at top-left):
          const lx = w - inset - diagR
          const ly = inset + diagR
          const applyCornerRadius = (newR) => {
            if (parentObj) {
              updateChild(parentObj.id, selId, { cornerRadius: Math.round(newR) })
            } else {
              updateObject(selId, { cornerRadius: Math.round(newR) })
            }
          }
          return (
            <Group key="__cr_handle_group" x={ox} y={oy} rotation={rot} listening>
              <Circle
                key="__cr_handle"
                x={lx} y={ly}
                radius={5 / zoom}
                fill="#fff" stroke="#7c6aed" strokeWidth={2 / zoom}
                draggable
                onMouseDown={(e) => e.cancelBubble = true}
                onDragMove={(e) => {
                  // Drag stays in the Group's LOCAL space — Konva applies the Group
                  // rotation to the pointer delta automatically, so the maths is
                  // identical to the pre-rotation case.
                  const dx = (w - inset) - e.target.x()
                  const dy = e.target.y() - inset
                  const diag = (dx + dy) / 2
                  const newR = Math.max(0, Math.min(maxR, diag / 0.707))
                  const newDiag = newR * 0.707
                  e.target.x(w - inset - newDiag)
                  e.target.y(inset + newDiag)
                  applyCornerRadius(newR)
                }}
                onDragStart={(e) => { e.cancelBubble = true; pushUndo() }}
                hitStrokeWidth={10 / zoom}
              />
            </Group>
          )
        })()}

        {/* Marquee selection rectangle */}
        {marquee && (
          <Rect key="__marquee__"
            x={Math.min(marquee.x1, marquee.x2)}
            y={Math.min(marquee.y1, marquee.y2)}
            width={Math.abs(marquee.x2 - marquee.x1)}
            height={Math.abs(marquee.y2 - marquee.y1)}
            fill="rgba(124,106,237,0.08)"
            stroke="#7c6aed"
            strokeWidth={1 / zoom}
            dash={[4 / zoom, 4 / zoom]}
            listening={false}
          />
        )}

        {/* Text drag-create preview */}
        {textDrawBox && (
          <Rect key="__text-draw-box__"
            x={Math.min(textDrawBox.x1, textDrawBox.x2)}
            y={Math.min(textDrawBox.y1, textDrawBox.y2)}
            width={Math.abs(textDrawBox.x2 - textDrawBox.x1)}
            height={Math.abs(textDrawBox.y2 - textDrawBox.y1)}
            fill="rgba(124,106,237,0.05)"
            stroke="#7c6aed"
            strokeWidth={1.5 / zoom}
            dash={[6 / zoom, 4 / zoom]}
            listening={false}
          />
        )}
      </Layer>
    </Stage>
  )
})

KonvaCanvas.displayName = 'KonvaCanvas'
export default KonvaCanvas
