/**
 * rebuildMotion.js — design → motion 完整重建(纯函数,2026-06-05 从 index.jsx 提取)
 *
 * 提取动机:预合成产物渲染(precompRender)在 Composer 关闭后、React 之外执行,
 * 需要"按最新 designState 重建 motion layers"的同一套逻辑。函数体逐字搬运
 * (原 useCallback deps = [],本来就是纯函数),index.jsx 改为 import 本模块。
 *
 * 完整行为契约见原注释(坐标系 round-15 全统一 / keyframes≥2 保留 / group 递归)。
 */

export function rebuildMotionFromDesign(currentMotion, designState) {
  if (!designState?.objects?.length) {
    return currentMotion ? { ...currentMotion, layers: [] } : null
  }

  // 收集已有 layer 按 sourceId 索引(递归)
  const existing = new Map()
  const collect = (layers) => {
    if (!Array.isArray(layers)) return
    for (const l of layers) {
      if (l.sourceId) existing.set(l.sourceId, l)
      if (l.children) collect(l.children)
    }
  }
  collect(currentMotion?.layers)

  // 2026-06-03 cornerRadius 加入(rect 圆角可 K 动画)— 让 keyframes ≥ 2 时
  // motion base 保留(不被 design 端覆盖)。
  const ANIM_DEFAULTS = { x: 0, y: 0, opacity: 1, rotation: 0, scaleX: 1, scaleY: 1, cornerRadius: 0 }
  // rect-only 动画字段:非 rect layer 不写 init kf,避免污染 keyframes 对象 +
  // Timeline activeProps filter 的 ≥2 kf 阈值判定不受影响。
  const ANIM_RECT_ONLY = new Set(['cornerRadius'])
  const isPropEligible = (prop, layerType) => !ANIM_RECT_ONLY.has(prop) || layerType === 'rect'
  const duration = currentMotion?.duration || 5

  /**
   * 2026-06-03 round-15 坐标系全统一(扩展 round 14 ellipse 协议):
   *  motion renderer 普通 shape 用 `cx = p.x + bw/2` 当几何中心,且 drawShape 把所有
   *  shape 画在 (0,0) 为几何中心。这只适用于 base.x/y = top-left + base.w/h = 真几何 的 type。
   *
   *  designer 各 type 的坐标语义(看 KonvaCanvas.jsx renderShape + tool drag L1517~1554):
   *    - rect / image / video / canvas:obj.x/y = top-left,obj.w/h = 真宽高 ✅ 无需修
   *    - text:obj.x/y = top-left,obj.w/h = 0(measureText 算)✅ 无需修(renderer 用 textSize)
   *    - **ellipse**:obj.x/y = **center**,radiusX/Y 半径,obj.w/h = 0 → round 14 修
   *    - **star / polygon / gear**:obj.x/y = **center**,outerRadius/radius 外接,
   *      obj.w/h = 2*outerRadius(tool 拖拽 L1530/1534/1539 写入)→ 本轮修
   *    - **line**:obj.x/y = 起点,obj.w/h = 0,points = [0,0,lx,ly] → 本轮修
   *    - **pen**:obj.x/y = 0,obj.w/h = 0,penNodes 在 local top-left 系 → 本轮修
   *    - **path** (svg import):obj.x/y = top-left placement,obj.w/h = viewBox 缩放后 — 看起来对,
   *      但要确认 path data 是 viewBox 原始坐标,scaleX/Y 已乘缩放 → ✅ 无需修
   *
   *  修法统一:把"中心 + 半径"或"无 bbox 的几何"转成"left-top + width/height = 真几何":
   *    base.x = realLeft, base.y = realTop, base.width = realWidth, base.height = realHeight
   *  这样 cx = base.x + width/2 = 真几何中心,跟 designer 渲染对齐。
   *  computeGeometryHalfSize 会用 base.w/h 当 hw/hh 默认,所以 bbox = base box,贴边。
   *
   *  注意:keyframes.x/y 的 init kf 也要走 normalized 值(用 designProps 而非 designObj),
   *  否则 base.x 是 corner 但 kfs.x[0].v 是 center → 二者错位。
   */
  // 跟 designer/KonvaCanvas.jsx penNodesToPathD 同步:把 penNodes 序列化成 SVG path d。
  // pen 修正 base.width/height 时,penNodes 平移了,data 也得跟着重 serialize(motion drawShape
  // L477 只读 b.data,b.data 不更新就还是用旧坐标 → bbox 跟 path 错位)。
  const penNodesToD = (nodes) => {
    if (!Array.isArray(nodes) || nodes.length === 0) return ''
    let d = `M ${nodes[0].x} ${nodes[0].y}`
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1]
      const cur = nodes[i]
      const cp1x = prev.cx2 ?? prev.x
      const cp1y = prev.cy2 ?? prev.y
      const cp2x = cur.cx1 ?? cur.x
      const cp2y = cur.cy1 ?? cur.y
      d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${cur.x} ${cur.y}`
    }
    return d
  }

  const normalizeShapeCoords = (designObj) => {
    const x = designObj.x || 0
    const y = designObj.y || 0
    const w = designObj.width
    const h = designObj.height
    const passthrough = { x, y, width: w, height: h }

    switch (designObj.type) {
      case 'ellipse': {
        // x/y = center; radiusX/Y = 半径
        const rx = designObj.radiusX || (w || 100) / 2
        const ry = designObj.radiusY || (h || 100) / 2
        return { x: x - rx, y: y - ry, width: rx * 2, height: ry * 2 }
      }
      case 'star':
      case 'gear': {
        // x/y = center; outerRadius = 外接圆半径
        const r = designObj.outerRadius || Math.min(w || 100, h || 100) / 2
        return { x: x - r, y: y - r, width: r * 2, height: r * 2 }
      }
      case 'polygon': {
        // x/y = center; radius = 外接圆半径
        const r = designObj.radius || Math.min(w || 100, h || 100) / 2
        return { x: x - r, y: y - r, width: r * 2, height: r * 2 }
      }
      case 'line': {
        // x/y = layer 起点;points = [x1,y1,x2,y2] 相对坐标
        // drawShape line:`b.points[i] - hw` 假定 (0,0) = layer 几何中心,所以新 points 必须
        // 减掉 (minLX, minLY)(让左上 = 0,0),配合新 width = maxLX - minLX。
        const pts = Array.isArray(designObj.points) ? designObj.points : []
        if (pts.length >= 4) {
          const minLX = Math.min(pts[0], pts[2])
          const maxLX = Math.max(pts[0], pts[2])
          const minLY = Math.min(pts[1], pts[3])
          const maxLY = Math.max(pts[1], pts[3])
          const w2 = maxLX - minLX
          const h2 = maxLY - minLY
          if (w2 > 0 || h2 > 0) {
            return {
              x: x + minLX,
              y: y + minLY,
              width: Math.max(w2, 1),
              height: Math.max(h2, 1),
              // 新 points: 相对新 base 左上(0,0)
              points: [pts[0] - minLX, pts[1] - minLY, pts[2] - minLX, pts[3] - minLY],
            }
          }
        }
        return passthrough
      }
      case 'pen': {
        // x/y = 0;penNodes 在 local top-left 系(原点 = 0,0)。bbox = penNodes 极值。
        // pen drawShape 用 b.data(serialize 过的 SVG path)+ translate(-hw, -hh) 画到几何中心。
        // 修后 base.width = maxX - minX,几何中心 = (bw/2, bh/2)。但 path data 还是原始坐标,
        // 假定 (0,0) = 局部原点。需要让 data 也偏移 -minX/-minY,让原始 (minX, minY) → (0,0),
        // 几何中心 = (bw/2, bh/2)。同时 base.x 加 minX(把 layer 原点平移到极值起点)。
        const nodes = Array.isArray(designObj.penNodes) ? designObj.penNodes : []
        if (nodes.length) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const n of nodes) {
            if (!n) continue
            const xs = [n.x, n.cx1, n.cx2].filter(v => typeof v === 'number')
            const ys = [n.y, n.cy1, n.cy2].filter(v => typeof v === 'number')
            for (const xv of xs) { if (xv < minX) minX = xv; if (xv > maxX) maxX = xv }
            for (const yv of ys) { if (yv < minY) minY = yv; if (yv > maxY) maxY = yv }
          }
          if (isFinite(minX) && (maxX > minX || maxY > minY)) {
            // 平移 penNodes 让 (minX, minY) → (0, 0)
            const shiftedNodes = nodes.map((n) => {
              if (!n) return n
              const out = { ...n }
              if (typeof n.x === 'number') out.x = n.x - minX
              if (typeof n.y === 'number') out.y = n.y - minY
              if (typeof n.cx1 === 'number') out.cx1 = n.cx1 - minX
              if (typeof n.cy1 === 'number') out.cy1 = n.cy1 - minY
              if (typeof n.cx2 === 'number') out.cx2 = n.cx2 - minX
              if (typeof n.cy2 === 'number') out.cy2 = n.cy2 - minY
              return out
            })
            return {
              x: x + minX,
              y: y + minY,
              width: maxX - minX,
              height: maxY - minY,
              penNodes: shiftedNodes,
              // data 字符串无法机械平移(里面是 M/L/C 绝对/相对混杂)。下面会清掉让 renderer
              // 回退到 penNodes 重 serialize(motion 的 drawShape 只用 b.data,但 pen 创建时
              // 写的 data 是 penNodesToPathD(nodes) — 既然 penNodes 平移了,data 也要重算)。
              // inline penNodesToD(同步 designer/KonvaCanvas penNodesToPathD)
              data: penNodesToD(shiftedNodes),
            }
          }
        }
        return passthrough
      }
      default:
        // rect / image / video / canvas / text / path / group / mask:保持原样
        return passthrough
    }
  }

  const buildOrSync = (designObj) => {
    if (designObj.type === 'canvas') return null
    const existed = existing.get(designObj.id)
    // 剥离 design 的 children/id,只把扁平字段写进 base
    const { children: _designChildren, id: _designId, ...designProps } = designObj
    // 坐标系适配:designer center/起点/local0 → motion top-left + width/height = 真几何
    // 仅在 norm.width > 0 时覆写(避免误改 rect/image/video/text/path/group/mask 已正确的字段)
    const norm = normalizeShapeCoords(designObj)
    if (norm.width > 0 && norm.height > 0 && (
      designObj.type === 'ellipse' || designObj.type === 'star' ||
      designObj.type === 'polygon' || designObj.type === 'gear' ||
      designObj.type === 'line' || designObj.type === 'pen'
    )) {
      designProps.x = norm.x
      designProps.y = norm.y
      designProps.width = norm.width
      designProps.height = norm.height
      // line / pen 还要把 points / penNodes / data 平移到新 base 局部系
      if (norm.points) designProps.points = norm.points
      if (norm.penNodes) designProps.penNodes = norm.penNodes
      if (norm.data) designProps.data = norm.data
    }

    let layer
    if (existed) {
      // ── 同步已有 layer ──
      let newBase = { ...existed.base, ...designProps }
      let newKfs = existed.keyframes || {}

      // 动画字段:keyframes ≥ 2 保留(动画化中);否则用 design 最新值
      // ellipse/star/polygon/gear/line/pen 的 x/y 已被 normalizeShapeCoords 转 top-left
      // 写入 designProps,优先读 designProps(不要回去读 designObj)
      for (const prop of Object.keys(ANIM_DEFAULTS)) {
        if (!isPropEligible(prop, designObj.type)) continue
        const kfs = newKfs?.[prop] || []
        if (kfs.length >= 2) {
          // 保留 motion base(动画化中,不被 design 覆盖)
          newBase[prop] = existed.base?.[prop] ?? ANIM_DEFAULTS[prop]
        } else {
          // 重写 init kf to design 最新值(用 designProps 而非 designObj,拿 normalized x/y)
          const v = designProps[prop] ?? ANIM_DEFAULTS[prop]
          newKfs = { ...newKfs, [prop]: [{ t: 0, v, easing: 'easeOut' }] }
          newBase[prop] = v
        }
      }

      layer = {
        ...existed,
        sourceId: designObj.id,
        type: designObj.type,
        name: designObj.text?.slice(0, 12) || existed.name || designObj.type,
        base: newBase,
        keyframes: newKfs,
        visible: designObj.visible !== false,
        locked: !!designObj.locked,
      }
    } else {
      // ── 新建 layer ──
      // ellipse/star/polygon/gear/line/pen 的 x/y 已被 normalizeShapeCoords 转 top-left
      // 写入 designProps,优先读 designProps
      const initKf = {}
      for (const [prop, def] of Object.entries(ANIM_DEFAULTS)) {
        if (!isPropEligible(prop, designObj.type)) continue
        const val = designProps[prop] ?? def
        initKf[prop] = [{ t: 0, v: val, easing: 'easeOut' }]
      }
      layer = {
        id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sourceId: designObj.id,
        name: designObj.text?.slice(0, 12) || designObj.type,
        type: designObj.type,
        base: { ...designProps },
        inPoint: 0, outPoint: duration,
        keyframes: initKf,
        presets: { enter: null, continuous: null, exit: null },
        visible: designObj.visible !== false,
        locked: !!designObj.locked,
      }
    }

    // group/mask:递归 children
    if ((designObj.type === 'group' || designObj.type === 'mask') && Array.isArray(designObj.children) && designObj.children.length) {
      layer.children = designObj.children.map(buildOrSync).filter(Boolean)
    } else {
      // design 改了不再是 group / 去掉了 children → 清掉
      if (layer.children) layer.children = undefined
    }

    return layer
  }

  const newLayers = designState.objects.map(buildOrSync).filter(Boolean)

  // 同步画布尺寸 + 背景
  return {
    ...(currentMotion || { v: 2, duration, fps: 30, playhead: 0, selectedLayerId: null }),
    v: 2,
    layers: newLayers,
    canvasWidth: designState.canvasWidth || currentMotion?.canvasWidth || 1920,
    canvasHeight: designState.canvasHeight || currentMotion?.canvasHeight || 1080,
    backgroundColor: designState.backgroundColor || currentMotion?.backgroundColor || 'transparent',
  }
}
