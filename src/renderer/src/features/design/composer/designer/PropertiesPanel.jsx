/**
 * PropertiesPanel — Figma-style object properties editor
 * Structured sections: Transform → Appearance → Shape → Typography → Effects
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useUnifiedDesignStore } from './store'
import { BLEND_MODES, TEXT_FONT_SIZE, TEXT_FONT_MIN, TEXT_FONT_MAX, TEXT_LINE_HEIGHT, TEXT_LETTER_SPACING, SHADOW_DEFAULTS, INNER_GLOW_DEFAULTS, OUTER_GLOW_DEFAULTS, DEFAULT_STROKE, ACCENT } from './constants'

const FALLBACK_FONTS = [
  'Inter', 'Arial', 'Helvetica', 'PingFang SC', 'Microsoft YaHei',
  'Noto Sans SC', 'Source Han Sans', 'Times New Roman', 'Georgia',
  'Courier New', 'SF Mono', 'Menlo',
]

// Test if a font supports CJK characters
// Uses canvas measurement: compare '国' width in target font vs a known Latin-only font
let _cjkTestCtx = null
const CJK_NAME_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/
function isCJKFont(family, displayName) {
  // Quick check: if displayName contains CJK chars, it's CJK
  if (displayName && CJK_NAME_RE.test(displayName)) return true
  // Canvas measurement: compare against a known Latin-only fallback
  if (!_cjkTestCtx) _cjkTestCtx = document.createElement('canvas').getContext('2d')
  const ctx = _cjkTestCtx
  // Use serif as fallback (does NOT contain CJK on most systems)
  // Measure a Latin char first to verify the font is actually loaded
  ctx.font = '72px "____nonexistent____", serif'
  const serifCJK = ctx.measureText('国').width
  ctx.font = `72px "${family}", "____nonexistent____", serif`
  const testCJK = ctx.measureText('国').width
  // Also test a Latin char to see if font is working at all
  ctx.font = `72px "${family}", "____nonexistent____", serif`
  const testLatin = ctx.measureText('A').width
  ctx.font = '72px "____nonexistent____", serif'
  const serifLatin = ctx.measureText('A').width
  // Font loaded if Latin width differs; has CJK if CJK width differs
  const fontLoaded = Math.abs(testLatin - serifLatin) > 0.5
  const hasCJK = Math.abs(testCJK - serifCJK) > 0.5
  return fontLoaded ? hasCJK : false
}

let _localFontsCache = null
async function getLocalFonts() {
  if (_localFontsCache) return _localFontsCache
  let rawFamilies = null

  // Method 1: Local Font Access API (Chromium 103+)
  let fontMetaMap = null // family → { displayName }
  try {
    if (typeof window.queryLocalFonts === 'function') {
      const fonts = await window.queryLocalFonts()
      if (fonts?.length) {
        fontMetaMap = new Map()
        for (const f of fonts) {
          if (!fontMetaMap.has(f.family)) {
            // Use fullName for display if it differs from family (often contains localized name)
            fontMetaMap.set(f.family, { displayName: f.fullName || f.family })
          }
        }
        rawFamilies = [...fontMetaMap.keys()]
        console.log(`[Fonts] Loaded ${rawFamilies.length} local fonts via queryLocalFonts`)
      }
    }
  } catch (e) {
    console.warn('[Fonts] queryLocalFonts failed:', e.message)
  }
  // Method 2: Electron IPC fallback
  if (!rawFamilies) {
    try {
      if (window.electronFS?.getSystemFonts) {
        const fonts = await window.electronFS.getSystemFonts()
        if (fonts?.length) {
          rawFamilies = fonts
          console.log(`[Fonts] Loaded ${fonts.length} system fonts via IPC`)
        }
      }
    } catch (e) {
      console.warn('[Fonts] IPC font fallback failed:', e.message)
    }
  }
  if (!rawFamilies) return null

  // Classify by actual CJK glyph support
  // Each entry: { family: 'PingFang SC', displayName: '苹方-简 常规体' }
  const chinese = [], western = []
  for (const family of rawFamilies) {
    if (!family || family.startsWith('.')) continue
    const meta = fontMetaMap?.get(family)
    const displayName = meta?.displayName || family
    // Show localized name if available, otherwise family
    const label = displayName !== family ? `${displayName}` : family
    const entry = { family, label }
    if (isCJKFont(family, label)) {
      chinese.push(entry)
    } else {
      western.push(entry)
    }
  }
  chinese.sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  western.sort((a, b) => a.label.localeCompare(b.label, 'en'))
  console.log(`[Fonts] Classified: ${chinese.length} CJK, ${western.length} Western`)

  _localFontsCache = { chinese, western }
  return _localFontsCache
}

/* ── Reusable inline row ── */
function PropRow({ label, children }) {
  return (
    <div className="uc__pr-row">
      <span className="uc__pr-lbl">{label}</span>
      <div className="uc__pr-ctrl">{children}</div>
    </div>
  )
}

