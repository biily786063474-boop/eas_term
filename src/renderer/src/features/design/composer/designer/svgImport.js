/**
 * SVG file import — convert <path> elements in a user-uploaded SVG into
 * native design objects (type='path') rendered by Konva.Path.
 *
 * Scope (v1, intentional):
 *   - Only <path> elements are imported.
 *   - <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon> are NOT
 *     converted (user must convert to path in Illustrator/Figma export).
 *   - <g transform>, SMIL <animate>, <text>, <image>, <style>, gradients,
 *     and class selectors are ignored.
 *   - Only path-attribute fill/stroke + inline-style fill/stroke are read.
 *
 * Output objects use the existing path field convention:
 *   { type:'path', data:<d string>, fillRule, fill, stroke, strokeWidth, ... }
 * — matches textOutline.js so renderer logic stays uniform.
 */

const SVG_MIME_HINT = /svg/i

/**
 * Validate that a File-like object is an SVG (by mime or extension).
 */
export function isSvgFile(file) {
  if (!file) return false
  if (SVG_MIME_HINT.test(file.type || '')) return true
  const name = (file.name || '').toLowerCase()
  return name.endsWith('.svg')
}

/**
 * Parse SVG text into an array of design path descriptors.
 *
 * @param {string} text  Raw SVG file content.
 * @param {{ x: number, y: number, targetSize: number }} placement
 *        Top-left x/y of the import bounding box on canvas, plus targetSize
 *        controlling the largest dimension of the imported SVG (px).
 * @returns {{ ok: true, paths: Array, scale: number, vbW: number, vbH: number }
 *           | { ok: false, reason: string }}
 */
export function parseSvgToPaths(text, placement) {
  const { x: cx = 0, y: cy = 0, targetSize = 200 } = placement || {}

  let doc
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  } catch (e) {
    return { ok: false, reason: `SVG parse threw: ${e?.message || 'unknown'}` }
  }
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    return { ok: false, reason: 'SVG 解析失败 — 文件格式无效' }
  }
  const svg = doc.querySelector('svg')
  if (!svg) {
    return { ok: false, reason: '未找到 <svg> 根元素' }
  }

  const pathEls = doc.querySelectorAll('path')
  if (pathEls.length === 0) {
    return {
      ok: false,
      reason:
        'SVG 中未找到 <path> 元素。\n第一版只支持 path 类型(暂不支持 rect/circle/polygon 等),\n导出时请勾选「转换为 path」(Illustrator / Figma 都有此选项)。',
    }
  }

  // viewBox → scaling. Fallback to width/height attrs, else 100×100.
  const viewBoxAttr = svg.getAttribute('viewBox')
  let vbW = 100
  let vbH = 100
  if (viewBoxAttr) {
    const parts = viewBoxAttr.trim().split(/[\s,]+/).map(Number)
    if (parts.length >= 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[2] > 0 && parts[3] > 0) {
      vbW = parts[2]
      vbH = parts[3]
    }
  } else {
    const wAttr = parseFloat(svg.getAttribute('width'))
    const hAttr = parseFloat(svg.getAttribute('height'))
    if (Number.isFinite(wAttr) && wAttr > 0) vbW = wAttr
    if (Number.isFinite(hAttr) && hAttr > 0) vbH = hAttr
  }
  const scale = targetSize / Math.max(vbW, vbH)

  const paths = []
  pathEls.forEach((p, idx) => {
    const d = p.getAttribute('d')
    if (!d || !d.trim()) return

    const rawFill = p.getAttribute('fill') ?? p.style?.fill ?? ''
    const rawStroke = p.getAttribute('stroke') ?? p.style?.stroke ?? ''
    const rawStrokeWidth = p.getAttribute('stroke-width') ?? p.style?.strokeWidth ?? ''
    const rawOpacity = p.getAttribute('opacity') ?? p.style?.opacity ?? ''
    const rawFillRule = p.getAttribute('fill-rule') ?? p.style?.fillRule ?? 'nonzero'

    // SVG default fill is black when fill attr is absent.
    // fill='none' explicitly = no fill (treat as empty string for our schema).
    let fill
    if (rawFill === 'none') fill = ''
    else if (rawFill && rawFill.trim()) fill = rawFill.trim()
    else fill = '#000000'

    let stroke = ''
    if (rawStroke && rawStroke.trim() && rawStroke !== 'none') stroke = rawStroke.trim()

    let strokeWidth = 0
    if (rawStrokeWidth) {
      const sw = parseFloat(rawStrokeWidth)
      if (Number.isFinite(sw) && sw > 0) strokeWidth = sw * scale
    }

    let opacity = 1
    if (rawOpacity) {
      const op = parseFloat(rawOpacity)
      if (Number.isFinite(op)) opacity = Math.max(0, Math.min(1, op))
    }

    paths.push({
      type: 'path',
      x: cx,
      y: cy,
      width: vbW * scale,
      height: vbH * scale,
      data: d.trim(),
      fillRule: rawFillRule === 'evenodd' ? 'evenodd' : 'nonzero',
      fill,
      stroke,
      strokeWidth,
      opacity,
      rotation: 0,
      scaleX: scale,
      scaleY: scale,
      visible: true,
      locked: false,
      _svgImportIndex: idx,
    })
  })

  if (paths.length === 0) {
    return {
      ok: false,
      reason: 'SVG 中的 <path> 元素都缺少 d 属性,无法导入。',
    }
  }

  return { ok: true, paths, scale, vbW, vbH }
}

