/**
 * Primitive shape → penNodes converters.
 *
 * Used by KonvaCanvas.handleStageDblClick (Phase 1 #5 extension) so that
 * double-clicking an ellipse / rect / polygon / star directly enters anchor
 * edit mode — same UX as path → pen, but for primitives.
 *
 * Output contract:
 *   { penNodes: [...], closed: true, dx?: number, dy?: number }
 *   - penNodes are in **local** coordinates relative to the pen object's
 *     own (x, y) origin.
 *   - closed=true → caller should append " Z" to the SVG path d-string and
 *     set obj.closed=true. The anchor-edit UI (KonvaCanvas L2445-2456) infers
 *     closure from first/last anchor coincidence (<0.5px), so we emit a
 *     duplicate closing node = first node.
 *   - dx / dy are an optional **delta** the caller should add to obj.x / obj.y.
 *     This is needed for rect when we want the pen origin to stay at the rect's
 *     top-left (dx=dy=0). For ellipse / star / polygon, we keep dx=dy=0 and
 *     emit penNodes in **center-relative** coords (range -r..r) so the pen
 *     rotation pivot stays at the shape's visual center (matches Konva's
 *     Ellipse / RegularPolygon / Star semantics — they are center-pivoted).
 *
 * Coordinate-system notes (verified against KonvaCanvas L375-430):
 *   - Konva.Rect           : origin = top-left (obj.x, obj.y is top-left corner)
 *   - Konva.Ellipse        : origin = center    (obj.x, obj.y is center)
 *   - Konva.RegularPolygon : origin = center    (obj.x, obj.y is center)
 *   - Konva.Star           : origin = center    (obj.x, obj.y is center)
 *   - Konva.Path (pen)     : origin = top-left  (obj.x, obj.y is local 0,0,
 *                             path coords go from there)
 *
 *   → For rect→pen, keep obj.x/y unchanged, emit penNodes in [0..w, 0..h].
 *   → For ellipse/star/polygon→pen, keep obj.x/y as the CENTER point and
 *     emit penNodes in negative-half coords (e.g. -rx..rx, -ry..ry). This
 *     way the visual extent AND rotation/scale pivot stay identical to the
 *     original primitive. No obj.x/y mutation required.
 */

// Cubic-bezier control-point ratio that approximates a quarter circle.
// Derivation: for a unit circle, the magic constant k = (4/3) * tan(π/8)
//             = (4/3) * (√2 - 1)
//             ≈ 0.5522847498307933
// This is the canonical value used everywhere from PostScript to Adobe
// Illustrator / Figma for "draw a circle with 4 cubic bezier segments".
// Per Stanislaw K. Dehnel (1990) and verified by W3C SVG Authoring Guide.
// Max radial error ≈ 0.027% — visually indistinguishable from a true circle.
export const KAPPA = 0.5522847498307933

/**
 * Ellipse → 4-anchor symmetric cubic-bezier loop.
 *
 * The penNodes coordinate system has its origin at the ellipse's center
 * (matches Konva.Ellipse's center-pivoted semantics), so anchors are
 * placed at the 4 cardinal extremes of the ellipse:
 *   - top    : (0, -ry)
 *   - right  : (+rx, 0)
 *   - bottom : (0, +ry)
 *   - left   : (-rx, 0)
 *
 * Handle lengths = rx * KAPPA on horizontal handles, ry * KAPPA on vertical.
 * Convention (from penNodesToPathD):
 *   - cx1/cy1 = incoming handle (from previous anchor)
 *   - cx2/cy2 = outgoing handle (toward next anchor)
 *
 * Closure: emit a 5th node = clone of the first. The anchor-edit UI checks
 * Math.hypot(first - last) < 0.5 to recognize the closed-loop convention.
 *
 * @param {object} obj  shape object (must have type='ellipse')
 * @returns {{ penNodes: Array, closed: boolean }}
 */
