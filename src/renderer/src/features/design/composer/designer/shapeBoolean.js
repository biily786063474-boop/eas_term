/**
 * Shape boolean operations — Pathfinder-style (Illustrator)
 *
 * Phase 1 MVP — uses polygon-clipping library for robust polygon boolean ops.
 * Each Konva object is converted to a flat polygon (multi-poly) in WORLD coordinates,
 * the boolean op is applied, then the result is converted back to an SVG path d string
 * that can be rendered as a new node.type='path' object.
 *
 * Coordinate system (verified against KonvaCanvas render at L370-435):
 *   rect       — x,y = top-left;  uses width/height
 *   ellipse    — x,y = CENTER;    uses radiusX (fb w/2) / radiusY (fb h/2)
 *   star       — x,y = CENTER;    uses outerRadius / innerRadius / numPoints
 *   polygon    — x,y = CENTER;    uses radius (fb min(w,h)/2) / sides
 *   path       — x,y = origin OFFSET (d is relative to 0,0); fillRule
 *   pen        — x,y = origin OFFSET (penNodes relative to 0,0); fallback d
 *
 * Transform application order (matches Konva): rotation around (x,y) → scale around (x,y).
 * Group/mask/text/image/canvas/line/gear NOT supported in Phase 1 (return null).
 *
 * polygon-clipping v0.15.7 API:
 *   union(...polyA, polyB)        — multi-poly union
 *   intersection(polyA, polyB)    — multi-poly intersection
 *   difference(polyA, polyB, ...) — first poly minus all subsequent
 *   xor(polyA, polyB)             — symmetric difference
 * Input/output: multi-poly = [poly1, poly2, ...]; each poly = [outerRing, hole1, ...];
 *   each ring = [[x,y], [x,y], ..., [x0,y0]] (closed; first point == last).
 */

import polygonClipping from 'polygon-clipping'

/* ── Types that support boolean ops ── */
export const BOOLEAN_SUPPORTED_TYPES = new Set([
  'rect', 'ellipse', 'polygon', 'star', 'path', 'pen',
])

/* ── Approximation sample counts ── */
const ELLIPSE_SAMPLES = 32
const PATH_BEZIER_SAMPLES = 16

/* ── Apply rotation + scale around object origin, then translate ── */
function transformPoint(lx, ly, sx, sy, sin, cos, ox, oy) {
  // Konva transform: translate(x,y) → rotate(rotation) → scale(scaleX, scaleY)
  // So local point (lx, ly) becomes:
  //   sx_pt = lx * scaleX, sy_pt = ly * scaleY
  //   rx = sx_pt*cos - sy_pt*sin
  //   ry = sx_pt*sin + sy_pt*cos
  //   world = (ox + rx, oy + ry)
  const sxPt = lx * sx
  const syPt = ly * sy
  return [
    ox + sxPt * cos - syPt * sin,
    oy + sxPt * sin + syPt * cos,
  ]
}

/* ── Build a local-coordinate ring for each shape type ──
   Returns array of [lx, ly] points (NOT closed; closing handled later). */
function buildLocalRing(obj) {
  const t = obj.type
  if (t === 'rect') {
    const w = obj.width || 100, h = obj.height || 100
    // rect x,y = top-left → local origin is at (0,0)
    return [[0, 0], [w, 0], [w, h], [0, h]]
  }
  if (t === 'ellipse') {
    const rx = obj.radiusX ?? (obj.width || 100) / 2
    const ry = obj.radiusY ?? (obj.height || 100) / 2
    // x,y = center → local origin is at (0,0) = center
    const pts = []
    for (let i = 0; i < ELLIPSE_SAMPLES; i++) {
      const a = (i / ELLIPSE_SAMPLES) * Math.PI * 2
      pts.push([Math.cos(a) * rx, Math.sin(a) * ry])
    }
    return pts
  }
  if (t === 'star') {
    const np = obj.numPoints || 5
    const outerR = obj.outerRadius || (Math.min(obj.width || 100, obj.height || 100) / 2)
    const innerR = obj.innerRadius || (outerR * 0.4)
    const pts = []
    // KonvaStar: first point at top (angle -π/2)
    for (let i = 0; i < np * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR
      const a = (i * Math.PI / np) - Math.PI / 2
      pts.push([Math.cos(a) * r, Math.sin(a) * r])
    }
    return pts
  }
  if (t === 'polygon') {
    const sides = obj.sides || 6
    const radius = obj.radius || (Math.min(obj.width || 100, obj.height || 100) / 2)
    const pts = []
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i / sides) - Math.PI / 2
      pts.push([Math.cos(a) * radius, Math.sin(a) * radius])
    }
    return pts
  }
  // path / pen — handled separately (multi-subpath possible)
  return null
}

