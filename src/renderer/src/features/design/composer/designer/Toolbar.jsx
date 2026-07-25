/**
 * Toolbar — tool palette for DesignComposer
 *
 * The drawing tools switch `activeTool`.
 *
 * [Eas-Term 移植] 砍掉「钢笔(pen/bezier)」工具 + 「导入 SVG」动作按钮
 * (钢笔依赖被砍的 pathToPen/shapeToPen;SVG 导入依赖被砍的 svgImport)。
 */
import React from 'react'
import { useUnifiedDesignStore } from './store'

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
  // [Eas-Term 移植] 砍掉 pen(钢笔/bezier)工具
]

export default function Toolbar() {
  const activeTool = useUnifiedDesignStore(s => s.activeTool)
  const setActiveTool = useUnifiedDesignStore(s => s.setActiveTool)

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
      {/* [Eas-Term 移植] 砍掉「导入 SVG」按钮 + 隐藏 file input */}
    </div>
  )
}
