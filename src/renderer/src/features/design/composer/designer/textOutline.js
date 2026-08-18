/**
 * Text → SVG paths conversion using imagetracerjs.
 *
 * Each character is rasterized at high resolution, then traced to an SVG path
 * with a single dark layer. Layout follows the source text object's
 * fontSize / lineHeight / letterSpacing / vertical / align.
 *
 * Tuned for smooth output with few anchors:
 *   - 4× oversampling on canvas
 *   - qtres = 1 (favor quadratic curves over line segments)
 *   - pathomit = 8 (drop tiny noise paths from antialiasing)
 *   - rightangleenhance = false (text doesn't need 90° snapping)
 */
import ImageTracer from 'imagetracerjs'

const RENDER_SCALE = 4 // canvas oversampling vs final fontSize

const TRACE_OPTIONS = {
  // Color quantization → binary
  numberofcolors: 2,
  colorquantcycles: 1,
  mincolorratio: 0,
  colorsampling: 0,

  // Tracing: favor smooth curves with few anchors
  ltres: 1,
  qtres: 1,
  pathomit: 8,
  rightangleenhance: false,
  blurradius: 0,

  // Output
  layering: 0,
  linefilter: true,
  strokewidth: 0,
  scale: 1,
  roundcoords: 2,
  desc: false,
  viewbox: false,
}

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\u00a0' || ch === '\u3000'
}

/**
 * Rasterize a single character at RENDER_SCALE oversampling.
 * Returns { imgData, pad, left, ascent, w, h, advance } in render-pixel units.
 */
function rasterizeChar(ch, fontShorthand, fontSize) {
  const renderSize = fontSize * RENDER_SCALE

  const probe = document.createElement('canvas')
  const pctx = probe.getContext('2d')
  pctx.font = fontShorthand
  const m = pctx.measureText(ch)
  const left = Math.max(0, Math.ceil(m.actualBoundingBoxLeft || 0))
  const right = Math.max(1, Math.ceil(m.actualBoundingBoxRight || m.width || 1))
  const ascent = Math.max(1, Math.ceil(m.actualBoundingBoxAscent || renderSize * 0.8))
  const descent = Math.max(0, Math.ceil(m.actualBoundingBoxDescent || renderSize * 0.2))
  const advance = m.width
  const pad = Math.max(2, Math.ceil(renderSize * 0.04))
  const w = Math.max(1, left + right + pad * 2)
  const h = Math.max(1, ascent + descent + pad * 2)
  probe.width = 0; probe.height = 0

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#000000'
  ctx.font = fontShorthand
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(ch, pad + left, pad + ascent)
  const imgData = ctx.getImageData(0, 0, w, h)
  c.width = 0; c.height = 0

  return { imgData, pad, left, ascent, advance, w, h }
}

/**
 * Convert tracedata's dark layer to an SVG path d-string in fontSize coords.
 * Holes are appended in reversed direction (uses non-zero or even-odd fill rule).
 */
function tracedataToPathD(tracedata, scale) {
  const palette = tracedata.palette || []
  if (!palette.length) return ''

  // Pick the darkest palette entry as the foreground layer
  let darkIdx = 0
  let darkSum = Infinity
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i]
    const sum = (p.r ?? 0) + (p.g ?? 0) + (p.b ?? 0)
    if (sum < darkSum) { darkSum = sum; darkIdx = i }
  }

  const layer = tracedata.layers?.[darkIdx]
  if (!layer || !layer.length) return ''

  const round = (n) => Math.round(n * 100) / 100
  let d = ''

  for (let pi = 0; pi < layer.length; pi++) {
    const path = layer[pi]
    if (!path || path.isholepath) continue
    const segs = path.segments
    if (!segs || segs.length === 0) continue

    d += `M ${round(segs[0].x1 * scale)} ${round(segs[0].y1 * scale)} `
    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s]
      d += `${seg.type} ${round(seg.x2 * scale)} ${round(seg.y2 * scale)} `
      if (seg.x3 != null) {
        d += `${round(seg.x3 * scale)} ${round(seg.y3 * scale)} `
      }
    }
    d += 'Z '

    // Hole children — reversed so even-odd / non-zero rule cuts them out
    if (path.holechildren && path.holechildren.length) {
      for (const hci of path.holechildren) {
        const hp = layer[hci]
        if (!hp || !hp.segments?.length) continue
        const last = hp.segments[hp.segments.length - 1]
        const sx = last.x3 != null ? last.x3 : last.x2
        const sy = last.y3 != null ? last.y3 : last.y2
        d += `M ${round(sx * scale)} ${round(sy * scale)} `
        for (let s = hp.segments.length - 1; s >= 0; s--) {
          const seg = hp.segments[s]
          d += `${seg.type} `
          if (seg.x3 != null) {
            d += `${round(seg.x2 * scale)} ${round(seg.y2 * scale)} `
          }
          d += `${round(seg.x1 * scale)} ${round(seg.y1 * scale)} `
        }
        d += 'Z '
      }
    }
  }

  return d.trim()
}