/* ── Parse SVG path d into array of subpath rings (each = [[x,y], ...]). ──
   Supports M / m / L / l / H / h / V / v / Q / q / C / c / Z / z.
   Q/C are sampled at PATH_BEZIER_SAMPLES points per segment.
   Other commands (A/T/S) fall back to endpoint-only (lossy but won't crash). */
function parsePathDToRings(d) {
  if (!d || typeof d !== 'string') return []
  // Tokenize: command letter or number
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[+-]?\d+)?/gi) || []
  const rings = []
  let cur = null   // current ring being built
  let cx = 0, cy = 0   // current point (absolute)
  let startX = 0, startY = 0   // last M start (for Z closure)

  let i = 0
  let lastCmd = null
  const num = () => parseFloat(tokens[i++])
  const hasNum = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i])

  const start = (x, y) => {
    if (cur && cur.length >= 3) rings.push(cur)
    cur = [[x, y]]
    cx = x; cy = y; startX = x; startY = y
  }
  const lineTo = (x, y) => {
    if (!cur) cur = [[cx, cy]]
    cur.push([x, y])
    cx = x; cy = y
  }
  const sampleQ = (cpX, cpY, x, y) => {
    const x0 = cx, y0 = cy
    for (let k = 1; k <= PATH_BEZIER_SAMPLES; k++) {
      const t = k / PATH_BEZIER_SAMPLES
      const it = 1 - t
      const bx = it * it * x0 + 2 * it * t * cpX + t * t * x
      const by = it * it * y0 + 2 * it * t * cpY + t * t * y
      lineTo(bx, by)
    }
  }
  const sampleC = (cp1x, cp1y, cp2x, cp2y, x, y) => {
    const x0 = cx, y0 = cy
    for (let k = 1; k <= PATH_BEZIER_SAMPLES; k++) {
      const t = k / PATH_BEZIER_SAMPLES
      const it = 1 - t
      const bx = it * it * it * x0 + 3 * it * it * t * cp1x + 3 * it * t * t * cp2x + t * t * t * x
      const by = it * it * it * y0 + 3 * it * it * t * cp1y + 3 * it * t * t * cp2y + t * t * t * y
      lineTo(bx, by)
    }
  }

  while (i < tokens.length) {
    const tk = tokens[i]
    let cmd = /[a-zA-Z]/.test(tk) ? tokens[i++] : (lastCmd || 'L')
    // After M/m the implicit continuation is L/l
    const implicit = cmd === 'M' ? 'L' : (cmd === 'm' ? 'l' : cmd)

    switch (cmd) {
      case 'M': { start(num(), num()); lastCmd = 'M'; while (hasNum()) { lineTo(num(), num()); } break }
      case 'm': { start(cx + num(), cy + num()); lastCmd = 'm'; while (hasNum()) { lineTo(cx + num(), cy + num()); } break }
      case 'L': { while (hasNum()) lineTo(num(), num()); lastCmd = 'L'; break }
      case 'l': { while (hasNum()) lineTo(cx + num(), cy + num()); lastCmd = 'l'; break }
      case 'H': { while (hasNum()) lineTo(num(), cy); lastCmd = 'H'; break }
      case 'h': { while (hasNum()) lineTo(cx + num(), cy); lastCmd = 'h'; break }
      case 'V': { while (hasNum()) lineTo(cx, num()); lastCmd = 'V'; break }
      case 'v': { while (hasNum()) lineTo(cx, cy + num()); lastCmd = 'v'; break }
      case 'Q': { while (hasNum()) { const a = num(), b = num(), x = num(), y = num(); sampleQ(a, b, x, y) } lastCmd = 'Q'; break }
      case 'q': { while (hasNum()) { const a = cx + num(), b = cy + num(), x = cx + num(), y = cy + num(); sampleQ(a, b, x, y) } lastCmd = 'q'; break }
      case 'C': { while (hasNum()) { const a = num(), b = num(), c = num(), d2 = num(), x = num(), y = num(); sampleC(a, b, c, d2, x, y) } lastCmd = 'C'; break }
      case 'c': { while (hasNum()) { const a = cx + num(), b = cy + num(), c = cx + num(), d2 = cy + num(), x = cx + num(), y = cy + num(); sampleC(a, b, c, d2, x, y) } lastCmd = 'c'; break }
      case 'Z':
      case 'z': {
        if (cur && cur.length >= 2) {
          // Close subpath: ensure last point equals start
          const last = cur[cur.length - 1]
          if (last[0] !== startX || last[1] !== startY) cur.push([startX, startY])
          rings.push(cur)
          cur = null
        }
        cx = startX; cy = startY
        lastCmd = cmd
        break
      }
      default: {
        // Unknown / unsupported (A, S, T) — best effort: skip pairs to recover
        while (hasNum()) i++
        lastCmd = implicit
        break
      }
    }
  }
  if (cur && cur.length >= 3) rings.push(cur)
  return rings
}

