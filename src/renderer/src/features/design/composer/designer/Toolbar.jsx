/**
 * Toolbar — tool palette for DesignComposer
 *
 * The drawing tools (left of the separator) switch `activeTool`.
 * The action buttons (right of the separator) trigger one-shot actions
 * (import SVG, etc.) — they don't change `activeTool`.
 */
import React, { useRef } from 'react'
import { useUnifiedDesignStore } from './store'
import { importSvgFile } from './svgImport'

const TOOLS = [
  { id: 'select', label: '选择', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/>
    </svg>
  )},
  { id: 'rect', label: '矩形', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
    </svg>
  )},
  { id: 'ellipse', label: '椭圆', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="12" rx="10" ry="8"/>
    </svg>
  )},
  { id: 'line', label: '线条', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="5" y1="19" x2="19" y2="5"/>
    </svg>
  )},
  { id: 'star', label: '星形', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  )},
  { id: 'polygon', label: '多边形', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2l9.5 7-3.5 11h-12L2.5 9z"/>
    </svg>
  )},
  { id: 'text', label: '文字', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
    </svg>
  )},
  { id: 'pen', label: '画笔', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
      <path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>
    </svg>
  )},
]

const ImportSvgIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* Three anchor points connected by a curved path — evokes SVG vector */}
    <path d="M5 17c4-4 4-10 14-10" />
    <circle cx="5" cy="17" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="11" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="7" r="1.6" fill="currentColor" stroke="none" />
    {/* Down-arrow hinting "import" */}
    <path d="M12 16v4M9.5 18l2.5 2.5L14.5 18" />
  </svg>
)

export default function Toolbar() {
  const activeTool = useUnifiedDesignStore(s => s.activeTool)
  const setActiveTool = useUnifiedDesignStore(s => s.setActiveTool)
  const addObject = useUnifiedDesignStore(s => s.addObject)
  const pushUndo = useUnifiedDesignStore(s => s.pushUndo)
  const setSelectedIds = useUnifiedDesignStore(s => s.setSelectedIds)
  const canvasWidth = useUnifiedDesignStore(s => s.canvasWidth)
  const canvasHeight = useUnifiedDesignStore(s => s.canvasHeight)
  const fileInputRef = useRef(null)

  const triggerImport = () => {
    const input = fileInputRef.current
    if (!input) return
    input.value = '' // allow re-importing the same file
    input.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    await importSvgFile(file, {
      addObject,
      pushUndo,
      setSelectedIds,
      canvasWidth,
      canvasHeight,
    })
    // After import, switch back to select tool so the new objects can be moved.
    setActiveTool('select')
  }

  return (
    <div className="uc__toolbar">
      {TOOLS.map(t => (
        <button
          key={t.id}
          className={`uc__tool-btn${activeTool === t.id ? ' uc__tool-btn--active' : ''}`}
          onClick={() => setActiveTool(t.id)}
          data-tip={t.label}
        >
          {t.icon}
        </button>
      ))}
      <div className="uc__toolbar-sep" aria-hidden />
      <button
        className="uc__tool-btn"
        onClick={triggerImport}
        data-tip="导入 SVG 矢量文件(只支持 <path>)"
      >
        {ImportSvgIcon}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}