/**
 * High-level import flow: read file → parse → push to store via addObject.
 * Calls pushUndo() once before adding, selects all created paths.
 *
 * @param {File} file
 * @param {{
 *   addObject: (descriptor) => string,
 *   pushUndo: () => void,
 *   setSelectedIds: (ids: string[]) => void,
 *   canvasWidth: number,
 *   canvasHeight: number,
 *   targetSize?: number,
 *   onError?: (msg: string) => void,
 * }} ctx
 * @returns {Promise<{ ok: true, ids: string[] } | { ok: false, reason: string }>}
 */
export async function importSvgFile(file, ctx) {
  const { addObject, pushUndo, setSelectedIds, canvasWidth, canvasHeight, targetSize = 240, onError } = ctx || {}
  const fail = (reason) => {
    if (typeof onError === 'function') onError(reason)
    else if (typeof window !== 'undefined') window.alert(reason)
    return { ok: false, reason }
  }

  if (!file) return fail('请选择文件')
  if (!isSvgFile(file)) return fail('请选择 .svg 文件')
  if (typeof file.size === 'number' && file.size > 5 * 1024 * 1024) {
    return fail('SVG 文件超过 5 MB,体积太大请简化后再导入')
  }

  let text
  try {
    text = await file.text()
  } catch (e) {
    return fail(`读取文件失败:${e?.message || '未知错误'}`)
  }

  // Compute placement: center the imported drawing on the canvas.
  // We pass cx/cy as the *top-left* of the imported bounding box.
  // Each path's scaleX/Y already encodes vb→target ratio, so we offset by half target.
  const targetW = Math.min(targetSize, (canvasWidth || 800) * 0.8)
  const targetH = Math.min(targetSize, (canvasHeight || 600) * 0.8)
  const target = Math.min(targetW, targetH)
  const cx = ((canvasWidth || 800) - target) / 2
  const cy = ((canvasHeight || 600) - target) / 2

  const result = parseSvgToPaths(text, { x: cx, y: cy, targetSize: target })
  if (!result.ok) return fail(result.reason)

  if (typeof pushUndo === 'function') pushUndo()
  const ids = []
  for (const desc of result.paths) {
    try {
      const id = addObject(desc)
      if (id) ids.push(id)
    } catch (e) {
      // One bad path shouldn't kill the rest — log and continue.
      // eslint-disable-next-line no-console
      console.warn('[svgImport] addObject failed for path', e)
    }
  }
  if (ids.length === 0) return fail('SVG 导入失败:无法创建任何对象')

  if (typeof setSelectedIds === 'function') setSelectedIds(ids)
  return { ok: true, ids }
}
