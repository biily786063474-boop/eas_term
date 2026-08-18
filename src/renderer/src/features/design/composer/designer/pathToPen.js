/**
 * SVG path d-string → DesignComposer penNodes (anchor structure).
 *
 * Used by the right-click "转为可编辑路径" action so SVG-imported `path`
 * objects can be promoted to `pen` objects with editable anchor handles.
 *
 * Normalization pipeline (powered by svgpath):
 *   1. .abs()     — convert all relative coords to absolute
 *   2. .unarc()   — replace each elliptical arc 'A' with up to 4 cubic 'C'
 *   3. .unshort() — expand shorthand 'S' / 'T' to full 'C' / 'Q'
 *
 * After normalization the only remaining commands are: M, L, H, V, C, Q, Z.
 * We handle each manually:
 *   - M / L / H / V → straight anchor: { x, y }
 *   - C            → cubic-bezier anchor: { x, y, cx1, cy1, cx2, cy2 }
 *                    (cx1/cy1 = incoming handle, cx2/cy2 = outgoing handle —
 *                     mirrors the convention in penNodesToPathD)
 *   - Q            → upgraded to cubic via the standard 2/3 formula
 *                    (slight floating-point shifts only; visually identical)
 *   - Z            → not stored (DesignComposer infers closure from first/last
 *                     anchor coincidence; matching penNodesToPathD output).
 *
 * Notes on the pen-node bezier convention (verified against
 * `penNodesToPathD` in KonvaCanvas.jsx and the anchor-edit UI):
 *   - When walking a path A → B, the cubic segment uses prev.cx2/cy2 as the
 *     outgoing control of A and cur.cx1/cy1 as the incoming control of B.
 *   - So when we read a `C cx1 cy1 cx2 cy2 x y` SVG command, the two control
 *     points are split: cx1/cy1 belongs to the **previous** node as its
 *     outgoing handle (.cx2/.cy2), and cx2/cy2 belongs to the **current**
 *     node as its incoming handle (.cx1/.cy1).
 *
 * @param {string} d  SVG path 'd' attribute string
 * @returns {Array<{x:number, y:number, cx1?:number, cy1?:number, cx2?:number, cy2?:number}>}
 *   Empty array if d is falsy / unparsable / produces no segments.
 * @throws {Error} If svgpath fails (caller should catch + show user-facing alert)
 */
import svgpath from 'svgpath'

export function pathDToPenNodes(d) {
  if (!d || typeof d !== 'string') return []

  // svgpath throws on malformed input — let it propagate so the caller can
  // surface a real error message instead of silently producing junk.
  const sp = svgpath(d).abs().unarc().unshort()

  /** @type {Array<{x:number, y:number, cx1?:number, cy1?:number, cx2?:number, cy2?:number}>} */
  const nodes = []

  sp.iterate((seg, _idx, lastX, lastY) => {
    const cmd = seg[0]

    if (cmd === 'M') {
      // Move-to: opens a new subpath. We append as a plain anchor.
      // (Note: svgpath does not split into multiple subpaths for us — multiple
      // M's just produce multiple anchors with no curve in between. This is
      // acceptable because penNodes is a single open/closed polyline anyway.)
      nodes.push({ x: seg[1], y: seg[2] })
    } else if (cmd === 'L') {
      nodes.push({ x: seg[1], y: seg[2] })
    } else if (cmd === 'H') {
      nodes.push({ x: seg[1], y: lastY })
    } else if (cmd === 'V') {
      nodes.push({ x: lastX, y: seg[1] })
    } else if (cmd === 'C') {
      // 'C cp1x cp1y cp2x cp2y x y'
      // cp1 is the outgoing handle of the previous node (prev.cx2 / prev.cy2),
      // cp2 is the incoming handle of the new node (cur.cx1 / cur.cy1).
      // NOTE: we leave the new node's cx2/cy2 undefined so the anchor-edit UI
      // (which uses `n.cx2 != null` to decide whether to draw handles) doesn't
      // render a degenerate zero-length outgoing handle on what may be the
      // final anchor. A subsequent C/Q segment will fill cx2/cy2 in below.
      const [, cp1x, cp1y, cp2x, cp2y, x, y] = seg
      if (nodes.length > 0) {
        const prev = nodes[nodes.length - 1]
        prev.cx2 = cp1x
        prev.cy2 = cp1y
        // Mirror the outgoing handle as the incoming handle of the previous
        // node IFF it doesn't already have one. The edit UI requires both
        // cx1/cy1 and cx2/cy2 to render the two-sided handle pair.
        if (prev.cx1 == null) {
          prev.cx1 = prev.x - (cp1x - prev.x)
          prev.cy1 = prev.y - (cp1y - prev.y)
        }
      }
      nodes.push({ x, y, cx1: cp2x, cy1: cp2y })
    } else if (cmd === 'Q') {
      // 'Q cqx cqy x y' — upgrade quadratic to cubic via the standard 2/3 rule:
      //   C1 = P0 + 2/3 * (Cq - P0)
      //   C2 = P3 + 2/3 * (Cq - P3)
      const [, cqx, cqy, x, y] = seg
      const c1x = lastX + (2 / 3) * (cqx - lastX)
      const c1y = lastY + (2 / 3) * (cqy - lastY)
      const c2x = x + (2 / 3) * (cqx - x)
      const c2y = y + (2 / 3) * (cqy - y)
      if (nodes.length > 0) {
        const prev = nodes[nodes.length - 1]
        prev.cx2 = c1x
        prev.cy2 = c1y
        if (prev.cx1 == null) {
          prev.cx1 = prev.x - (c1x - prev.x)
          prev.cy1 = prev.y - (c1y - prev.y)
        }
      }
      nodes.push({ x, y, cx1: c2x, cy1: c2y })
    }
    // Z / z: don't emit a node — DesignComposer infers closure from start/end
    // coincidence in penNodesToPathD. (No-op here.)
    // After unarc + unshort there are no other commands left.
  })

  return nodes
}