/**
 * DragNumInput — number input with horizontal drag-to-adjust.
 * Hold-and-drag on the input to scrub; click normally to type.
 * Shift = 10x step, Alt = 0.1x step.
 */
function DragNumInput({ value, min, max, step = 1, onChange, className, ...rest }) {
  const ref = useRef(null)
  const drag = useRef(null)

  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return
    // Record start position; actual drag starts after 3px threshold
    drag.current = { startX: e.clientX, startVal: typeof value === 'number' ? value : parseFloat(value) || 0, moved: false }
    const onMove = (ev) => {
      const d = drag.current
      if (!d) return
      const dx = ev.clientX - d.startX
      if (!d.moved && Math.abs(dx) < 3) return
      if (!d.moved) {
        d.moved = true
        ref.current?.blur()
        document.body.style.cursor = 'ew-resize'
        document.body.style.userSelect = 'none'
      }
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1
      let next = d.startVal + dx * step * mult
      if (min != null) next = Math.max(min, next)
      if (max != null) next = Math.min(max, next)
      // Round to step precision
      const dec = (String(step).split('.')[1] || '').length
      next = parseFloat(next.toFixed(dec))
      onChange(next)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      const d = drag.current
      drag.current = null
      // If no drag happened, let the click focus the input for typing
      if (d && !d.moved && ref.current) {
        ref.current.focus()
        ref.current.select()
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    e.preventDefault() // prevent focus on drag start
  }, [value, min, max, step, onChange])

  return (
    <input ref={ref} type="number" className={className}
      value={value} min={min} max={max} step={step}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      onPointerDown={handlePointerDown}
      style={{ cursor: 'ew-resize' }}
      {...rest} />
  )
}

function SliderRow({ label, value, min, max, step, unit, onChange }) {
  const display = unit === '%' ? `${value}%`
    : unit === '°' ? `${value}°`
    : typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1))
    : value
  return (
    <PropRow label={label}>
      <input type="range" className="uc__pr-slider" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} />
      <span className="uc__pr-val">{display}</span>
    </PropRow>
  )
}