export function ellipseToPenNodes(obj) {
  // Field resolution: ellipse may store radiusX/radiusY directly, OR fall back
  // to width/height (KonvaCanvas L377-378 uses the same precedence chain).
  const rx = obj.radiusX ?? (obj.width || 100) / 2
  const ry = obj.radiusY ?? (obj.height || 100) / 2

  const hx = rx * KAPPA  // horizontal handle length
  const vy = ry * KAPPA  // vertical handle length

  // Walking clockwise from top: top → right → bottom → left → top
  // For each anchor, cx1/cy1 points "backward" along the curve, cx2/cy2 points
  // "forward". For a circle/ellipse all handles are tangent to the curve.
  const top    = { x:   0, y: -ry, cx1: -hx, cy1: -ry, cx2:  hx, cy2: -ry }
  const right  = { x:  rx, y:   0, cx1:  rx, cy1: -vy, cx2:  rx, cy2:  vy }
  const bottom = { x:   0, y:  ry, cx1:  hx, cy1:  ry, cx2: -hx, cy2:  ry }
  const left   = { x: -rx, y:   0, cx1: -rx, cy1:  vy, cx2: -rx, cy2: -vy }

  // Closing duplicate of the first anchor — required so penNodesToPathD emits
  // a final 'C' curve back to the start (the trailing ' Z' alone would draw a
  // straight line, breaking smoothness on the closing segment).
  const closing = { ...top }

  return {
    penNodes: [top, right, bottom, left, closing],
    closed: true,
  }
}

/**
 * Rect → 4-anchor (or 8-anchor if cornerRadius) corner loop.
 *
 * No KAPPA needed for square corners — emit corner anchors only (cx1/cx2 left
 * undefined). penNodes are in top-left-relative coords [0..w, 0..h] (matches
 * Konva.Rect's top-left-pivoted semantics, so obj.x/y stays unchanged and the
 * rotation pivot is preserved).
 *
 * cornerRadius > 0 case (Phase 1 supported): 8 anchors with KAPPA bezier
 * handles on the corner curves (top-left, top-right, bottom-right, bottom-left
 * each split into 2 anchors connected by a quarter-circle curve).
 *
 * @param {object} obj  shape object (must have type='rect')
 * @returns {{ penNodes: Array, closed: boolean }}
 */
export function rectToPenNodes(obj) {
  const w = obj.width || 100
  const h = obj.height || 100
  const r = Math.max(0, Math.min(obj.cornerRadius || 0, Math.min(w, h) / 2))

  // No corner radius → 4 plain corner anchors, closed.
  if (r === 0) {
    const tl = { x: 0, y: 0 }
    const tr = { x: w, y: 0 }
    const br = { x: w, y: h }
    const bl = { x: 0, y: h }
    return {
      penNodes: [tl, tr, br, bl, { ...tl }],
      closed: true,
    }
  }

  // Corner radius > 0 → 8 anchors. For each corner we emit 2 anchors at the
  // points where the straight edge meets the rounded corner; the curve between
  // them is a quarter-circle approximated by KAPPA.
  const k = r * KAPPA

  // Convention for penNodesToPathD (verified KonvaCanvas L240-254):
  //   segment prev→cur uses prev.cx2/cy2 as outgoing control and cur.cx1/cy1
  //   as incoming control; if either is missing it falls back to the anchor
  //   itself, which degenerates the cubic into a straight line.
  //
  // → Straight edges: leave the "outgoing cx2 of edge-start" AND "incoming
  //   cx1 of edge-end" both undefined.
  // → Corner curves: set "outgoing cx2 of curve-start" + "incoming cx1 of
  //   curve-end" to the KAPPA-scaled tangent control points.
  //
  // Walking clockwise from TL corner end (= top-edge start):
  //   a1 (r, 0)       — TL corner END     / top edge START
  //   a2 (w-r, 0)     — top edge END      / TR corner START
  //   a3 (w, r)       — TR corner END     / right edge START
  //   a4 (w, h-r)     — right edge END    / BR corner START
  //   a5 (w-r, h)     — BR corner END     / bottom edge START
  //   a6 (r, h)       — bottom edge END   / BL corner START
  //   a7 (0, h-r)     — BL corner END     / left edge START
  //   a8 (0, r)       — left edge END     / TL corner START
  //   closing = clone of a1                 (a8 → a1 closes the TL corner)

  // a1: cx1 = incoming from TL corner curve (tangent points left, toward 0)
  //     cx2 = outgoing along straight top edge → undefined (straight)
  const a1 = { x: r, y: 0, cx1: r - k, cy1: 0 }

  // a2: cx1 = incoming from straight top edge → undefined
  //     cx2 = outgoing into TR corner curve (tangent points right, toward w)
  const a2 = { x: w - r, y: 0, cx2: w - r + k, cy2: 0 }

  // a3: cx1 = incoming from TR corner (tangent points up, toward 0)
  //     cx2 = outgoing along straight right edge → undefined
  const a3 = { x: w, y: r, cx1: w, cy1: r - k }

  // a4: cx1 = incoming from straight right edge → undefined
  //     cx2 = outgoing into BR corner (tangent points down, toward h)
  const a4 = { x: w, y: h - r, cx2: w, cy2: h - r + k }

  // a5: cx1 = incoming from BR corner (tangent points right, toward w)
  //     cx2 = outgoing along straight bottom edge → undefined
  const a5 = { x: w - r, y: h, cx1: w - r + k, cy1: h }

  // a6: cx1 = incoming from straight bottom edge → undefined
  //     cx2 = outgoing into BL corner (tangent points left, toward 0)
  const a6 = { x: r, y: h, cx2: r - k, cy2: h }

  // a7: cx1 = incoming from BL corner (tangent points down, toward h)
  //     cx2 = outgoing along straight left edge → undefined
  const a7 = { x: 0, y: h - r, cx1: 0, cy1: h - r + k }

  // a8: cx1 = incoming from straight left edge → undefined
  //     cx2 = outgoing into TL corner (tangent points up, toward 0)
  const a8 = { x: 0, y: r, cx2: 0, cy2: r - k }

  return {
    penNodes: [a1, a2, a3, a4, a5, a6, a7, a8, { ...a1 }],
    closed: true,
  }
}

