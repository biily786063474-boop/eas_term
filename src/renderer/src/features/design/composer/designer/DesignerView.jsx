/**
 * DesignComposer — Full-screen design workspace (Figma-like)
 * Isolation: self-contained, does NOT import from Canvas/Node.
 * Uses Konva (react-konva) for vector editing.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import KonvaCanvas, { penNodesToPathD } from './KonvaCanvas'
import { pathDToPenNodes } from './pathToPen'
import Toolbar from './Toolbar'
import PropertiesPanel from './PropertiesPanel'
import LayersPanel from './LayersPanel'
import ExportDialog from './ExportDialog'
import ContextMenu from './ContextMenu'
import { useUnifiedDesignStore } from './store'
// [Eas-Term 移植] 砍掉「组件库 / 存为组件」—— 依赖 taptv 专有的 utils/designComponentStorage
// （760 行，双模式存储，还牵一个 fileStorage）。本项目的文件写入要过 fsGuard，
// 不是拷过来就能用，单独评估。其余设计功能（钢笔 / 布尔运算 / 文字轮廓化 / SVG 导入）已全部恢复。
import { CANVAS_PRESETS } from './constants'
import {
  unite, intersect, subtract, exclude,
  polygonToPathD, multiPolyBBox, BOOLEAN_SUPPORTED_TYPES,
} from './shapeBoolean'
import './styles.css'

function GridSliders({ gridType, setGridConfig }) {
  const [split, setSplit] = useState(false)
  const gs = useUnifiedDesignStore(s => s.gridSize)
  const gsY = useUnifiedDesignStore(s => s.gridSizeY)
  const cols = useUnifiedDesignStore(s => s.gridColumns)
  const rows = useUnifiedDesignStore(s => s.gridRows)

  if (gridType === 'grid') {
    const effectiveY = gsY || gs
    return (
      <div className="uc__grid-sliders">
        <input type="range" className="uc__grid-slider" min={10} max={200} step={5}
          value={gs} onChange={e => setGridConfig(split ? { gridSize: +e.target.value } : { gridSize: +e.target.value, gridSizeY: 0 })}
          data-tip={`X: ${gs}px`} />
        {split && (
          <input type="range" className="uc__grid-slider" min={10} max={200} step={5}
            value={effectiveY} onChange={e => setGridConfig({ gridSizeY: +e.target.value })}
            data-tip={`Y: ${effectiveY}px`} />
        )}
        <button className={`uc__grid-split-btn${split ? ' uc__grid-split-btn--on' : ''}`}
          onClick={() => { setSplit(v => !v); if (split) setGridConfig({ gridSizeY: 0 }) }}
          data-tip={split ? 'XY 合并' : 'XY 拆分'}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {split ? <><line x1="12" y1="2" x2="12" y2="22"/><polyline points="8 6 12 2 16 6"/><polyline points="8 18 12 22 16 18"/></>
              : <><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></>}
          </svg>
        </button>
      </div>
    )
  }
  if (gridType === 'columns') {
    return (
      <div className="uc__grid-sliders">
        <input type="range" className="uc__grid-slider" min={20} max={240} step={10}
          value={cols * 10} onChange={e => {
            const c = Math.max(2, Math.min(24, Math.round(+e.target.value / 10)))
            setGridConfig({ gridColumns: c, gridGutter: Math.max(4, Math.round(80 / c)) })
          }} data-tip={`${cols} 栏`} />
      </div>
    )
  }
  if (gridType === 'modular') {
    return (
      <div className="uc__grid-sliders">
        <input type="range" className="uc__grid-slider" min={20} max={160} step={10}
          value={cols * 10} onChange={e => {
            const n = Math.max(2, Math.min(16, Math.round(+e.target.value / 10)))
            setGridConfig(split ? { gridColumns: n } : { gridColumns: n, gridRows: n })
          }} data-tip={`列: ${cols}`} />
        {split && (
          <input type="range" className="uc__grid-slider" min={20} max={160} step={10}
            value={rows * 10} onChange={e => {
              const n = Math.max(2, Math.min(16, Math.round(+e.target.value / 10)))
              setGridConfig({ gridRows: n })
            }} data-tip={`行: ${rows}`} />
        )}
        <button className={`uc__grid-split-btn${split ? ' uc__grid-split-btn--on' : ''}`}
          onClick={() => { setSplit(v => !v); if (split) setGridConfig({ gridRows: cols }) }}
          data-tip={split ? '行列合并' : '行列拆分'}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {split ? <><line x1="12" y1="2" x2="12" y2="22"/><polyline points="8 6 12 2 16 6"/><polyline points="8 18 12 22 16 18"/></>
              : <><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></>}
          </svg>
        </button>
      </div>
    )
  }
  return null
}

function AdjustAdvanced({ sliders, toggles, adj, applyAdj, pushUndo, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <>
      <button className="uc__adjust-advanced-btn" onClick={() => setOpen(v => !v)}>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>
          <polyline points="9 6 15 12 9 18"/>
        </svg>
        高级效果
      </button>
      {open && (
        <>
          {sliders.map(s => {
            const val = adj[s.key] ?? s.default
            return (
              <div key={s.key} className="uc__adjust-row">
                <span className="uc__adjust-label">{s.label}</span>
                <input type="range" className="uc__adjust-slider" min={s.min} max={s.max} step={s.step} value={val}
                  onChange={e => applyAdj(s.key, parseFloat(e.target.value))}
                  onMouseDown={(e) => { e.stopPropagation(); pushUndo() }} />
                <span className="uc__adjust-val">{typeof val === 'number' ? (Number.isInteger(val) ? val : val.toFixed(2)) : val}</span>
              </div>
            )
          })}
          <div className="uc__adjust-toggles">
            {toggles.map(t => (
              <button key={t.key}
                className={`uc__adjust-toggle ${adj[t.key] ? 'uc__adjust-toggle--active' : ''}`}
                onClick={() => { pushUndo(); applyAdj(t.key, !adj[t.key]) }}>
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function GuidePanel({ gridType, setGridType, setGridConfig, colorGrid, colorGridColors }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const hasAny = !!gridType || !!colorGrid

  useEffect(() => {
    if (!open) return
    const fn = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', fn, true)
    return () => document.removeEventListener('mousedown', fn, true)
  }, [open])

  // Position panel below button
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 8, left: r.left + r.width / 2 - 120 })
  }, [open])

  return (
    <>
      <button ref={btnRef} className={`uc__topbar-btn${hasAny ? ' uc__topbar-btn--active' : ''}`}
        onClick={() => setOpen(v => !v)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
        </svg>
        <span style={{ fontSize: 11, marginLeft: 3 }}>辅助</span>
      </button>
      {open && createPortal(
        <div ref={panelRef} className="uc__guide-panel" style={{ top: pos.top, left: pos.left }}>
          <div className="uc__guide-section">
            <div className="uc__guide-head">版式网格</div>
            <div className="uc__guide-chips">
              {[
                { v: null, l: '关闭' },
                { v: 'grid', l: '方格' },
                { v: 'columns', l: '栏式' },
                { v: 'modular', l: '模块' },
              ].map(o => (
                <button key={o.l} className={`uc__guide-chip${gridType === o.v ? ' uc__guide-chip--on' : ''}`}
                  onClick={() => setGridType(o.v)}>{o.l}</button>
              ))}
            </div>
            {gridType && <GridSliders gridType={gridType} setGridConfig={setGridConfig} />}
          </div>

          <div className="uc__guide-section">
            <div className="uc__guide-head">色块比例 3:6:1</div>
            <div className="uc__guide-chips">
              {[
                { v: null, l: '关闭' },
                { v: 'horizontal', l: '横排' },
                { v: 'vertical', l: '竖排' },
              ].map(o => (
                <button key={o.l} className={`uc__guide-chip${colorGrid === o.v ? ' uc__guide-chip--on' : ''}`}
                  onClick={() => useUnifiedDesignStore.setState({ colorGrid: o.v })}>{o.l}</button>
              ))}
            </div>
            {colorGrid && (
              <div className="uc__guide-colors">
                {['30%', '60%', '10%'].map((label, i) => (
                  <label key={i} className="uc__guide-color-item">
                    <input type="color" value={colorGridColors[i]}
                      onChange={e => {
                        const next = [...colorGridColors]
                        next[i] = e.target.value
                        useUnifiedDesignStore.setState({ colorGridColors: next })
                      }} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

const TYPE_LABELS = { rect: '矩形', ellipse: '椭圆', line: '线条', pen: '路径', text: '文字', image: '图片', path: '路径', star: '星形', polygon: '多边形', canvas: '画板' }

export default function DesignerView({ nodeId, savedState, mediaInputs = [], onExport, onClose, onSaveState, topbarCenter }) {
  const [showExport, setShowExport] = useState(false)
  const [showLayers, setShowLayers] = useState(true)
  // [Eas-Term 移植] 组件库砍掉后只剩「图层」一个 tab，leftTab 留着是为了保住那颗按钮的
  // 选中样式（uc__left-tab--on）——只有一个 tab 时它恒为 on，改成写死反而要动样式。
  // saveCompName / saveCompTags / showSaveComp 三个状态随「存为组件」一起删了。
  const [leftTab, setLeftTab] = useState('layers')
  const [showCanvasPicker, setShowCanvasPicker] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)
  const [adjustPos, setAdjustPos] = useState(null) // { x, y } or null = default position
  const adjustDragRef = useRef(null) // drag state
  const [mediaPreview, setMediaPreview] = useState(null) // { url, x, y }
  // Painting state
  const [paintMode, setPaintMode] = useState(false)
  const [brushSize, setBrushSize] = useState(6)
  const [brushColor, setBrushColor] = useState('#000000')
  const [brushTool, setBrushTool] = useState('brush') // 'brush' | 'eraser'
  const [brushCursor, setBrushCursor] = useState(null) // { x, y } screen coords for cursor circle
  const paintCanvasRef = useRef(null) // offscreen canvas for painting
  const paintUndoStack = useRef([]) // ImageData snapshots
  const paintingRef = useRef(false) // is currently drawing
  const brushResizeRef = useRef(null) // { startX, startSize } for Alt+RMB resize
  const canvasRef = useRef(null)
  const canvasBtnRef = useRef(null)
  const loadedMediaRef = useRef(false)

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState(null) // { x, y } in viewport coords
  // In-memory clipboard — array of object descriptors (deep-cloned, ids stripped)
  const clipboardRef = useRef(null)
  // Latest keyboard handlers (filled by an effect after handlers are defined,
  // so the keyboard listener never closes over stale callbacks)
  const kbHandlersRef = useRef(null)

  const {
    canvasWidth, canvasHeight, zoom, setZoom, setCanvasSize,
    undo, redo, canUndo, canRedo,
    reset, restore, serialize, pushUndo, setActiveTool, alignObjects,
    setBackgroundColor, backgroundColor,
    objects, selectedIds, setSelectedIds,
    addObject, removeObject, updateObject,
    groupObjects, ungroupObject, createMask, outlineText, reorderObject,
    gridType, setGridType, setGridConfig,
    colorGrid, colorGridColors,
  } = useUnifiedDesignStore()

  // On mount: restore or reset
  useEffect(() => {
    loadedMediaRef.current = false
    if (savedState && savedState.objects?.length) {
      restore(savedState)
      loadedMediaRef.current = true
    } else {
      reset()
    }
  }, [nodeId]) // eslint-disable-line

  // Auto-load upstream images (only on fresh open)
  useEffect(() => {
    if (loadedMediaRef.current) return
    const images = mediaInputs.filter(m => m.type === 'image' && m.url)
    if (!images.length) return

    const timer = setTimeout(() => {
      if (loadedMediaRef.current) return
      loadedMediaRef.current = true
      const { canvasWidth: cw, canvasHeight: ch } = useUnifiedDesignStore.getState()

      images.forEach((m, i) => {
        const imgEl = new Image()
        imgEl.crossOrigin = 'anonymous'
        imgEl.onload = () => {
          const scale = Math.min(cw * 0.7 / imgEl.width, ch * 0.7 / imgEl.height, 1)
          useUnifiedDesignStore.getState().addObject({
            type: 'image',
            x: 20 + i * 30,
            y: 20 + i * 30,
            width: imgEl.width * scale,
            height: imgEl.height * scale,
            src: m.url,
            fill: '',
            stroke: '',
            strokeWidth: 0,
          })
        }
        imgEl.src = m.url
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [mediaInputs]) // eslint-disable-line

  // Auto-save: debounce 500ms
  const saveTimerRef = useRef(null)
  useEffect(() => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      onSaveState?.(useUnifiedDesignStore.getState().serialize())
    }, 500)
    return () => clearTimeout(saveTimerRef.current)
  }, [objects, canvasWidth, canvasHeight, onSaveState])

  const handleClose = useCallback(() => {
    clearTimeout(saveTimerRef.current)
    onSaveState?.(serialize())
    onClose?.()
  }, [onClose, onSaveState, serialize])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation()
        // KonvaCanvas handles delete internally
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); undo()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); redo()
      }

      // Clipboard — read from latest refs so we don't capture stale closures
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault(); e.stopPropagation(); kbHandlersRef.current?.copy()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault(); e.stopPropagation(); kbHandlersRef.current?.cut()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V') && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); kbHandlersRef.current?.paste()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault(); e.stopPropagation(); kbHandlersRef.current?.duplicate()
      }

      if (!e.metaKey && !e.ctrlKey) {
        // V: deselect canvas layer / switch to select tool
        if (e.key === 'v' || e.key === 'V') {
          e.stopPropagation()
          if (paintMode) { setSelectedIds([]); setPaintMode(false) }
          setActiveTool('select')
        }
        if (e.key === 'r' || e.key === 'R') { e.stopPropagation(); setActiveTool('rect') }
        if (e.key === 'o' || e.key === 'O') { e.stopPropagation(); setActiveTool('ellipse') }
        if (e.key === 't' || e.key === 'T') { e.stopPropagation(); setActiveTool('text') }
        if (e.key === 'p' || e.key === 'P') { e.stopPropagation(); setActiveTool('pen') }
        if (e.key === 'l' || e.key === 'L') { e.stopPropagation(); setActiveTool('line') }

        // B/E: switch to brush/eraser — auto-select or create canvas layer
        if (e.key === 'b' || e.key === 'B' || e.key === 'e' || e.key === 'E') {
          e.stopPropagation()
          const tool = (e.key === 'b' || e.key === 'B') ? 'brush' : 'eraser'
          setBrushTool(tool)
          const cl = findCanvasLayer()
          if (cl) {
            // Select the canvas layer if not already
            if (!selectedIds.includes(cl.id)) setSelectedIds([cl.id])
          } else {
            // No canvas layer — prompt to create
            if (window.confirm('当前没有画板图层，是否创建一个？')) {
              createAndSelectCanvasLayer()
            }
          }
        }
      }

      // Alt + key: alignment (Figma shortcuts) — use e.code because Alt changes e.key on macOS
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const map = { KeyA: 'left', KeyH: 'center-h', KeyD: 'right', KeyW: 'top', KeyV: 'center-v', KeyS: 'bottom' }
        const dir = map[e.code]
        if (dir) { e.preventDefault(); e.stopPropagation(); pushUndo(); alignObjects(dir); return }
      }

      // Ctrl+E / Cmd+E: Pathfinder default action (Unite) — Illustrator Shape Builder shortcut
      // Phase 1 MVP: triggers Unite on 2+ selected shapes (most common use case).
      // Phase 2: will toggle Shape Builder tool mode for hover/drag merge.
      // Note: Cmd+M creates mask (handled in KonvaCanvas) — Ctrl+E avoids that collision.
      // preventDefault is critical: browsers bind Ctrl+E to focus address bar / search.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault(); e.stopPropagation()
        kbHandlersRef.current?.applyBoolean?.('unite')
        return
      }

      if (e.key === 'Escape') {
        e.stopPropagation()
        if (showCanvasPicker) setShowCanvasPicker(false)
        else handleClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, handleClose, setActiveTool, showCanvasPicker, pushUndo, alignObjects])

  // Add image from sidebar
  const addImageFromUrl = useCallback((url) => {
    pushUndo()
    const imgEl = new Image()
    imgEl.crossOrigin = 'anonymous'
    imgEl.onload = () => {
      const scale = Math.min(canvasWidth * 0.8 / imgEl.width, canvasHeight * 0.8 / imgEl.height, 1)
      const id = addObject({
        type: 'image', x: 50, y: 50,
        width: imgEl.width * scale, height: imgEl.height * scale,
        src: url, fill: '', stroke: '', strokeWidth: 0,
      })
      setSelectedIds([id])
    }
    imgEl.src = url
  }, [canvasWidth, canvasHeight, pushUndo, addObject, setSelectedIds])

  const handleExport = useCallback((blob, format) => {
    onExport?.(blob, format)
  }, [onExport])

  // Canvas preset
  const handleCanvasPresetSelect = useCallback((preset) => {
    pushUndo()
    setCanvasSize(preset.w, preset.h)
    setShowCanvasPicker(false)
  }, [pushUndo, setCanvasSize])

  // Selected object for floating bar — also searches inside groups/masks
  let selectedObj = selectedIds.length === 1 ? objects.find(o => o.id === selectedIds[0]) : null
  let _selectedParentId = null
  if (!selectedObj && selectedIds.length === 1) {
    for (const o of objects) {
      if (o.children) {
        const child = o.children.find(c => c.id === selectedIds[0])
        if (child) { selectedObj = child; _selectedParentId = o.id; break }
      }
    }
  }
  const [editingId, setEditingId] = useState(null) // id of object in anchor edit mode

  // Close adjust panel when selection changes away from image
  useEffect(() => {
    if (!selectedObj || selectedObj.type !== 'image') setShowAdjust(false)
  }, [selectedObj?.id, selectedObj?.type]) // eslint-disable-line

  // Auto-enter/exit paint mode when canvas layer is selected
  const isCanvasLayer = selectedObj?.type === 'canvas'
  useEffect(() => {
    if (isCanvasLayer) {
      setPaintMode(true)
      if (!paintCanvasRef.current) {
        const c = document.createElement('canvas')
        c.width = selectedObj.width || canvasWidth
        c.height = selectedObj.height || canvasHeight
        if (selectedObj._canvasData) {
          const img = new Image()
          img.onload = () => {
            c.getContext('2d').drawImage(img, 0, 0)
            // Attach live canvas for direct Konva rendering
            updateObject(selectedObj.id, { _liveCanvas: c })
          }
          img.src = selectedObj._canvasData
        } else {
          updateObject(selectedObj.id, { _liveCanvas: c })
        }
        paintCanvasRef.current = c
        paintUndoStack.current = []
      }
    } else {
      if (paintMode && paintCanvasRef.current) {
        // Persist to dataURL and detach live canvas before leaving
        const prevId = useUnifiedDesignStore.getState().objects.find(o => o._liveCanvas)?.id
        if (prevId && paintCanvasRef.current) {
          updateObject(prevId, { _canvasData: paintCanvasRef.current.toDataURL('image/png'), _liveCanvas: null })
        }
        setPaintMode(false)
        paintCanvasRef.current = null
        paintUndoStack.current = []
      }
    }
  }, [isCanvasLayer]) // eslint-disable-line

  // Convert screen pointer to offscreen canvas coordinates
  const pointerToCanvas = useCallback((e) => {
    const stage = canvasRef.current?.getStage?.()
    if (!stage) return { x: 0, y: 0 }
    const rect = stage.container().getBoundingClientRect()
    const sx = stage.scaleX(), sy = stage.scaleY()
    const stX = stage.x(), stY = stage.y()
    return {
      x: (e.clientX - rect.left - stX) / sx - (selectedObj?.x || 0),
      y: (e.clientY - rect.top - stY) / sy - (selectedObj?.y || 0),
    }
  }, [selectedObj?.x, selectedObj?.y])

  // Flush live canvas to Konva (just batchDraw, no toDataURL)
  const flushPaintToKonva = useCallback(() => {
    const stage = canvasRef.current?.getStage?.()
    if (stage) stage.findOne('Layer')?.batchDraw()
  }, [])

  const startPaint = useCallback((e) => {
    const c = paintCanvasRef.current
    if (!c || !paintMode) return
    const ctx = c.getContext('2d')
    paintUndoStack.current.push(ctx.getImageData(0, 0, c.width, c.height))
    if (paintUndoStack.current.length > 30) paintUndoStack.current.shift()

    paintingRef.current = true
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.globalCompositeOperation = brushTool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = brushTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor
    const pressure = e.pressure || 0.5
    ctx.lineWidth = brushSize * (0.5 + pressure)
    ctx.beginPath()
    const p = pointerToCanvas(e)
    ctx.moveTo(p.x, p.y)
  }, [paintMode, brushSize, brushColor, brushTool, pointerToCanvas])

  const movePaint = useCallback((e) => {
    if (!paintingRef.current || !paintCanvasRef.current) return
    const ctx = paintCanvasRef.current.getContext('2d')
    const p = pointerToCanvas(e)
    const pressure = e.pressure || 0.5
    ctx.lineWidth = brushSize * (0.5 + pressure)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    flushPaintToKonva() // instant — just triggers Konva redraw, no encoding
  }, [brushSize, pointerToCanvas, flushPaintToKonva])

  const endPaint = useCallback(() => {
    if (!paintingRef.current) return
    paintingRef.current = false
    flushPaintToKonva()
    // Persist to dataURL only on stroke end (expensive but infrequent)
    const c = paintCanvasRef.current
    if (c && selectedObj) updateObject(selectedObj.id, { _canvasData: c.toDataURL('image/png') })
  }, [selectedObj?.id, updateObject, flushPaintToKonva])

  const undoPaint = useCallback(() => {
    const c = paintCanvasRef.current
    if (!c || !paintUndoStack.current.length) return
    c.getContext('2d').putImageData(paintUndoStack.current.pop(), 0, 0)
    flushPaintToKonva()
    if (selectedObj) updateObject(selectedObj.id, { _canvasData: c.toDataURL('image/png') })
  }, [selectedObj?.id, updateObject, flushPaintToKonva])

  // Paint keyboard shortcuts: B = brush, E = eraser (global — auto-select canvas layer)
  // V = deselect canvas layer and return to select tool
  const findCanvasLayer = useCallback(() => {
    return useUnifiedDesignStore.getState().objects.find(o => o.type === 'canvas')
  }, [])

  const createAndSelectCanvasLayer = useCallback(() => {
    const store = useUnifiedDesignStore.getState()
    pushUndo()
    const id = store.addObject({
      type: 'canvas', x: 0, y: 0,
      width: store.canvasWidth, height: store.canvasHeight,
      fill: '', stroke: '', strokeWidth: 0, _canvasData: null,
    })
    // Move to top
    const objs = useUnifiedDesignStore.getState().objects
    store.reorderObject(id, objs.length - 1)
    setSelectedIds([id])
    return id
  }, [pushUndo, setSelectedIds])

  // Alt + Right-click drag to resize brush
  const handleOverlayPointerDown = useCallback((e) => {
    if (e.altKey && e.button === 2) {
      e.preventDefault()
      brushResizeRef.current = { startX: e.clientX, startSize: brushSize, anchorX: e.clientX, anchorY: e.clientY }
      // Lock cursor at click position during resize
      setBrushCursor({ x: e.clientX, y: e.clientY })
      return
    }
    startPaint(e)
  }, [startPaint, brushSize])

  const handleOverlayPointerMove = useCallback((e) => {
    if (brushResizeRef.current) {
      // Alt+RMB dragging: adjust size, cursor stays at anchor
      const dx = e.clientX - brushResizeRef.current.startX
      const newSize = Math.max(1, Math.min(100, Math.round(brushResizeRef.current.startSize + dx * 0.5)))
      setBrushSize(newSize)
      return
    }
    // Normal: cursor follows mouse
    setBrushCursor({ x: e.clientX, y: e.clientY })
    movePaint(e)
  }, [movePaint])

  const handleOverlayPointerUp = useCallback((e) => {
    if (brushResizeRef.current) { brushResizeRef.current = null; return }
    endPaint()
  }, [endPaint])

  // Convert an SVG-imported `path` object into an editable `pen` object so its
  // anchors can be edited. Q / A / shorthand commands are normalized to cubic
  // segments, which may produce sub-pixel coordinate shifts — we confirm with
  // the user before committing the conversion.
  // (Defined before enterEditMode so the latter can reference it in its deps.)
  const handleConvertPathToPen = useCallback(() => {
    if (!selectedObj || selectedObj.type !== 'path' || selectedObj.penNodes?.length) return

    const proceed = window.confirm(
      '将此 SVG 路径转换为可编辑锚点。\n\n' +
      '⚠️ 可能有微小精度损失(SVG 中的 Q / A 等命令会被转换为 C 三次贝塞尔)。\n\n' +
      '继续吗?'
    )
    if (!proceed) return

    let penNodes
    try {
      penNodes = pathDToPenNodes(selectedObj.data || '')
    } catch (e) {
      window.alert(`路径解析失败:${e?.message || e}\n\n这通常是因为 SVG 包含不支持的命令。`)
      return
    }
    if (!penNodes.length) {
      window.alert('SVG 路径解析为空,无法转换。')
      return
    }

    pushUndo()
    // Rebuild `data` from the freshly-converted penNodes so the rendered shape
    // and the d-string stay in lockstep going forward (subsequent anchor edits
    // continue to rewrite both fields together — see addAnchor / removeAnchor).
    const newData = penNodesToPathD(penNodes)
    updateObject(selectedObj.id, { type: 'pen', penNodes, data: newData })
    setEditingId(selectedObj.id)
  }, [selectedObj, pushUndo, updateObject])

  // Enter anchor editing — convert shape to editable polygon (line with closed=true)
  const enterEditMode = useCallback(() => {
    if (!selectedObj) return
    const obj = selectedObj

    // Pen objects already have penNodes — enter edit directly (lossless, same as
    // double-clicking on the canvas).
    if (obj.type === 'pen' && obj.penNodes?.length) {
      setEditingId(obj.id)
      return
    }

    // SVG-imported path: no penNodes yet. Route through the confirm + convert
    // flow (handleConvertPathToPen handles confirm, parse, pushUndo, setEditingId).
    if (obj.type === 'path' && !obj.penNodes?.length) {
      handleConvertPathToPen()
      return
    }

    let points = []

    if (obj.type === 'rect') {
      const w = obj.width || 100, h = obj.height || 100
      const r = Math.min(obj.cornerRadius || 0, w / 2, h / 2)
      if (r > 0) {
        // Approximate rounded rect with 8 points
        points = [r, 0, w - r, 0, w, r, w, h - r, w - r, h, r, h, 0, h - r, 0, r]
      } else {
        points = [0, 0, w, 0, w, h, 0, h]
      }
    } else if (obj.type === 'ellipse') {
      const rx = obj.radiusX || (obj.width || 100) / 2
      const ry = obj.radiusY || (obj.height || 100) / 2
      const n = 12 // 12-point approximation
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n
        points.push(Math.round(rx + rx * Math.cos(a)), Math.round(ry + ry * Math.sin(a)))
      }
    } else if (obj.type === 'line' && obj.points) {
      // Already a line — edit directly
      setEditingId(obj.id)
      return
    } else {
      return // Can't edit this type
    }

    pushUndo()
    // Replace shape with editable line
    updateObject(obj.id, {
      type: 'line',
      points,
      closed: true,
      fill: obj.fill,
      fillType: obj.fillType,
      gradientColors: obj.gradientColors,
      gradientAngle: obj.gradientAngle,
      width: undefined,
      height: undefined,
      cornerRadius: undefined,
      radiusX: undefined,
      radiusY: undefined,
    })
    setEditingId(obj.id)
  }, [selectedObj, pushUndo, updateObject, handleConvertPathToPen])

  const exitEditMode = useCallback(() => {
    setEditingId(null)
  }, [])

  // Add anchor point: insert midpoint between last two points or at end
  const addAnchor = useCallback(() => {
    if (!editingId) return
    const obj = objects.find(o => o.id === editingId)
    if (!obj) return
    pushUndo()

    if (obj.penNodes?.length) {
      // Bezier: add midpoint between last two nodes
      const nodes = [...obj.penNodes]
      const last = nodes[nodes.length - 1]
      const prev = nodes.length > 1 ? nodes[nodes.length - 2] : last
      const mid = { x: (prev.x + last.x) / 2, y: (prev.y + last.y) / 2 }
      nodes.splice(nodes.length - 1, 0, mid)
      const d = penNodesToPathD(nodes)
      updateObject(editingId, { penNodes: nodes, data: d })
    } else if (obj.points?.length >= 4) {
      // Line: insert midpoint between last two points
      const pts = [...obj.points]
      const len = pts.length
      const mx = (pts[len - 4] + pts[len - 2]) / 2
      const my = (pts[len - 3] + pts[len - 1]) / 2
      pts.splice(len - 2, 0, mx, my)
      updateObject(editingId, { points: pts })
    }
  }, [editingId, objects, pushUndo, updateObject])

  // Remove last anchor point
  const removeAnchor = useCallback(() => {
    if (!editingId) return
    const obj = objects.find(o => o.id === editingId)
    if (!obj) return
    pushUndo()

    if (obj.penNodes?.length > 2) {
      const nodes = [...obj.penNodes]
      nodes.pop()
      const d = penNodesToPathD(nodes)
      updateObject(editingId, { penNodes: nodes, data: d })
    } else if (obj.points?.length > 4) {
      const pts = [...obj.points]
      pts.splice(pts.length - 2, 2)
      updateObject(editingId, { points: pts })
    }
  }, [editingId, objects, pushUndo, updateObject])

  // Duplicate
  const duplicateSelected = useCallback(() => {
    if (!selectedObj) return
    pushUndo()
    const id = addObject({ ...selectedObj, id: undefined, x: (selectedObj.x || 0) + 20, y: (selectedObj.y || 0) + 20 })
    setSelectedIds([id])
  }, [selectedObj, pushUndo, addObject, setSelectedIds])

  // Delete
  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return
    pushUndo()
    selectedIds.forEach(id => removeObject(id))
    setSelectedIds([])
  }, [selectedIds, pushUndo, removeObject, setSelectedIds])

  // Z-order
  const bringToFront = useCallback(() => {
    if (!selectedObj) return
    pushUndo()
    useUnifiedDesignStore.getState().reorderObject(selectedObj.id, objects.length - 1)
  }, [selectedObj, pushUndo, objects.length])

  const sendToBack = useCallback(() => {
    if (!selectedObj) return
    pushUndo()
    useUnifiedDesignStore.getState().reorderObject(selectedObj.id, 0)
  }, [selectedObj, pushUndo])

  const bringForward = useCallback(() => {
    if (!selectedObj) return
    const idx = objects.findIndex(o => o.id === selectedObj.id)
    if (idx < 0 || idx >= objects.length - 1) return
    pushUndo()
    useUnifiedDesignStore.getState().reorderObject(selectedObj.id, idx + 1)
  }, [selectedObj, objects, pushUndo])

  const sendBackward = useCallback(() => {
    if (!selectedObj) return
    const idx = objects.findIndex(o => o.id === selectedObj.id)
    if (idx <= 0) return
    pushUndo()
    useUnifiedDesignStore.getState().reorderObject(selectedObj.id, idx - 1)
  }, [selectedObj, objects, pushUndo])

  // Copy / cut / paste — in-memory clipboard
  const stripIds = (obj) => {
    const clone = JSON.parse(JSON.stringify(obj))
    const walk = (o) => {
      delete o.id
      if (o._liveCanvas) delete o._liveCanvas
      if (Array.isArray(o.children)) o.children.forEach(walk)
    }
    walk(clone)
    return clone
  }
  const copySelected = useCallback(() => {
    if (!selectedIds.length) return
    const collected = []
    for (const id of selectedIds) {
      const top = objects.find(o => o.id === id)
      if (top) { collected.push(stripIds(top)); continue }
      // Nested child — bake parent's offset into x/y so paste lands in absolute coords
      for (const o of objects) {
        const c = o.children?.find(ch => ch.id === id)
        if (c) {
          const stripped = stripIds(c)
          stripped.x = (stripped.x || 0) + (o.x || 0)
          stripped.y = (stripped.y || 0) + (o.y || 0)
          collected.push(stripped)
          break
        }
      }
    }
    if (collected.length) clipboardRef.current = collected
  }, [selectedIds, objects])

  const cutSelected = useCallback(() => {
    if (!selectedIds.length) return
    copySelected()
    pushUndo()
    selectedIds.forEach(id => removeObject(id))
    setSelectedIds([])
  }, [selectedIds, copySelected, pushUndo, removeObject, setSelectedIds])

  const pasteFromClipboard = useCallback(() => {
    const items = clipboardRef.current
    if (!items?.length) return
    pushUndo()
    const newIds = []
    for (const item of items) {
      const id = addObject({
        ...item,
        x: (item.x || 0) + 20,
        y: (item.y || 0) + 20,
      })
      newIds.push(id)
    }
    setSelectedIds(newIds)
  }, [pushUndo, addObject, setSelectedIds])

  // Keep latest handlers reachable from the (stable) keyboard listener
  kbHandlersRef.current = {
    copy: copySelected,
    cut: cutSelected,
    paste: pasteFromClipboard,
    duplicate: duplicateSelected,
    // applyBoolean is defined below — assigned after callback is created via second pass
  }

  // Group / Ungroup / Mask
  const handleGroup = useCallback(() => {
    if (selectedIds.length < 1) return
    pushUndo()
    groupObjects(selectedIds)
  }, [selectedIds, pushUndo, groupObjects])

  const handleUngroup = useCallback(() => {
    if (!selectedObj || (selectedObj.type !== 'group' && selectedObj.type !== 'mask')) return
    pushUndo()
    ungroupObject(selectedObj.id)
  }, [selectedObj, pushUndo, ungroupObject])

  const handleMask = useCallback(() => {
    if (selectedIds.length < 2) return
    pushUndo()
    createMask(selectedIds)
  }, [selectedIds, pushUndo, createMask])

  /* ── Boolean ops (Pathfinder) — Phase 1 MVP ──
     Resolves each selectedId in objects-array order (first = bottom z-order),
     runs the chosen polygon op, replaces selection with a single new path object.
     Result inherits the FIRST selection's fill/stroke style.
     Result path is placed with its bbox top-left as the new path's x/y; d uses LOCAL coords. */
  const applyBoolean = useCallback((opName) => {
    if (selectedIds.length < 2) return
    // Resolve in objects-array order so subtract/exclude have stable z-order semantics.
    // selectedIds may be in click order; we re-sort by index in objects[] (top-level only for Phase 1).
    const indexed = selectedIds
      .map(id => ({ id, idx: objects.findIndex(o => o.id === id), obj: objects.find(o => o.id === id) }))
      .filter(e => e.obj)
    if (indexed.length < 2) {
      // Some selected ids are children inside group/mask — Phase 1 skips
      alert('布尔运算暂不支持组/蒙版内的子对象,请先拖出再操作')
      return
    }
    // Validate all types supported
    for (const e of indexed) {
      if (!BOOLEAN_SUPPORTED_TYPES.has(e.obj.type)) {
        alert(`类型不支持布尔运算: ${TYPE_LABELS[e.obj.type] || e.obj.type}`)
        return
      }
    }
    indexed.sort((a, b) => a.idx - b.idx)   // bottom-up
    const ordered = indexed.map(e => e.obj)

    let result
    try {
      if (opName === 'unite')     result = unite(ordered)
      else if (opName === 'intersect') result = intersect(ordered)
      else if (opName === 'subtract')  result = subtract(ordered[0], ordered.slice(1))
      else if (opName === 'exclude')   result = exclude(ordered)
      else return
    } catch (err) {
      console.error('[shapeBoolean]', opName, err)
      alert('布尔运算失败: ' + (err?.message || String(err)))
      return
    }

    if (!result || !result.length) {
      alert('运算结果为空(无重叠区域或形状不相交)')
      return
    }

    // Result is in WORLD coords. Compute bbox, place new path at bbox top-left,
    // re-emit d in LOCAL coords (subtract bbox origin from every point).
    const bbox = multiPolyBBox(result)
    const localPoly = result.map(poly =>
      poly.map(ring => ring.map(([x, y]) => [x - bbox.x, y - bbox.y]))
    )
    const d = polygonToPathD(localPoly)
    if (!d) {
      alert('运算结果为空')
      return
    }

    // Inherit style from bottom-most (first ordered) shape
    const base = ordered[0]
    pushUndo()
    // Remove all selected (only top-level — children in group not selectable separately here)
    indexed.forEach(e => removeObject(e.id))
    const newId = addObject({
      type: 'path',
      x: bbox.x,
      y: bbox.y,
      data: d,
      // strip width/height — Konva Path doesn't use them for sizing
      width: bbox.w,
      height: bbox.h,
      fill: base.fill ?? '#7c6aed',
      stroke: base.stroke ?? '',
      strokeWidth: base.strokeWidth ?? 0,
      opacity: base.opacity ?? 1,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      fillRule: 'evenodd',   // safer for boolean results with holes
    })
    setSelectedIds([newId])
  }, [selectedIds, objects, pushUndo, removeObject, addObject, setSelectedIds])

  // Register applyBoolean to kbHandlersRef (after callback is defined)
  // so Ctrl+E / Cmd+E keyboard handler can call it via stable ref.
  kbHandlersRef.current.applyBoolean = applyBoolean

  // Ratio label
  const currentRatio = (() => {
    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b)
    const d = gcd(canvasWidth, canvasHeight)
    return `${canvasWidth / d}:${canvasHeight / d}`
  })()

  return (
    <div className="uc">
      {/* Top bar */}
      <div className="uc__topbar">
        <div className="uc__topbar-left">
          <button className="uc__topbar-btn" onClick={handleClose} data-tip="返回画布">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            <span>返回</span>
          </button>
        </div>
        <div className="uc__topbar-center">
          {topbarCenter || (
            <>
              <span className="uc__topbar-title">设计编辑</span>
              <span className="uc__topbar-badge">Beta</span>
            </>
          )}
        </div>
        <div className="uc__topbar-right">
          <button className="uc__topbar-btn" onClick={undo} disabled={!canUndo()} data-tip="撤销 (⌘Z)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
          </button>
          <button className="uc__topbar-btn" onClick={redo} disabled={!canRedo()} data-tip="重做 (⌘⇧Z)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>
            </svg>
          </button>

          <div className="uc__topbar-divider" />
          <div className="uc__topbar-zoom">
            <button className="uc__topbar-btn uc__topbar-btn--sm" onClick={() => setZoom(zoom - 0.25)}>−</button>
            <span className="uc__topbar-zoom-val">{Math.round(zoom * 100)}%</span>
            <button className="uc__topbar-btn uc__topbar-btn--sm" onClick={() => setZoom(zoom + 0.25)}>+</button>
          </div>

          <div className="uc__topbar-divider" />
          <button ref={canvasBtnRef} className="uc__topbar-btn uc__cvpick-btn"
            onClick={() => setShowCanvasPicker(v => !v)} data-tip="画布尺寸">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/>
            </svg>
            <span className="uc__cvpick-label">{currentRatio}</span>
            <span className="uc__cvpick-size">{canvasWidth}×{canvasHeight}</span>
          </button>

          <div className="uc__topbar-divider" />
          <GuidePanel gridType={gridType} setGridType={setGridType} setGridConfig={setGridConfig}
            colorGrid={colorGrid} colorGridColors={colorGridColors} />
          <div className="uc__topbar-divider" />
          <button className="uc__topbar-btn" onClick={() => setShowLayers(v => !v)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
            </svg>
          </button>
          <button className="uc__topbar-btn uc__topbar-btn--primary" onClick={() => setShowExport(true)}>
            导出
          </button>
        </div>
      </div>

      {/* Workspace: layers(left) | canvas(center) | properties(right) */}
      <div className="uc__workspace">
        {/* Left: Layers panel */}
        {showLayers && (
          <div className="uc__sidebar-left">
            <div className="uc__left-tabs">
              <button className={`uc__left-tab${leftTab === 'layers' ? ' uc__left-tab--on' : ''}`} onClick={() => setLeftTab('layers')}>图层</button>
            </div>
            <LayersPanel />
            {/* Upstream media thumbnails */}
            {mediaInputs.filter(m => m.type === 'image').length > 0 && (
              <div className="uc__media-section">
                <span className="uc__media-title">素材</span>
                <span className="uc__media-hint">拖入画板或点击添加</span>
                <div className="uc__media-grid">
                  {mediaInputs.filter(m => m.type === 'image').map((m, i) => (
                    <div key={i} className="uc__media-thumb"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', m.url)
                        e.dataTransfer.effectAllowed = 'copy'
                        setMediaPreview(null)
                      }}
                      onMouseEnter={(e) => setMediaPreview({ url: m.url, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setMediaPreview(p => p ? { ...p, x: e.clientX, y: e.clientY } : null)}
                      onMouseLeave={() => setMediaPreview(null)}
                      onClick={() => { setMediaPreview(null); addImageFromUrl(m.url) }}>
                      <img src={m.url} alt="" draggable={false} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Center: Canvas + floating toolbar + floating action bar */}
        <div className="uc__canvas-wrap"
          onContextMenu={(e) => {
            // Block paint mode contextmenu
            if (paintMode && isCanvasLayer) { e.preventDefault(); return }
            e.preventDefault()
            // Hit-test Konva to auto-select the right-clicked object — only if
            // current selection doesn't already cover it. Walk up to the
            // outermost selectable id (top-level, or the entered group's direct
            // child) so right-click on a grouped element still operates on the
            // group, matching Figma behavior.
            const stage = canvasRef.current?.getStage?.()
            if (stage) {
              const cr = stage.container().getBoundingClientRect()
              const hit = stage.getIntersection({ x: e.clientX - cr.left, y: e.clientY - cr.top })
              if (hit) {
                const ids = []
                let node = hit
                while (node && node !== stage) {
                  const nid = node.getAttr?.('data-id')
                  if (nid) ids.push(String(nid).replace(/__vis$/, ''))
                  node = node.getParent?.()
                }
                // Pick the outermost id (last in the walk-up chain)
                const top = ids[ids.length - 1]
                // If any node in the hit chain is already selected, leave selection alone
                const alreadyCovered = ids.some(id => selectedIds.includes(id))
                if (top && !alreadyCovered) setSelectedIds([top])
              }
            }
            setContextMenu({ x: e.clientX, y: e.clientY })
          }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
          onDrop={async (e) => {
            e.preventDefault()
            // [Eas-Term 移植] 砍掉「组件库拖放」（原动态 import designComponentStorage）

            // Image URL drop (media thumbnails)
            const url = e.dataTransfer.getData('text/plain')
            if (!url) return
            const stage = canvasRef.current?.getStage?.()
            if (!stage) { addImageFromUrl(url); return }
            const containerRect = stage.container().getBoundingClientRect()
            const stageAttrs = stage.attrs
            const dropX = (e.clientX - containerRect.left - (stageAttrs.x || 0)) / (stageAttrs.scaleX || 1)
            const dropY = (e.clientY - containerRect.top - (stageAttrs.y || 0)) / (stageAttrs.scaleY || 1)
            pushUndo()
            const imgEl = new Image()
            imgEl.crossOrigin = 'anonymous'
            imgEl.onload = () => {
              const scale = Math.min(canvasWidth * 0.5 / imgEl.width, canvasHeight * 0.5 / imgEl.height, 1)
              const w = imgEl.width * scale, h = imgEl.height * scale
              const id = addObject({
                type: 'image', x: dropX - w / 2, y: dropY - h / 2,
                width: w, height: h, src: url, fill: '', stroke: '', strokeWidth: 0,
              })
              setSelectedIds([id])
            }
            imgEl.src = url
          }}>
          <KonvaCanvas ref={canvasRef} editingId={editingId} onExitEdit={exitEditMode} onEnterEdit={setEditingId} />

          {/* Painting overlay — transparent event-capture layer */}
          {paintMode && isCanvasLayer && (
            <div
              className="uc__paint-overlay"
              style={{ cursor: 'none' }}
              onPointerDown={handleOverlayPointerDown}
              onPointerMove={handleOverlayPointerMove}
              onPointerUp={handleOverlayPointerUp}
              onPointerLeave={(e) => { endPaint(); setBrushCursor(null); brushResizeRef.current = null }}
              onContextMenu={(e) => e.preventDefault()}
            />
          )}
          {/* Brush cursor circle */}
          {paintMode && brushCursor && (
            <div className="uc__brush-cursor" style={{
              left: brushCursor.x, top: brushCursor.y,
              width: brushSize * (canvasRef.current?.getStage?.()?.scaleX() || 1),
              height: brushSize * (canvasRef.current?.getStage?.()?.scaleX() || 1),
            }} />
          )}

          {/* Floating tool palette — bottom center */}
          <div className="uc__float-toolbar">
            {paintMode && isCanvasLayer ? (
              <div className="uc__paint-toolbar">
                <button className={`uc__tool-btn${brushTool === 'brush' ? ' uc__tool-btn--active' : ''}`}
                  onClick={() => setBrushTool('brush')} data-tip="画笔">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                  </svg>
                </button>
                <button className={`uc__tool-btn${brushTool === 'eraser' ? ' uc__tool-btn--active' : ''}`}
                  onClick={() => setBrushTool('eraser')} data-tip="橡皮擦">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 20H7L3 16l9-9 8 8-4 4"/><path d="M6.5 13.5l5 5"/>
                  </svg>
                </button>
                <div className="uc__paint-sep" />
                <input type="color" className="uc__paint-color" value={brushColor}
                  onChange={e => setBrushColor(e.target.value)} data-tip="画笔颜色" />
                <div className="uc__paint-size">
                  <input type="range" className="uc__paint-size-slider" min={1} max={60} step={1}
                    value={brushSize} onChange={e => setBrushSize(+e.target.value)} />
                  <span className="uc__paint-size-val">{brushSize}</span>
                </div>
                <div className="uc__paint-sep" />
                <button className="uc__tool-btn" onClick={undoPaint} data-tip="撤销笔画 (Ctrl+Z)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                  </svg>
                </button>
              </div>
            ) : (
              <Toolbar />
            )}
          </div>

          {/* Floating action bar */}
          {selectedIds.length > 0 && (
            <div className="uc__sel-bar">
              {/* Anchor edit mode */}
              {editingId && selectedObj?.id === editingId ? (
                <>
                  <span className="uc__sel-bar__label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="2"/><path d="M12 2v8"/><path d="M12 14v8"/><path d="M2 12h8"/><path d="M14 12h8"/>
                    </svg>
                    编辑锚点
                  </span>
                  <div className="uc__sel-bar__divider" />
                  <button className="uc__sel-bar__btn" onClick={addAnchor} data-tip="添加锚点">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={removeAnchor} data-tip="删除锚点">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                  </button>
                  <div className="uc__sel-bar__divider" />
                  <button className="uc__sel-bar__btn uc__sel-bar__btn--accent" onClick={exitEditMode}>完成</button>
                </>

              /* Multi-select: group / mask */
              ) : selectedIds.length >= 2 ? (
                <>
                  <span className="uc__sel-bar__label">{selectedIds.length} 个对象</span>
                  <div className="uc__sel-bar__divider" />
                  <button className="uc__sel-bar__btn" onClick={handleGroup} data-tip="编组 (⌘G)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/>
                      <path d="M10 6h4"/><path d="M6 10v4"/><path d="M14 18h-4"/><path d="M18 14v-4"/>
                    </svg>
                    编组
                  </button>
                  <button className="uc__sel-bar__btn" onClick={handleMask} data-tip="创建蒙版">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="9" cy="9" r="7"/><rect x="10" y="10" width="12" height="12" rx="2"/>
                    </svg>
                    蒙版
                  </button>
                  <div className="uc__sel-bar__divider" />
                  {/* Pathfinder boolean ops — Phase 1 MVP. Two-circle SVG glyphs identify each op. */}
                  {/* Unite: two overlapping circles fully filled as one shape */}
                  <button className="uc__sel-bar__btn" onClick={() => applyBoolean('unite')} data-tip="并集 Unite (Ctrl+E)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="9" cy="12" r="6"/>
                      <circle cx="15" cy="12" r="6"/>
                    </svg>
                  </button>
                  {/* Intersect: two circle outlines, only overlap filled */}
                  <button className="uc__sel-bar__btn" onClick={() => applyBoolean('intersect')} data-tip="交集 Intersect">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="9" cy="12" r="6"/>
                      <circle cx="15" cy="12" r="6"/>
                      <path d="M12 6.7 a6 6 0 0 0 0 10.6 a6 6 0 0 0 0 -10.6 z" fill="currentColor" stroke="none"/>
                    </svg>
                  </button>
                  {/* Subtract: left circle filled, right circle dashed outline (front cuts out) */}
                  <button className="uc__sel-bar__btn" onClick={() => applyBoolean('subtract')} data-tip="差集 Minus Front (底 - 上)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M9 6 a6 6 0 1 0 0 12 a6 6 0 0 0 5.2 -3 a6 6 0 0 1 0 -6 a6 6 0 0 0 -5.2 -3 z" fill="currentColor" fillRule="evenodd"/>
                      <circle cx="15" cy="12" r="6" strokeDasharray="2.5 2"/>
                    </svg>
                  </button>
                  {/* Exclude: two circles filled but overlap is hollow (XOR via evenodd) */}
                  <button className="uc__sel-bar__btn" onClick={() => applyBoolean('exclude')} data-tip="异或 Exclude(去除重叠)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
                      <path d="M9 6 a6 6 0 1 0 0 12 a6 6 0 1 0 0 -12 z M15 6 a6 6 0 1 1 0 12 a6 6 0 1 1 0 -12 z" fillRule="evenodd"/>
                    </svg>
                  </button>
                  <div className="uc__sel-bar__divider" />
                  {/* Alignment */}
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('left') }} data-tip="左对齐 (Alt+A)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="2" x2="4" y2="22"/><rect x="8" y="4" width="12" height="6" rx="1"/><rect x="8" y="14" width="8" height="6" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('center-h') }} data-tip="水平居中 (Alt+H)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="2" x2="12" y2="22"/><rect x="6" y="4" width="12" height="6" rx="1"/><rect x="8" y="14" width="8" height="6" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('right') }} data-tip="右对齐 (Alt+D)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="20" y1="2" x2="20" y2="22"/><rect x="4" y="4" width="12" height="6" rx="1"/><rect x="8" y="14" width="8" height="6" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('top') }} data-tip="上对齐 (Alt+W)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="4" x2="22" y2="4"/><rect x="4" y="8" width="6" height="12" rx="1"/><rect x="14" y="8" width="6" height="8" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('center-v') }} data-tip="垂直居中 (Alt+V)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="12" x2="22" y2="12"/><rect x="4" y="6" width="6" height="12" rx="1"/><rect x="14" y="8" width="6" height="8" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('bottom') }} data-tip="下对齐 (Alt+S)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="20" x2="22" y2="20"/><rect x="4" y="4" width="6" height="12" rx="1"/><rect x="14" y="8" width="6" height="8" rx="1"/></svg>
                  </button>
                  {selectedIds.length >= 3 && (<>
                    <div className="uc__sel-bar__divider" />
                    <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('distribute-h') }} data-tip="水平等间隔">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="4" height="12" rx="1"/><rect x="10" y="8" width="4" height="8" rx="1"/><rect x="18" y="4" width="4" height="16" rx="1"/></svg>
                    </button>
                    <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('distribute-v') }} data-tip="垂直等间隔">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="2" width="12" height="4" rx="1"/><rect x="8" y="10" width="8" height="4" rx="1"/><rect x="4" y="18" width="16" height="4" rx="1"/></svg>
                    </button>
                  </>)}
                  <div className="uc__sel-bar__divider" />
                  <button className="uc__sel-bar__btn uc__sel-bar__btn--danger" onClick={deleteSelected} data-tip="删除">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </>

              /* Single select */
              ) : selectedObj ? (
                <>
                  <span className="uc__sel-bar__label">
                    {selectedObj.type === 'group' ? '组' : selectedObj.type === 'mask' ? '蒙版' : (TYPE_LABELS[selectedObj.type] || '对象')}
                  </span>
                  <div className="uc__sel-bar__divider" />

                  {/* Ungroup */}
                  {selectedObj.type === 'group' && (
                    <button className="uc__sel-bar__btn" onClick={handleUngroup} data-tip="取消编组">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/>
                        <line x1="10" y1="2" x2="14" y2="6" strokeDasharray="2 2"/>
                      </svg>
                      解组
                    </button>
                  )}

                  {/* Release mask */}
                  {selectedObj.type === 'mask' && (
                    <button className="uc__sel-bar__btn" onClick={handleUngroup} data-tip="释放蒙版">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="9" cy="9" r="7" strokeDasharray="3 3"/><rect x="10" y="10" width="12" height="12" rx="2" strokeDasharray="3 3"/>
                      </svg>
                      释放蒙版
                    </button>
                  )}

                  {/* Edit anchors */}
                  {(selectedObj.type === 'rect' || selectedObj.type === 'ellipse' || selectedObj.type === 'line') && (
                    <button className="uc__sel-bar__btn" onClick={enterEditMode} data-tip="编辑锚点">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="4" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="20" r="2"/>
                        <path d="M12 6v6"/><path d="M6 20l6-8 6 8"/>
                      </svg>
                      编辑
                    </button>
                  )}

                  {/* Text outline */}
                  {selectedObj.type === 'text' && (
                    <button className="uc__sel-bar__btn" data-tip="文字轮廓化"
                      onClick={() => {
                        pushUndo()
                        outlineText(selectedObj.id)
                      }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 7V5h16v2"/><path d="M9 19h6"/><path d="M12 5v14"/>
                      </svg>
                      轮廓化
                    </button>
                  )}

                  {/* Image adjustments */}
                  {selectedObj.type === 'image' && (
                    <button className={`uc__sel-bar__btn ${showAdjust ? 'uc__sel-bar__btn--active' : ''}`}
                      onClick={() => setShowAdjust(v => !v)} data-tip="图片调整">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                      </svg>
                      调整
                    </button>
                  )}

                  {/* Single-select alignment (align to canvas) */}
                  <div className="uc__sel-bar__divider" />
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('left') }} data-tip="左对齐 (Alt+A)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="2" x2="4" y2="22"/><rect x="8" y="6" width="12" height="5" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('center-h') }} data-tip="水平居中 (Alt+H)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="2" x2="12" y2="22"/><rect x="6" y="6" width="12" height="5" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('right') }} data-tip="右对齐 (Alt+D)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="20" y1="2" x2="20" y2="22"/><rect x="4" y="6" width="12" height="5" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('top') }} data-tip="上对齐 (Alt+W)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="4" x2="22" y2="4"/><rect x="6" y="8" width="5" height="12" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('center-v') }} data-tip="垂直居中 (Alt+V)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="12" x2="22" y2="12"/><rect x="6" y="6" width="5" height="12" rx="1"/></svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={() => { pushUndo(); alignObjects('bottom') }} data-tip="下对齐 (Alt+S)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="20" x2="22" y2="20"/><rect x="6" y="4" width="5" height="12" rx="1"/></svg>
                  </button>
                  <div className="uc__sel-bar__divider" />

                  <button className="uc__sel-bar__btn" onClick={duplicateSelected} data-tip="复制">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={bringToFront} data-tip="置顶">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>
                    </svg>
                  </button>
                  <button className="uc__sel-bar__btn" onClick={sendToBack} data-tip="置底">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>
                    </svg>
                  </button>
                  <div className="uc__sel-bar__divider" />
                  <button className="uc__sel-bar__btn uc__sel-bar__btn--danger" onClick={deleteSelected} data-tip="删除">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </>
              ) : null}
            </div>
          )}

          {/* Right-click context menu */}
          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={() => setContextMenu(null)}
              selectedObj={selectedObj}
              selectedIds={selectedIds}
              hasClipboard={!!clipboardRef.current?.length}
              canUndo={canUndo()}
              canRedo={canRedo()}
              onUndo={undo}
              onRedo={redo}
              onCut={cutSelected}
              onCopy={copySelected}
              onPaste={pasteFromClipboard}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
              onGroup={handleGroup}
              onUngroup={handleUngroup}
              onMask={handleMask}
              onReleaseMask={handleUngroup}
              onOutlineText={() => {
                if (!selectedObj || selectedObj.type !== 'text') return
                pushUndo()
                outlineText(selectedObj.id)
              }}
              onConvertPathToPen={handleConvertPathToPen}
              onBringToFront={bringToFront}
              onBringForward={bringForward}
              onSendBackward={sendBackward}
              onSendToBack={sendToBack}
              onAlign={(dir) => { pushUndo(); alignObjects(dir) }}
            />
          )}

          {/* Image adjustment panel — draggable */}
          {showAdjust && selectedObj?.type === 'image' && (() => {
            const adj = selectedObj.adjustments || {}
            const applyAdj = (key, val) => {
              const next = { ...adj, [key]: val }
              if (_selectedParentId) {
                useUnifiedDesignStore.getState().updateChild(_selectedParentId, selectedObj.id, { adjustments: next })
              } else {
                updateObject(selectedObj.id, { adjustments: next })
              }
            }
            const resetAll = () => {
              pushUndo()
              const empty = { brightness: 0, contrast: 0, hue: 0, saturation: 0, luminance: 0, blur: 0, noise: 0, pixelate: 0, posterize: 0, threshold: 0, halftone: 0, emboss: 0, grayscale: false, sepia: false, invert: false, solarize: false, duotone: false }
              if (_selectedParentId) {
                useUnifiedDesignStore.getState().updateChild(_selectedParentId, selectedObj.id, { adjustments: empty })
              } else {
                updateObject(selectedObj.id, { adjustments: empty })
              }
            }
            const basicSliders = [
              { key: 'brightness', label: '亮度', min: -1, max: 1, step: 0.02, default: 0 },
              { key: 'contrast',   label: '对比度', min: -100, max: 100, step: 1, default: 0 },
              { key: 'saturation', label: '饱和度', min: -2, max: 2, step: 0.05, default: 0 },
              { key: 'hue',        label: '色相', min: -180, max: 180, step: 1, default: 0 },
              { key: 'luminance',  label: '明度', min: -2, max: 2, step: 0.05, default: 0 },
            ]
            const advancedSliders = [
              { key: 'blur',       label: '模糊', min: 0, max: 40, step: 0.5, default: 0 },
              { key: 'noise',      label: '噪点', min: 0, max: 1, step: 0.02, default: 0 },
              { key: 'pixelate',   label: '像素化', min: 0, max: 20, step: 1, default: 0 },
              { key: 'posterize',  label: '色调分离', min: 0, max: 8, step: 1, default: 0 },
              { key: 'threshold',  label: '阈值', min: 0, max: 255, step: 1, default: 0 },
              { key: 'halftone',   label: '半调网点', min: 0, max: 16, step: 1, default: 0 },
              { key: 'emboss',     label: '浮雕', min: 0, max: 5, step: 0.5, default: 0 },
            ]
            const basicToggles = [
              { key: 'grayscale', label: '灰度' },
              { key: 'sepia', label: '复古' },
              { key: 'invert', label: '反色' },
            ]
            const advancedToggles = [
              { key: 'solarize', label: '曝光' },
              { key: 'duotone', label: '双色调' },
            ]
            // Auto-expand if any advanced effect is active
            const hasAdvanced = [...advancedSliders, ...advancedToggles].some(s => {
              const v = adj[s.key]; return v && v !== 0 && v !== false
            })
            const onDragStart = (e) => {
              if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return
              const panel = e.currentTarget
              const rect = panel.getBoundingClientRect()
              adjustDragRef.current = { ox: e.clientX - rect.left, oy: e.clientY - rect.top }
              const onMove = (ev) => {
                if (!adjustDragRef.current) return
                setAdjustPos({ x: ev.clientX - adjustDragRef.current.ox, y: ev.clientY - adjustDragRef.current.oy })
              }
              const onUp = () => {
                adjustDragRef.current = null
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
              }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }
            const panelStyle = adjustPos
              ? { position: 'fixed', left: adjustPos.x, top: adjustPos.y, transform: 'none', bottom: 'auto' }
              : {}
            return (
              <div className="uc__adjust-panel" style={panelStyle} onMouseDown={onDragStart}>
                <div className="uc__adjust-header">
                  <span className="uc__adjust-title">图片调整</span>
                  <div className="uc__adjust-header-actions">
                    <button className="uc__adjust-reset" onClick={resetAll}>重置</button>
                    <button className="uc__adjust-close" onClick={() => { setShowAdjust(false); setAdjustPos(null) }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                </div>
                {/* Basic adjustments */}
                {basicSliders.map(s => {
                  const val = adj[s.key] ?? s.default
                  return (
                    <div key={s.key} className="uc__adjust-row">
                      <span className="uc__adjust-label">{s.label}</span>
                      <input type="range" className="uc__adjust-slider" min={s.min} max={s.max} step={s.step} value={val}
                        onChange={e => applyAdj(s.key, parseFloat(e.target.value))}
                        onMouseDown={(e) => { e.stopPropagation(); pushUndo() }} />
                      <span className="uc__adjust-val">{typeof val === 'number' ? (Number.isInteger(val) ? val : val.toFixed(2)) : val}</span>
                    </div>
                  )
                })}
                <div className="uc__adjust-toggles">
                  {basicToggles.map(t => (
                    <button key={t.key}
                      className={`uc__adjust-toggle ${adj[t.key] ? 'uc__adjust-toggle--active' : ''}`}
                      onClick={() => { pushUndo(); applyAdj(t.key, !adj[t.key]) }}>
                      {t.label}
                    </button>
                  ))}
                </div>
                {/* Advanced effects — collapsible */}
                <AdjustAdvanced sliders={advancedSliders} toggles={advancedToggles}
                  adj={adj} applyAdj={applyAdj} pushUndo={pushUndo} defaultOpen={false} />
              </div>
            )
          })()}
        </div>

        {/* Right: Properties panel (Figma-style, full height) */}
        <div className="uc__sidebar-right">
          <PropertiesPanel />
        </div>
      </div>

      {showExport && (
        <ExportDialog canvasRef={canvasRef} onExport={handleExport} onClose={() => setShowExport(false)} />
      )}

      {/* [Eas-Term 移植] 砍掉「存为组件」对话框 */}

      {/* Canvas size picker portal */}
      {/* Media hover preview */}
      {mediaPreview && createPortal(
        <div className="uc__media-preview" style={(() => {
          const pw = 200, ph = 200, gap = 12
          let x = mediaPreview.x - pw / 2
          let y = mediaPreview.y - ph - gap
          // Keep within viewport
          if (x < 4) x = 4
          if (x + pw > window.innerWidth - 4) x = window.innerWidth - pw - 4
          if (y < 4) y = mediaPreview.y + gap + 20 // flip below cursor
          return { left: x, top: y }
        })()}>
          <img src={mediaPreview.url} alt="" />
        </div>,
        document.body
      )}

      {showCanvasPicker && createPortal(
        <>
          <div className="uc__cvpick-backdrop" onClick={() => setShowCanvasPicker(false)} />
          <div className="uc__cvpick-dropdown"
            style={(() => {
              const r = canvasBtnRef.current?.getBoundingClientRect()
              if (!r) return {}
              return { position: 'fixed', top: r.bottom + 4, right: window.innerWidth - r.right }
            })()}>
            {CANVAS_PRESETS.map(g => (
              <div key={g.group} className="uc__cvpick-group">
                <span className="uc__cvpick-group-label">{g.group}</span>
                {g.items.map(p => (
                  <button key={p.label}
                    className={`uc__cvpick-option${canvasWidth === p.w && canvasHeight === p.h ? ' uc__cvpick-option--active' : ''}`}
                    onClick={() => handleCanvasPresetSelect(p)}>
                    <span className="uc__cvpick-option-ratio">{p.label}</span>
                    <span className="uc__cvpick-option-size">{p.w}×{p.h}</span>
                  </button>
                ))}
              </div>
            ))}
            <div className="uc__cvpick-group">
              <span className="uc__cvpick-group-label">背景</span>
              <div className="uc__cvpick-bg-row">
                <input type="color" className="uc__props-color"
                  value={(backgroundColor || '#ffffff').replace(/^rgba?\(.*\)$/, '#ffffff').slice(0, 7)}
                  onChange={e => {
                    const a = useUnifiedDesignStore.getState().bgOpacity ?? 1
                    setBackgroundColor(a < 1 ? e.target.value : e.target.value)
                    useUnifiedDesignStore.setState({ bgOpacity: a })
                  }} />
                <input type="range" className="uc__grid-slider" style={{ width: 48 }}
                  min={0} max={100} step={5}
                  value={Math.round((useUnifiedDesignStore.getState().bgOpacity ?? 1) * 100)}
                  onChange={e => {
                    const a = +e.target.value / 100
                    useUnifiedDesignStore.setState({ bgOpacity: a })
                    if (a === 0) setBackgroundColor('transparent')
                    else {
                      const cur = backgroundColor === 'transparent' ? '#ffffff' : (backgroundColor || '#ffffff').slice(0, 7)
                      setBackgroundColor(cur)
                    }
                  }}
                  data-tip={`不透明度 ${Math.round((useUnifiedDesignStore.getState().bgOpacity ?? 1) * 100)}%`} />
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