/* ── Blend mode picker with grouped separators ── */
function BlendPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', fn, true)
    return () => document.removeEventListener('mousedown', fn, true)
  }, [open])

  const current = BLEND_MODES.find(m => m.value === value) || BLEND_MODES[0]
  let lastGroup = null

  return (
    <div className="uc__pr-blend" ref={ref}>
      <button className="uc__pr-blend-btn" onClick={() => setOpen(v => !v)}>
        <span>{current.label}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="uc__pr-blend-dd">
          {BLEND_MODES.map(m => {
            const showSep = lastGroup !== null && m.group !== lastGroup
            lastGroup = m.group
            return (
              <React.Fragment key={m.value}>
                {showSep && <div className="uc__pr-blend-sep" />}
                <button
                  className={`uc__pr-blend-item${m.value === value ? ' uc__pr-blend-item--on' : ''}`}
                  onClick={() => { onChange(m.value); setOpen(false) }}>
                  {m.label}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Collect unique fill/stroke colors from a list of objects.
 * Each entry: { color, targets: [{ parentId|null, id }] }
 * parentId is set for children inside groups, null for top-level objects.
 */
function collectColors(items, parentId) {
  const fills = []
  const strokes = []
  for (const item of items) {
    if ((item.type === 'group' || item.type === 'mask') && item.children) {
      const sub = collectColors(item.children, parentId ?? item.id)
      fills.push(...sub.fills)
      strokes.push(...sub.strokes)
      continue
    }
    const target = { parentId, id: item.id }
    if (item.fill && item.fill !== 'transparent' && item.fillType !== 'none') {
      const hex = item.fill.toLowerCase()
      const existing = fills.find(f => f.color === hex)
      if (existing) existing.targets.push(target)
      else fills.push({ color: hex, targets: [target] })
    }
    if (item.stroke && item.strokeWidth > 0) {
      const hex = item.stroke.toLowerCase()
      const existing = strokes.find(s => s.color === hex)
      if (existing) existing.targets.push(target)
      else strokes.push({ color: hex, targets: [target] })
    }
  }
  return { fills, strokes }
}

/**
 * ColorAggregator — shows unique fill/stroke colors from multiple objects.
 * Batch-updates all matching objects when a color is changed.
 */


function ColorAggregator({ fills, strokes, updateObject, updateChild, pushUndo }) {
  const batchUpdate = (entries, oldColor, newColor, prop) => {
    const entry = entries.find(e => e.color === oldColor)
    if (!entry) return
    pushUndo()
    for (const { parentId, id } of entry.targets) {
      if (parentId) updateChild(parentId, id, { [prop]: newColor })
      else updateObject(id, { [prop]: newColor })
    }
  }

  if (fills.length === 0 && strokes.length === 0) return null

  return (
    <>
      {fills.length > 0 && (
        <div className="uc__pr-group">
          <div className="uc__pr-head">填充色</div>
          {fills.map((entry, i) => (
            <div key={`f-${i}`} className="uc__pr-row">
              <input type="color" className="uc__pr-color" value={entry.color}
                onChange={e => batchUpdate(fills, entry.color, e.target.value, 'fill')} />
              <span className="uc__pr-lbl" style={{ flex: 1, opacity: 0.5, fontSize: 11 }}>
                {entry.targets.length} 个元素
              </span>
            </div>
          ))}
        </div>
      )}
      {strokes.length > 0 && (
        <div className="uc__pr-group">
          <div className="uc__pr-head">描边色</div>
          {strokes.map((entry, i) => (
            <div key={`s-${i}`} className="uc__pr-row">
              <input type="color" className="uc__pr-color" value={entry.color}
                onChange={e => batchUpdate(strokes, entry.color, e.target.value, 'stroke')} />
              <span className="uc__pr-lbl" style={{ flex: 1, opacity: 0.5, fontSize: 11 }}>
                {entry.targets.length} 个元素
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default function PropertiesPanel() {
  const selectedIds = useUnifiedDesignStore(s => s.selectedIds)
  const objects = useUnifiedDesignStore(s => s.objects)
  const updateObject = useUnifiedDesignStore(s => s.updateObject)
  const updateChild = useUnifiedDesignStore(s => s.updateChild)
  const pushUndo = useUnifiedDesignStore(s => s.pushUndo)
  const outlineText = useUnifiedDesignStore(s => s.outlineText)

  const [fontGroups, setFontGroups] = useState({
    chinese: [],
    western: FALLBACK_FONTS.map(f => ({ family: f, label: f })),
  })
  const [fontSearch, setFontSearch] = useState('')
  const [showFontPicker, setShowFontPicker] = useState(false)
  const fontPickerRef = useRef(null)

  useEffect(() => {
    getLocalFonts().then(result => {
      if (result?.chinese || result?.western) setFontGroups(result)
    })
  }, [])
  useEffect(() => {
    if (!showFontPicker) return
    const fn = (e) => { if (fontPickerRef.current && !fontPickerRef.current.contains(e.target)) { setShowFontPicker(false); setFontSearch('') } }
    document.addEventListener('mousedown', fn, true)
    return () => document.removeEventListener('mousedown', fn, true)
  }, [showFontPicker])

  // Find selected object — top-level or nested child
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  let obj = selectedId ? objects.find(o => o.id === selectedId) : null
  let _parentId = null
  if (!obj && selectedId) {
    for (const o of objects) {
      if (o.children) {
        const child = o.children.find(c => c.id === selectedId)
        if (child) { obj = child; _parentId = o.id; break }
      }
    }
  }

  const apply = useCallback((changes) => {
    if (!obj) return
    pushUndo()
    if (_parentId) updateChild(_parentId, obj.id, changes)
    else updateObject(obj.id, changes)
  }, [obj, _parentId, pushUndo, updateObject, updateChild])

  // Multi-selection: show aggregated color controls
  if (!obj && selectedIds.length > 1) {
    const selected = []
    for (const id of selectedIds) {
      const top = objects.find(o => o.id === id)
      if (top) { selected.push({ ...top, _parentId: null }); continue }
      for (const o of objects) {
        const c = o.children?.find(ch => ch.id === id)
        if (c) { selected.push({ ...c, _parentId: o.id }); break }
      }
    }
    const { fills, strokes } = collectColors(selected.map(s => ({ ...s })), null)
    // Fix parentId for children — collectColors sets null for top-level
    for (const entry of [...fills, ...strokes]) {
      for (const t of entry.targets) {
        const src = selected.find(s => s.id === t.id)
        if (src?._parentId) t.parentId = src._parentId
      }
    }
    return (
      <div className="uc__props">
        <div className="uc__pr-group">
          <div className="uc__pr-head">多选 ({selectedIds.length} 个)</div>
        </div>
        <ColorAggregator fills={fills} strokes={strokes}
          updateObject={updateObject} updateChild={updateChild} pushUndo={pushUndo} />
      </div>
    )
  }

  if (!obj) {
    return (
      <div className="uc__props">
        <div className="uc__props-empty">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.25">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
          </svg>
          <span>选中对象查看属性</span>
        </div>
      </div>
    )
  }

  const isGroup = obj.type === 'group' || obj.type === 'mask'
  const fillType = obj.fillType || 'solid'
  const isNone = !obj.fill && fillType !== 'gradient' && fillType !== 'radial'
  const isText = obj.type === 'text'
  const isRect = obj.type === 'rect'

  return (
    <div className="uc__props">

      {/* ═══ Group color aggregator ═══ */}
      {isGroup && obj.children?.length > 0 && (() => {
        const { fills, strokes } = collectColors(obj.children, obj.id)
        return <ColorAggregator fills={fills} strokes={strokes}
          updateObject={updateObject} updateChild={updateChild} pushUndo={pushUndo} />
      })()}

      {/* ═══ Transform ═══ */}
      <div className="uc__pr-group">
        <div className="uc__pr-head">变换</div>
        <div className="uc__pr-grid2">
          <label className="uc__pr-gi"><span className="uc__pr-gl">X</span>
            <DragNumInput className="uc__pr-ginp" value={Math.round(obj.x || 0)} step={1} onChange={v => apply({ x: v })} /></label>
          <label className="uc__pr-gi"><span className="uc__pr-gl">Y</span>
            <DragNumInput className="uc__pr-ginp" value={Math.round(obj.y || 0)} step={1} onChange={v => apply({ y: v })} /></label>
          {obj.width != null && <label className="uc__pr-gi"><span className="uc__pr-gl">W</span>
            <DragNumInput className="uc__pr-ginp" value={Math.round(obj.width || 0)} min={1} step={1} onChange={v => apply({ width: v })} /></label>}
          {obj.height != null && <label className="uc__pr-gi"><span className="uc__pr-gl">H</span>
            <DragNumInput className="uc__pr-ginp" value={Math.round(obj.height || 0)} min={1} step={1} onChange={v => apply({ height: v })} /></label>}
          <label className="uc__pr-gi"><span className="uc__pr-gl">R°</span>
            <DragNumInput className="uc__pr-ginp" value={Math.round(obj.rotation || 0)} step={1} onChange={v => apply({ rotation: v })} /></label>
        </div>
        <SliderRow label="透明度" value={Math.round((obj.opacity ?? 1) * 100)} min={0} max={100} step={1} unit="%" onChange={v => apply({ opacity: v / 100 })} />
        <PropRow label="混合">
          <BlendPicker value={obj.blendMode || 'source-over'} onChange={v => apply({ blendMode: v })} />
        </PropRow>
      </div>

      {/* ═══ Fill ═══ */}
      <div className="uc__pr-group">
        <div className="uc__pr-head">
          <span>填充</span>
          <div className="uc__pr-tabs">
            <button className={`uc__pr-tab${(fillType === 'none' || isNone) ? ' uc__pr-tab--on' : ''}`}
              onClick={() => apply({ fillType: 'none', fill: '' })} data-tip="无">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="4" y1="4" x2="20" y2="20"/></svg>
            </button>
            <button className={`uc__pr-tab${fillType === 'solid' && !isNone ? ' uc__pr-tab--on' : ''}`}
              onClick={() => apply({ fillType: 'solid', fill: obj.fill || '#cccccc' })} data-tip="纯色">
              <svg width="9" height="9" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="3" fill="currentColor"/></svg>
            </button>
            <button className={`uc__pr-tab${fillType === 'gradient' ? ' uc__pr-tab--on' : ''}`}
              onClick={() => apply({ fillType: 'gradient', gradientColors: obj.gradientColors || { c1: '#000000', c2: '#ffffff' }, gradientAngle: obj.gradientAngle ?? 0 })} data-tip="线性渐变">
              <svg width="9" height="9" viewBox="0 0 24 24"><defs><linearGradient id="dc-gi" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#666"/><stop offset="100%" stopColor="#fff"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="3" fill="url(#dc-gi)"/></svg>
            </button>
            <button className={`uc__pr-tab${fillType === 'radial' ? ' uc__pr-tab--on' : ''}`}
              onClick={() => apply({ fillType: 'radial', gradientColors: obj.gradientColors || { c1: '#000000', c2: '#ffffff' } })} data-tip="径向渐变">
              <svg width="9" height="9" viewBox="0 0 24 24"><defs><radialGradient id="dc-ri"><stop offset="0%" stopColor="#fff"/><stop offset="100%" stopColor="#666"/></radialGradient></defs><circle cx="12" cy="12" r="10" fill="url(#dc-ri)"/></svg>
            </button>
          </div>
        </div>
        {fillType === 'solid' && !isNone && (
          <PropRow label="颜色"><input type="color" className="uc__pr-color" value={obj.fill || '#cccccc'} onChange={e => apply({ fill: e.target.value })} /></PropRow>
        )}
        {(fillType === 'gradient' || fillType === 'radial') && (() => {
          const gc = obj.gradientColors || {}
          const upGc = (changes) => apply({ gradientColors: { ...gc, ...changes } })
          return (
            <>
              <div className="uc__pr-row">
                <span className="uc__pr-lbl">{fillType === 'radial' ? '中心' : '起点'}</span>
                <input type="color" className="uc__pr-color" value={gc.c1 || '#000'} onChange={e => upGc({ c1: e.target.value })} />
                <input type="range" className="uc__pr-slider" min={0} max={100} step={1}
                  value={Math.round((gc.a1 ?? 1) * 100)}
                  onChange={e => upGc({ a1: +e.target.value / 100 })} />
                <span className="uc__pr-val">{Math.round((gc.a1 ?? 1) * 100)}%</span>
              </div>
              <div className="uc__pr-row">
                <span className="uc__pr-lbl">{fillType === 'radial' ? '边缘' : '终点'}</span>
                <input type="color" className="uc__pr-color" value={gc.c2 || '#fff'} onChange={e => upGc({ c2: e.target.value })} />
                <input type="range" className="uc__pr-slider" min={0} max={100} step={1}
                  value={Math.round((gc.a2 ?? 1) * 100)}
                  onChange={e => upGc({ a2: +e.target.value / 100 })} />
                <span className="uc__pr-val">{Math.round((gc.a2 ?? 1) * 100)}%</span>
              </div>
              {fillType === 'gradient' && (
                <SliderRow label="角度" value={obj.gradientAngle || 0} min={0} max={360} step={15} unit="°" onChange={v => apply({ gradientAngle: v })} />
              )}
            </>
          )
        })()}
      </div>

      {/* ═══ Stroke ═══ */}
      <div className="uc__pr-group">
        <div className="uc__pr-head">
          <span>描边</span>
          <button className={`uc__pr-sw${!obj.stroke || obj.strokeWidth === 0 ? ' uc__pr-sw--off' : ''}`}
            onClick={() => {
              if (obj.stroke && obj.strokeWidth > 0) apply({ _savedStroke: obj.stroke, _savedStrokeWidth: obj.strokeWidth, stroke: '', strokeWidth: 0 })
              else apply({ stroke: obj._savedStroke || '#000000', strokeWidth: obj._savedStrokeWidth || 2 })
            }}>
            {obj.stroke && obj.strokeWidth > 0 ? 'ON' : 'OFF'}
          </button>
        </div>
        {obj.stroke && obj.strokeWidth > 0 && (
          <>
            <div className="uc__pr-row">
              <span className="uc__pr-lbl">颜色</span>
              <input type="color" className="uc__pr-color" value={obj.stroke || '#000'} onChange={e => apply({ stroke: e.target.value })} />
              <DragNumInput className="uc__pr-num" value={obj.strokeWidth ?? 2} min={1} max={50} step={1} onChange={v => apply({ strokeWidth: v })} />
              <span className="uc__pr-unit">px</span>
            </div>
            <div className="uc__pr-row">
              <span className="uc__pr-lbl">端点</span>
              <div className="uc__pr-seg">
                {[['butt', '平'], ['round', '圆'], ['square', '方']].map(([v, l]) => (
                  <button key={v} className={`uc__pr-seg-btn${(obj.lineCap || 'butt') === v ? ' uc__pr-seg-btn--on' : ''}`}
                    onClick={() => apply({ lineCap: v })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="uc__pr-row">
              <span className="uc__pr-lbl">拐角</span>
              <div className="uc__pr-seg">
                {[['miter', '尖'], ['round', '圆'], ['bevel', '平']].map(([v, l]) => (
                  <button key={v} className={`uc__pr-seg-btn${(obj.lineJoin || 'miter') === v ? ' uc__pr-seg-btn--on' : ''}`}
                    onClick={() => apply({ lineJoin: v })}>{l}</button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ═══ Shape-specific ═══ */}
      {(isRect || obj.type === 'line' || obj.type === 'pen' || obj.type === 'star' || obj.type === 'polygon') && (
        <div className="uc__pr-group">
          <div className="uc__pr-head">形状</div>
          {isRect && <SliderRow label="圆角" value={obj.cornerRadius || 0} min={0} max={Math.min(obj.width || 200, obj.height || 200) / 2} step={1} onChange={v => apply({ cornerRadius: v })} />}
          {(obj.type === 'line' || obj.type === 'pen') && <SliderRow label="平滑" value={Math.round((obj.tension ?? 0) * 100)} min={0} max={100} step={5} unit="%" onChange={v => apply({ tension: v / 100 })} />}
          {obj.type === 'star' && (
            <>
              <SliderRow label="角数" value={obj.numPoints || 5} min={3} max={20} step={1} onChange={v => apply({ numPoints: v })} />
              <SliderRow label="内径" value={Math.round((obj.innerRadius || 20) / (obj.outerRadius || 50) * 100)} min={5} max={95} step={1} unit="%" onChange={v => apply({ innerRadius: (obj.outerRadius || 50) * (v / 100) })} />
            </>
          )}
          {obj.type === 'polygon' && <SliderRow label="边数" value={obj.sides || 6} min={3} max={12} step={1} onChange={v => apply({ sides: v })} />}
        </div>
      )}

      {/* ═══ Typography ═══ */}
      {isText && (
        <div className="uc__pr-group" ref={fontPickerRef}>
          <div className="uc__pr-head">文字</div>
          <div className="uc__pr-row">
            <span className="uc__pr-lbl">模式</span>
            <div className="uc__pr-seg">
              <button className={`uc__pr-seg-btn${obj.textSizing !== 'fixed' ? ' uc__pr-seg-btn--on' : ''}`}
                data-tip="定界框适应文字"
                onClick={() => {
                  const changes = { textSizing: 'auto' }
                  // Clear width/height so Konva auto-sizes
                  changes.width = undefined; changes.height = undefined
                  apply(changes)
                }}>自适应</button>
              <button className={`uc__pr-seg-btn${obj.textSizing === 'fixed' ? ' uc__pr-seg-btn--on' : ''}`}
                data-tip="文字适应定界框"
                onClick={() => {
                  const changes = { textSizing: 'fixed' }
                  // Read current rendered size as initial width/height
                  if (!obj.width || !obj.height) {
                    const stage = window.__ucStage
                    const node = stage?.findOne(`[data-id="${obj.id}"]`)
                    if (node) {
                      changes.width = Math.ceil(node.width())
                      changes.height = Math.ceil(node.height())
                    } else {
                      changes.width = 200; changes.height = 100
                    }
                  }
                  apply(changes)
                }}>固定框</button>
            </div>
          </div>
          <PropRow label="字体">
            <button className="uc__pr-font-btn" onClick={() => { setShowFontPicker(v => !v); setFontSearch('') }}>
              <span className="uc__pr-font-name" style={{ fontFamily: obj.fontFamily }}>{(obj.fontFamily || 'sans-serif').split(',')[0].trim()}</span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {showFontPicker && (() => {
              const q = fontSearch.toLowerCase()
              const filterFn = entry => !q || entry.label.toLowerCase().includes(q) || entry.family.toLowerCase().includes(q)
              const cn = fontGroups.chinese.filter(filterFn)
              const en = fontGroups.western.filter(filterFn)
              const currentFont = (obj.fontFamily || '').split(',')[0].trim()
              const renderItem = (entry) => (
                <button key={entry.family}
                  className={`uc__pr-font-item${currentFont === entry.family ? ' uc__pr-font-item--on' : ''}`}
                  style={{ fontFamily: entry.family }}
                  onClick={() => { apply({ fontFamily: entry.family }); setShowFontPicker(false); setFontSearch('') }}>
                  {entry.label}
                </button>
              )
              return (
                <div className="uc__pr-font-dd">
                  <input className="uc__pr-font-search" placeholder="搜索字体..." value={fontSearch} onChange={e => setFontSearch(e.target.value)} autoFocus />
                  <div className="uc__pr-font-list">
                    {cn.length > 0 && <div className="uc__pr-font-group">中文字体</div>}
                    {cn.map(renderItem)}
                    {en.length > 0 && <div className="uc__pr-font-group">西文字体</div>}
                    {en.map(renderItem)}
                    {cn.length === 0 && en.length === 0 && <div className="uc__pr-font-empty">无匹配字体</div>}
                  </div>
                </div>
              )
            })()}
          </PropRow>
          <PropRow label="字号">
            <DragNumInput className="uc__pr-num uc__pr-num--w" value={obj.fontSize || 24} min={8} max={200} step={1} onChange={v => apply({ fontSize: v })} />
            <span className="uc__pr-unit">px</span>
          </PropRow>
          <div className="uc__pr-row">
            <span className="uc__pr-lbl">排列</span>
            <div className="uc__pr-seg">
              <button className={`uc__pr-seg-btn${!obj.vertical ? ' uc__pr-seg-btn--on' : ''}`}
                onClick={() => apply({ vertical: false })}>横排</button>
              <button className={`uc__pr-seg-btn${obj.vertical ? ' uc__pr-seg-btn--on' : ''}`}
                onClick={() => apply({ vertical: true })}>竖排</button>
            </div>
            {!obj.vertical && (
              <div className="uc__pr-seg" style={{ marginLeft: 4 }}>
                {[['left', '左'], ['center', '中'], ['right', '右']].map(([v, l]) => (
                  <button key={v} className={`uc__pr-seg-btn${(obj.align || 'left') === v ? ' uc__pr-seg-btn--on' : ''}`}
                    onClick={() => {
                      const changes = { align: v }
                      if (!obj.width) {
                        const stage = window.__ucStage
                        const node = stage?.findOne(`[data-id="${obj.id}"]`)
                        if (node) changes.width = Math.ceil(node.width())
                      }
                      apply(changes)
                    }}>{l}</button>
                ))}
              </div>
            )}
          </div>
          <PropRow label="行高">
            <DragNumInput className="uc__pr-num uc__pr-num--w" value={obj.lineHeight ?? 1.2} min={0.5} max={4} step={0.1} onChange={v => apply({ lineHeight: v })} />
          </PropRow>
          <PropRow label="字距">
            <DragNumInput className="uc__pr-num uc__pr-num--w" value={obj.letterSpacing ?? 0} min={-10} max={50} step={0.5} onChange={v => apply({ letterSpacing: v })} />
            <span className="uc__pr-unit">px</span>
          </PropRow>
          {/* [Eas-Term 移植] 砍掉「文字轮廓化」操作按钮(text → SVG path) */}
        </div>
      )}

      {/* ═══ Effects ═══ */}
      <EffectsSection obj={obj} apply={apply} />
    </div>
  )
}

/* ── Effects sub-panel ── */
function EffectsSection({ obj, apply }) {
  const fx = obj.effects || {}
  const toggle = (key, defaults) => {
    if (fx[key]) { const next = { ...fx }; delete next[key]; apply({ effects: Object.keys(next).length ? next : undefined }) }
    else apply({ effects: { ...fx, [key]: defaults } })
  }
  const upd = (key, changes) => apply({ effects: { ...fx, [key]: { ...fx[key], ...changes } } })

  return (
    <div className="uc__pr-group">
      <div className="uc__pr-head">效果</div>

      {/* Shadow */}
      <div className="uc__pr-row">
        <span className="uc__pr-lbl">投影</span>
        <button className={`uc__pr-sw${!fx.shadow ? ' uc__pr-sw--off' : ''}`}
          onClick={() => toggle('shadow', { color: '#000000', blur: 10, offsetX: 4, offsetY: 4, opacity: 0.2 })}>
          {fx.shadow ? 'ON' : 'OFF'}
        </button>
      </div>
      {fx.shadow && (
        <div className="uc__pr-sub">
          <PropRow label="颜色"><input type="color" className="uc__pr-color" value={fx.shadow.color?.startsWith('#') ? fx.shadow.color : '#000000'} onChange={e => upd('shadow', { color: e.target.value })} /></PropRow>
          <SliderRow label="透明度" value={Math.round((fx.shadow.opacity ?? 0.2) * 100)} min={0} max={100} step={1} unit="%" onChange={v => upd('shadow', { opacity: v / 100 })} />
          <SliderRow label="模糊" value={fx.shadow.blur ?? 10} min={0} max={50} step={1} onChange={v => upd('shadow', { blur: v })} />
          <SliderRow label="X偏移" value={fx.shadow.offsetX ?? 4} min={-30} max={30} step={1} onChange={v => upd('shadow', { offsetX: v })} />
          <SliderRow label="Y偏移" value={fx.shadow.offsetY ?? 4} min={-30} max={30} step={1} onChange={v => upd('shadow', { offsetY: v })} />
        </div>
      )}

      {/* Inner glow */}
      <div className="uc__pr-row">
        <span className="uc__pr-lbl">内发光</span>
        <button className={`uc__pr-sw${!fx.innerGlow ? ' uc__pr-sw--off' : ''}`}
          onClick={() => toggle('innerGlow', { color: '#ffffff', blur: 8, spread: 0, opacity: 0.6 })}>
          {fx.innerGlow ? 'ON' : 'OFF'}
        </button>
      </div>
      {fx.innerGlow && (
        <div className="uc__pr-sub">
          <PropRow label="颜色"><input type="color" className="uc__pr-color" value={fx.innerGlow.color || '#fff'} onChange={e => upd('innerGlow', { color: e.target.value })} /></PropRow>
          <SliderRow label="模糊" value={fx.innerGlow.blur ?? 8} min={0} max={30} step={1} onChange={v => upd('innerGlow', { blur: v })} />
          <SliderRow label="扩展" value={fx.innerGlow.spread ?? 0} min={0} max={20} step={1} onChange={v => upd('innerGlow', { spread: v })} />
        </div>
      )}

      {/* Outer glow */}
      <div className="uc__pr-row">
        <span className="uc__pr-lbl">外发光</span>
        <button className={`uc__pr-sw${!fx.outerGlow ? ' uc__pr-sw--off' : ''}`}
          onClick={() => toggle('outerGlow', { color: '#7c6aed', blur: 15, spread: 0, opacity: 0.6 })}>
          {fx.outerGlow ? 'ON' : 'OFF'}
        </button>
      </div>
      {fx.outerGlow && (
        <div className="uc__pr-sub">
          <PropRow label="颜色"><input type="color" className="uc__pr-color" value={fx.outerGlow.color || '#7c6aed'} onChange={e => upd('outerGlow', { color: e.target.value })} /></PropRow>
          <SliderRow label="模糊" value={fx.outerGlow.blur ?? 15} min={0} max={50} step={1} onChange={v => upd('outerGlow', { blur: v })} />
          <SliderRow label="扩展" value={fx.outerGlow.spread ?? 0} min={0} max={20} step={1} onChange={v => upd('outerGlow', { spread: v })} />
        </div>
      )}
    </div>
  )
}