/**
 * Regular polygon → N corner-anchor loop.
 *
 * Reproduces the same vertex placement as the runtime renderer
 * (KonvaCanvas L214-223 in drawClipPath, mirroring Konva.RegularPolygon):
 *   angle_i = (2π * i / N) - π/2
 *   vertex_i = (radius * cos(angle_i), radius * sin(angle_i))
 *
 * No handles — polygon edges are straight lines, so pure corner anchors give
 * pixel-perfect parity with the original.
 *
 * penNodes are center-relative (Konva.RegularPolygon is center-pivoted), so
 * obj.x/y stays unchanged.
 *
 * @param {object} obj  shape object (must have type='polygon')
 * @returns {{ penNodes: Array, closed: boolean }}
 */
export function polygonToPenNodes(obj) {
  const sides = Math.max(3, obj.sides || 6)
  // Field resolution mirrors KonvaCanvas L430 / L216.
  const radius = obj.radius || (Math.min(obj.width || 100, obj.height || 100) / 2)

  const nodes = []
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i / sides) - Math.PI / 2
    nodes.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
  }
  nodes.push({ ...nodes[0] })  // closing duplicate

  return { penNodes: nodes, closed: true }
}

/**
 * Star → 2N corner-anchor loop (alternating outer / inner radius).
 *
 * Reproduces the same vertex placement as the runtime renderer
 * (KonvaCanvas L202-213 in drawClipPath, mirroring Konva.Star):
 *   for i in 0 .. 2*numPoints:
 *     r = i % 2 === 0 ? outerRadius : innerRadius
 *     angle = (i * π / numPoints) - π/2
 *     vertex = (r * cos(angle), r * sin(angle))
 *
 * Pure corner anchors — star edges are straight lines.
 *
 * @param {object} obj  shape object (must have type='star')
 * @returns {{ penNodes: Array, closed: boolean }}
 */
export function starToPenNodes(obj) {
  const np = Math.max(3, obj.numPoints || 5)
  // Field resolution mirrors KonvaCanvas L425-426 / L204-205.
  const outerR = obj.outerRadius || (Math.min(obj.width || 100, obj.height || 100) / 2)
  const innerR = obj.innerRadius || (outerR * 0.4)

  const nodes = []
  const total = np * 2
  for (let i = 0; i < total; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (i * Math.PI / np) - Math.PI / 2
    nodes.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r })
  }
  nodes.push({ ...nodes[0] })  // closing duplicate

  return { penNodes: nodes, closed: true }
}