/* ── Pen nodes → ring sampling (uses Bezier sampling). ── */
function penNodesToRings(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 2) return []
  const ring = []
  ring.push([nodes[0].x, nodes[0].y])
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1], cur = nodes[i]
    const cp1x = prev.cx2 ?? prev.x, cp1y = prev.cy2 ?? prev.y
    const cp2x = cur.cx1 ?? cur.x, cp2y = cur.cy1 ?? cur.y
    const x0 = ring[ring.length - 1][0], y0 = ring[ring.length - 1][1]
    for (let k = 1; k <= PATH_BEZIER_SAMPLES; k++) {
      const t = k / PATH_BEZIER_SAMPLES
      const it = 1 - t
      const bx = it * it * it * x0 + 3 * it * it * t * cp1x + 3 * it * t * t * cp2x + t * t * t * cur.x
      const by = it * it * it * y0 + 3 * it * it * t * cp1y + 3 * it * t * t * cp2y + t * t * t * cur.y
      ring.push([bx, by])
    }
  }
  return [ring]
}

/* ── Ensure a ring is closed (first point == last point) ── */
function closeRing(ring) {
  if (ring.length < 3) return ring
  const a = ring[0], b = ring[ring.length - 1]
  if (a[0] === b[0] && a[1] === b[1]) return ring
  return [...ring, [a[0], a[1]]]
}

/**
 * Convert a Konva object to a polygon-clipping geometry (multi-poly).
 * Returns: [[[outerRing], [hole?], ...], ...]  or null if unsupported.
 *
 * Applies obj.x / obj.y / obj.rotation / obj.scaleX / obj.scaleY.
 */
