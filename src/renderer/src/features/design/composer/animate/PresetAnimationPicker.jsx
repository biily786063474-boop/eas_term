/**
 * PresetAnimationPicker — modal that lets the user attach a preset animation
 * (filter layer) to the currently-selected layer in MotionComposer.
 *
 * Stages: enter / continuous / exit (and per-character variants for text layers).
 * Hover on a preset card triggers a small canvas demo; click applies it.
 * The bottom strip shows the active stage's params (duration / strength / speed).
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { PRESETS_LIB, getPresetMeta, supportsTextChar } from './presets'
import { applyPresetDelta } from './presetEngine'
import './PresetAnimationPicker.css'

const STAGE_TABS = [
  { key: 'enter', label: '入场' },
  { key: 'continuous', label: '持续' },
  { key: 'exit', label: '出场' },
  { key: 'textChar', label: '字符' }, // shown only for text layers
]

const CATEGORY_LABELS = {
  basic: '基础',
  bouncy: '弹性',
  dramatic: '强调',
  elegant: '柔和',
  playful: '俏皮',
  subtle: '轻微',
  continuous: '连续',
  attention: '吸睛',
  classic: '经典',
}

function fmtNum(v, digits = 2) {
  if (v == null || isNaN(v)) return '0'
  return Number(v).toFixed(digits).replace(/\.?0+$/, '')
}

// Base props the demo canvas starts from (a centered 16x16 unit).
const DEMO_BASE = Object.freeze({
  x: 16, y: 16, opacity: 1, rotation: 0, scaleX: 1, scaleY: 1, width: 16, height: 16,
})

// Build a fake layer the engine can consume, with one preset attached.
function buildDemoLayer(stage, name, params, layerType = 'rect') {
  const presets = { enter: null, continuous: null, exit: null }
  // textChar stage piggybacks on `enter` slot for demo (engine routes by name)
  const targetStage = (stage === 'textChar') ? 'enter' : stage
  presets[targetStage] = { name, ...params }
  return {
    id: 'demo', type: layerType,
    base: { x: 16, y: 16, opacity: 1, rotation: 0, scaleX: 1, scaleY: 1 },
    inPoint: 0, outPoint: 3,
    keyframes: {},
    presets,
  }
}

// Render one frame of the mini demo canvas at time `t`.
function renderDemo(canvas, stage, name, params, layerType) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  // Backdrop hint
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.fillRect(0, 0, W, H)

  const layer = buildDemoLayer(stage, name, params, layerType)
  const t = params.__t ?? 0
  const props = applyPresetDelta(DEMO_BASE, layer, t, 3)

  // Clamp opacity for visible signal even when preset would zero it
  const op = Math.max(0.05, Math.min(1, props.opacity ?? 1))
  ctx.globalAlpha = op

  // Draw a tiny "subject" centered, with the preset transform applied.
  const cx = W / 2 + (props.x - DEMO_BASE.x)
  const cy = H / 2 + (props.y - DEMO_BASE.y)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((props.rotation || 0) * Math.PI / 180)
  ctx.scale(props.scaleX || 1, props.scaleY || 1)
  if (layerType === 'text') {
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 14px sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText('Aa', 0, 0)
  } else {
    ctx.fillStyle = '#7c6aed'
    ctx.beginPath()
    ctx.roundRect(-9, -7, 18, 14, 3)
    ctx.fill()
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

// Single preset card — wraps a small canvas + label + RAF on hover.
function PresetCard({ stage, name, meta, layerType, active, onPick }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const startRef = useRef(0)
  const [hovering, setHovering] = useState(false)

  // Demo total length: enter+exit ~ 1.5s, continuous a single loop period
  const demoDuration = useMemo(() => {
    if (stage === 'continuous') return Math.max(1.0, meta.loopDuration || 1.5)
    return Math.max(0.8, (meta.defaultDuration || 0.6) * 1.6)
  }, [stage, meta])

  // Default params used by the demo (matches what the store will apply on click)
  const demoParams = useMemo(() => {
    const p = {}
    if (stage === 'enter') { p.duration = meta.defaultDuration ?? 0.6; p.delay = 0; p.strength = 1 }
    else if (stage === 'exit') { p.duration = meta.defaultDuration ?? 0.5; p.strength = 1 }
    else if (stage === 'continuous') { p.speed = 1; p.strength = 1 }
    else if (stage === 'textChar') { p.duration = meta.defaultDuration ?? 0.5; p.delay = 0; p.strength = 1 }
    return p
  }, [stage, meta])

  // Render an idle (start-state) frame on mount
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    renderDemo(c, stage, name, { ...demoParams, __t: 0 }, layerType)
  }, [name, stage, demoParams, layerType])

  // Drive a RAF loop while hovering
  useEffect(() => {
    if (!hovering) return
    const c = canvasRef.current
    if (!c) return
    startRef.current = performance.now()
    const tick = (now) => {
      const elapsed = (now - startRef.current) / 1000
      const t = elapsed % (demoDuration + 0.2)
      renderDemo(c, stage, name, { ...demoParams, __t: t }, layerType)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [hovering, stage, name, demoParams, demoDuration, layerType])

  return (
    <button
      className={`pap-card${active ? ' pap-card--on' : ''}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => onPick(name)}
      data-tip={meta.label}
    >
      <canvas ref={canvasRef} width={72} height={48} className="pap-card-canvas" />
      <div className="pap-card-label">{meta.label}</div>
    </button>
  )
}

export default function PresetAnimationPicker({ layer, initialStage = 'enter', onClose, store }) {
  const [stage, setStage] = useState(initialStage)
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')

  // Backdrop close
  const onBackdropMouseDown = (e) => { if (e.target === e.currentTarget) onClose?.() }

  // Esc to close
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])

  // Available stage tabs (textChar only when layer is text)
  const tabs = useMemo(() => {
    return STAGE_TABS.filter(t => t.key !== 'textChar' || supportsTextChar(layer?.type))
  }, [layer?.type])

  // Resolve preset entries for this stage, filtered by layer type
  const stageEntries = useMemo(() => {
    const map = PRESETS_LIB[stage] || {}
    const out = []
    for (const [name, meta] of Object.entries(map)) {
      if (layer?.type && meta.layerTypes && meta.layerTypes.length
          && !meta.layerTypes.includes('all')
          && !meta.layerTypes.includes(layer.type)) continue
      out.push({ name, ...meta })
    }
    return out
  }, [stage, layer?.type])

  // Build the category list dynamically
  const categories = useMemo(() => {
    const set = new Set(['all'])
    for (const e of stageEntries) set.add(e.category || 'basic')
    return [...set]
  }, [stageEntries])

  // Filter by category + search
  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stageEntries.filter(e => {
      if (category !== 'all' && (e.category || 'basic') !== category) return false
      if (!q) return true
      return (e.name + ' ' + (e.label || '')).toLowerCase().includes(q)
    })
  }, [stageEntries, category, search])

  // What's currently attached on the layer for this stage
  const slot = stage === 'textChar' ? 'enter' : stage
  const activeCfg = layer?.presets?.[slot]
  const activeName = activeCfg?.name
  // Only consider it "active" for this tab if it actually belongs to this stage
  const activeIsThisStage = !!activeCfg && !!PRESETS_LIB[stage]?.[activeCfg.name]

  // Apply / clear / param updates
  const onPick = useCallback((name) => {
    if (!layer || !store) return
    store.pushUndo?.()
    store.setLayerPreset(layer.id, slot, name)
  }, [layer, slot, store])

  const onClear = useCallback(() => {
    if (!layer || !store) return
    store.pushUndo?.()
    store.clearLayerPreset(layer.id, slot)
  }, [layer, slot, store])

  const onParam = useCallback((key, val) => {
    if (!layer || !store) return
    store.updateLayerPresetParam(layer.id, slot, key, val)
  }, [layer, slot, store])

  // The active preset's metadata (for showing the right param controls)
  const activeMeta = activeIsThisStage ? PRESETS_LIB[stage][activeCfg.name] : null
  const paramSpec = activeMeta?.paramsSpec || {}

  return (
    <div className="pap-backdrop" onMouseDown={onBackdropMouseDown}>
      <div className="pap-modal" role="dialog" aria-label="预设动画">
        <div className="pap-head">
          <div className="pap-title">预设动画</div>
          <div className="pap-hint">{layer ? `图层 · ${layer.name}` : '请先选择图层'}</div>
          <div className="pap-spacer" />
          <button className="pap-close" onClick={() => onClose?.()} data-tip="关闭 (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Stage tabs */}
        <div className="pap-tabs">
          {tabs.map(t => (
            <button key={t.key}
              className={`pap-tab${stage === t.key ? ' pap-tab--on' : ''}`}
              onClick={() => { setStage(t.key); setCategory('all') }}>
              {t.label}
              {layer?.presets?.[t.key === 'textChar' ? 'enter' : t.key]
                && PRESETS_LIB[t.key]?.[layer.presets[t.key === 'textChar' ? 'enter' : t.key].name]
                && <span className="pap-tab-dot" />}
            </button>
          ))}
        </div>

        {/* Category filter + search */}
        <div className="pap-toolbar">
          <div className="pap-cats">
            {categories.map(c => (
              <button key={c}
                className={`pap-cat${category === c ? ' pap-cat--on' : ''}`}
                onClick={() => setCategory(c)}>
                {c === 'all' ? '全部' : (CATEGORY_LABELS[c] || c)}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="pap-search"
            placeholder="搜索预设..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Card grid */}
        <div className="pap-grid">
          {visibleEntries.length === 0 && <div className="pap-empty">该图层类型暂无可用预设</div>}
          {visibleEntries.map(e => (
            <PresetCard
              key={e.name}
              stage={stage}
              name={e.name}
              meta={e}
              layerType={layer?.type || 'rect'}
              active={activeIsThisStage && activeName === e.name}
              onPick={onPick}
            />
          ))}
        </div>

        {/* Param strip */}
        <div className="pap-params">
          {activeMeta ? (
            <>
              <div className="pap-param-title">
                当前 · <strong>{activeMeta.label}</strong>
              </div>
              {('duration' in (activeCfg || {})) && paramSpec.duration && (
                <ParamSlider label="时长" unit="秒" spec={paramSpec.duration}
                  value={activeCfg.duration} onChange={v => onParam('duration', v)} step={0.05} />
              )}
              {('speed' in (activeCfg || {})) && paramSpec.speed && (
                <ParamSlider label="速度" unit="×" spec={paramSpec.speed}
                  value={activeCfg.speed} onChange={v => onParam('speed', v)} step={0.05} />
              )}
              {('strength' in (activeCfg || {})) && paramSpec.strength && (
                <ParamSlider label="强度" unit="" spec={paramSpec.strength}
                  value={activeCfg.strength} onChange={v => onParam('strength', v)} step={0.05} />
              )}
              {('delay' in (activeCfg || {})) && paramSpec.delay && (
                <ParamSlider label="延迟" unit="秒" spec={paramSpec.delay}
                  value={activeCfg.delay} onChange={v => onParam('delay', v)} step={0.05} />
              )}
              <button className="pap-clear" onClick={onClear}>清除该阶段</button>
            </>
          ) : (
            <div className="pap-param-empty">点击卡片为图层应用预设动画。Hover 卡片可预览。</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ParamSlider({ label, unit, spec, value, onChange, step = 0.05 }) {
  const v = value == null ? spec.default : value
  return (
    <label className="pap-slider">
      <span className="pap-slider-label">{label}</span>
      <input type="range"
        min={spec.min} max={spec.max} step={step}
        value={v}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
      <span className="pap-slider-val">{fmtNum(v, 2)}{unit}</span>
    </label>
  )
}