/**
 * Build font shorthand string at given pixel size.
 * Uses fontWeight/fontStyle if provided on the text obj.
 */
function buildFontShorthand(textObj, sizePx) {
  const family = textObj.fontFamily || 'sans-serif'
  const weight = textObj.fontWeight || 'normal'
  const style = textObj.fontStyle || 'normal'
  // CSS font shorthand requires units; quote family if it has spaces
  const familyQuoted = family.includes(',') || /[^\w-]/.test(family) ? `"${family}"` : family
  return `${style} ${weight} ${sizePx}px ${familyQuoted}`
}

/**
 * Convert a text object into an array of path-shape descriptors.
 * Returns null if the text is empty or no glyph could be rendered.
 *
 * Output paths use:
 *   - obj.x, obj.y = top-left of the character bbox in design canvas coords
 *   - obj.data    = SVG path d-string in local space (already scaled to fontSize)
 *   - obj.width/height = bbox dimensions
 *   - obj.fillRule = 'evenodd' (so holes inside glyphs are punched out)
 */
export function textObjectToPaths(textObj) {
  const text = (textObj.text ?? '').toString()
  if (!text.trim()) return null

  const fontSize = textObj.fontSize || 24
  const lineHeight = (textObj.lineHeight ?? 1.2) * fontSize
  const letterSpacing = textObj.letterSpacing || 0
  const fill = textObj.fill || '#000000'
  const vertical = !!textObj.vertical
  const align = textObj.align || 'left'

  // Canvas-rendered shorthand at oversampled size
  const fontShorthandRender = buildFontShorthand(textObj, fontSize * RENDER_SCALE)
  // Probe shorthand at fontSize scale, used for layout-only metrics
  const fontShorthandLayout = buildFontShorthand(textObj, fontSize)

  // Layout: split into lines (vertical mode = one char per line, like Konva does)
  const rawLines = vertical
    ? Array.from(text).map(c => c)
    : text.split('\n')

  // Probe canvas to measure line metrics + per-line width
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = fontShorthandLayout
  const lineMetrics = probe.measureText('Mg中')
  const lineAscent = lineMetrics.actualBoundingBoxAscent || fontSize * 0.8
  // Distance from line top to baseline. Matches Konva's default text layout where
  // line top sits at y=0 and the baseline is one ascent below.
  const baselineOffset = lineAscent

  // Helper: measure a line's visual width (sum of advances + letterSpacing)
  function measureLineWidth(line) {
    if (vertical) {
      // vertical mode: each char's advance is irrelevant; width = max char advance
      const m = probe.measureText(line)
      return m.width
    }
    let total = 0
    for (const ch of line) {
      const m = probe.measureText(ch)
      total += m.width + letterSpacing
    }
    return Math.max(0, total - letterSpacing)
  }

  // For alignment we need to know the widest line
  const lineWidths = rawLines.map(measureLineWidth)
  const maxWidth = Math.max(...lineWidths, 0)

  const paths = []
  let lineY = 0 // top of current line

  for (let li = 0; li < rawLines.length; li++) {
    const line = rawLines[li]
    const lw = lineWidths[li]
    let cursorX = 0
    if (!vertical) {
      if (align === 'center') cursorX = (maxWidth - lw) / 2
      else if (align === 'right') cursorX = maxWidth - lw
    }

    for (const ch of line) {
      if (ch === '\r') continue

      // Whitespace just advances the cursor; no path
      if (isWhitespace(ch)) {
        const adv = probe.measureText(ch).width
        cursorX += adv + letterSpacing
        continue
      }

      let r, tracedata, d
      try {
        r = rasterizeChar(ch, fontShorthandRender, fontSize)
        tracedata = ImageTracer.imagedataToTracedata(r.imgData, TRACE_OPTIONS)
        d = tracedataToPathD(tracedata, 1 / RENDER_SCALE)
      } catch (err) {
        console.warn('[textOutline] failed for char', ch, err)
        cursorX += fontSize + letterSpacing
        continue
      }

      const advance = r.advance / RENDER_SCALE
      if (!d) {
        cursorX += advance + letterSpacing
        continue
      }

      // Glyph baseline within the canvas: pad + ascent (in render px) → /RS in fontSize px
      const glyphBaselineFromTop = (r.pad + r.ascent) / RENDER_SCALE
      // Canvas left bearing = pad + left
      const glyphLeftBearing = (r.pad + r.left) / RENDER_SCALE

      // Place baseline at lineY + baselineOffset
      // Place glyph's left-bearing edge at cursorX
      const objX = cursorX - glyphLeftBearing
      const objY = lineY + baselineOffset - glyphBaselineFromTop

      paths.push({
        type: 'path',
        x: objX,
        y: objY,
        width: r.w / RENDER_SCALE,
        height: r.h / RENDER_SCALE,
        fill,
        fillRule: 'evenodd',
        stroke: '',
        strokeWidth: 0,
        opacity: 1,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        visible: true,
        locked: false,
        data: d,
        _glyph: ch,
      })

      cursorX += advance + letterSpacing
    }

    lineY += lineHeight
  }

  return paths.length ? paths : null
}