export function shapeToPolygon(obj) {
  if (!obj || !BOOLEAN_SUPPORTED_TYPES.has(obj.type)) return null

  const ox = obj.x || 0
  const oy = obj.y || 0
  const rotDeg = obj.rotation || 0
  const rotRad = (rotDeg * Math.PI) / 180
  const sx = obj.scaleX ?? 1
  const sy = obj.scaleY ?? 1
  const cos = Math.cos(rotRad)
  const sin = Math.sin(rotRad)

  let localRings = null
  if (obj.type === 'path') {
    localRings = parsePathDToRings(obj.data || '')
  } else if (obj.type === 'pen') {
    if (obj.penNodes?.length) localRings = penNodesToRings(obj.penNodes)
    else if (obj.data) localRings = parsePathDToRings(obj.data)
  } else {
    const r = buildLocalRing(obj)
    localRings = r ? [r] : null
  }

  if (!localRings || !localRings.length) return null

  // Apply transform to each point of each ring, then close.
  const worldRings = localRings
    .map(ring => ring.map(([lx, ly]) => transformPoint(lx, ly, sx, sy, sin, cos, ox, oy)))
    .map(closeRing)
    .filter(r => r.length >= 4)   // need ≥3 distinct + 1 closing

  if (!worldRings.length) return null

  // For simple shapes (rect/ellipse/star/polygon) we have a single outer ring.
  // For paths we treat the first ring as outer and additional rings as either
  // separate polys or holes. Heuristic: first ring is poly1's outer; each
  // subsequent ring tested for containment within poly1 → hole; else new poly.
  // To keep things robust for Phase 1 we treat each ring as its OWN polygon
  // (polygon-clipping union later flattens). Holes from compound paths would
  // need PIP testing; we skip for now and let polygon-clipping's XOR
  // semantics handle simple cases via fillRule=evenodd implicitly.
  const polys = worldRings.map(ring => [ring])
  return polys
}

/* ── Convert polygon-clipping multi-poly back to SVG path d string. ── */
export function polygonToPathD(multiPoly) {
  if (!multiPoly || !multiPoly.length) return ''
  const parts = []
  for (const poly of multiPoly) {
    for (const ring of poly) {
      if (!ring.length) continue
      const moves = [`M ${ring[0][0].toFixed(2)} ${ring[0][1].toFixed(2)}`]
      for (let i = 1; i < ring.length; i++) {
        moves.push(`L ${ring[i][0].toFixed(2)} ${ring[i][1].toFixed(2)}`)
      }
      moves.push('Z')
      parts.push(moves.join(' '))
    }
  }
  return parts.join(' ')
}

/* ── 4 Pathfinder operations ── */

/**
 * Unite — union of all selected shapes.
 * @param {Object[]} shapes — objects in selection order (any order works)
 * @returns {number[][][][]} multi-poly
 */
export function unite(shapes) {
  const polys = shapes.map(shapeToPolygon).filter(Boolean)
  if (polys.length === 0) throw new Error('无可运算的形状')
  if (polys.length === 1) return polys[0]
  return polygonClipping.union(...polys)
}

/**
 * Intersect — intersection of all selected shapes (only area shared by ALL).
 * @param {Object[]} shapes
 */
export function intersect(shapes) {
  const polys = shapes.map(shapeToPolygon).filter(Boolean)
  if (polys.length < 2) throw new Error('交集需要 2 个以上形状')
  return polygonClipping.intersection(polys[0], ...polys.slice(1))
}

/**
 * Subtract — bottom minus union of all others (Illustrator "Minus Front" semantics).
 *   - `bottom` = the BOTTOM-most object in z-order (objects array order: first = bottom)
 *   - `others` = the rest (cut out from bottom)
 * @param {Object} bottom
 * @param {Object[]} others
 */
export function subtract(bottom, others) {
  const bp = shapeToPolygon(bottom)
  if (!bp) throw new Error('底层形状不支持')
  const op = others.map(shapeToPolygon).filter(Boolean)
  if (op.length === 0) throw new Error('需要至少 1 个上层形状用于切除')
  return polygonClipping.difference(bp, ...op)
}

/**
 * Exclude — symmetric difference (XOR): areas covered by an ODD number of shapes.
 * @param {Object[]} shapes
 */
export function exclude(shapes) {
  const polys = shapes.map(shapeToPolygon).filter(Boolean)
  if (polys.length < 2) throw new Error('异或需要 2 个以上形状')
  let result = polys[0]
  for (let i = 1; i < polys.length; i++) {
    result = polygonClipping.xor(result, polys[i])
  }
  return result
}

/* ── Compute approximate bounding box of a multi-poly. Useful for new object placement. ── */
export function multiPolyBBox(multiPoly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of multiPoly) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
