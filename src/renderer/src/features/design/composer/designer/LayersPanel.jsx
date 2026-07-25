/**
 * LayersPanel — layer list with groups, masks, drag-to-reorder
 */
import React, { useState, useRef } from 'react'
import { useUnifiedDesignStore } from './store'

const TYPE_LABELS = { rect: '矩形', ellipse: '椭圆', line: '线条', pen: '路径', text: '文字', image: '图片', path: '路径', group: '组', mask: '蒙版', star: '星形', polygon: '多边形', canvas: '画板' }

const TYPE_ICONS = {
  text: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>,
  rect: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
  ellipse: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="12" rx="10" ry="8"/></svg>,
  line: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>,
  image: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  path: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/></svg>,
  pen: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/></svg>,
  group: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/></svg>,
  mask: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="9" r="7"/><rect x="10" y="10" width="12" height="12" rx="2"/></svg>,
  star: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  polygon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l9.5 7-3.5 11h-12L2.5 9z"/></svg>,
  canvas: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>,
}

function LayerItem({ obj, depth, selectedIds, setSelectedIds, updateObject, removeObject, pushUndo, expandedGroups, toggleExpand, isMaskShape, dragState, onDragStart, onDragOver, onDrop, flatIds, lastClickedRef }) {
  const isSelected = selectedIds.includes(obj.id)
  const isGroup = obj.type === 'group' || obj.type === 'mask'
  const isExpanded = isGroup && expandedGroups.has(obj.id)
  const label = isMaskShape ? '蒙版形状' : obj.type === 'text' ? (obj.text?.slice(0, 12) || '文字') : (TYPE_LABELS[obj.type] || '对象')
  const isDragging = dragState?.dragId === obj.id
  const isDropTarget = dragState?.dropId === obj.id

  return (
    <>
      <div
        className={
          `uc__layer-item`
          + (isSelected ? ' uc__layer-item--active' : '')
          + (obj.visible === false ? ' uc__layer-item--hidden' : '')
          + (obj.locked ? ' uc__layer-item--locked' : '')
          + (isDragging ? ' uc__layer-item--dragging' : '')
          + (isDropTarget ? ' uc__layer-item--drop-target' : '')
        }
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', obj.id)
          onDragStart?.(obj.id)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          onDragOver?.(obj.id)
        }}
        onDrop={(e) => {
          e.preventDefault()
          onDrop?.(obj.id)
        }}
        onClick={(e) => {
          if (e.shiftKey && flatIds && lastClickedRef?.current) {
            // Shift+click: range select between last clicked and current
            const anchorIdx = flatIds.indexOf(lastClickedRef.current)
            const targetIdx = flatIds.indexOf(obj.id)
            if (anchorIdx >= 0 && targetIdx >= 0) {
              const start = Math.min(anchorIdx, targetIdx)
              const end = Math.max(anchorIdx, targetIdx)
              setSelectedIds(flatIds.slice(start, end + 1))
            } else {
              setSelectedIds([obj.id])
            }
          } else if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd+click: toggle individual layer
            const cur = [...selectedIds]
            if (cur.includes(obj.id)) setSelectedIds(cur.filter(id => id !== obj.id))
            else setSelectedIds([...cur, obj.id])
          } else {
            setSelectedIds([obj.id])
          }
          if (lastClickedRef) lastClickedRef.current = obj.id
        }}
      >
        {/* Expand toggle for groups */}
        {isGroup ? (
          <button className="uc__layer-expand" onClick={(e) => { e.stopPropagation(); toggleExpand(obj.id) }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          </button>
        ) : (
          <span className="uc__layer-drag-handle">
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" opacity="0.3">
              <circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/>
              <circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/>
              <circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/>
            </svg>
          </span>
        )}

        <span className="uc__layer-icon">{TYPE_ICONS[obj.type] || TYPE_ICONS.rect}</span>
        <span className="uc__layer-name">{label}</span>

        <div className="uc__layer-actions">
          <button className="uc__layer-act-btn"
            onClick={e => { e.stopPropagation(); updateObject(obj.id, { locked: !obj.locked }) }}
            data-tip={obj.locked ? '解锁' : '锁定'}>
            {obj.locked
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
            }
          </button>
          <button className="uc__layer-act-btn"
            onClick={e => { e.stopPropagation(); updateObject(obj.id, { visible: obj.visible === false ? true : false }) }}
            data-tip={obj.visible !== false ? '隐藏' : '显示'}>
            {obj.visible !== false
              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            }
          </button>
          <button className="uc__layer-act-btn uc__layer-act-btn--danger"
            onClick={e => { e.stopPropagation(); pushUndo(); removeObject(obj.id) }}
            data-tip="删除">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>

      {/* Render children of groups/masks when expanded */}
      {isGroup && isExpanded && (obj.children || []).slice().reverse().map((child, ri, arr) => (
        <LayerItem key={child.id} obj={child} depth={depth + 1}
          selectedIds={selectedIds} setSelectedIds={setSelectedIds}
          updateObject={updateObject} removeObject={removeObject} pushUndo={pushUndo}
          expandedGroups={expandedGroups} toggleExpand={toggleExpand}
          isMaskShape={obj.type === 'mask' && ri === arr.length - 1}
          dragState={dragState} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
          flatIds={flatIds} lastClickedRef={lastClickedRef} />
      ))}
    </>
  )
}

export default function LayersPanel() {
  const objects = useUnifiedDesignStore(s => s.objects)
  const selectedIds = useUnifiedDesignStore(s => s.selectedIds)
  const setSelectedIds = useUnifiedDesignStore(s => s.setSelectedIds)
  const updateObject = useUnifiedDesignStore(s => s.updateObject)
  const removeObject = useUnifiedDesignStore(s => s.removeObject)
  const addObject = useUnifiedDesignStore(s => s.addObject)
  const reorderObject = useUnifiedDesignStore(s => s.reorderObject)
  const pushUndo = useUnifiedDesignStore(s => s.pushUndo)
  const canvasWidth = useUnifiedDesignStore(s => s.canvasWidth)
  const canvasHeight = useUnifiedDesignStore(s => s.canvasHeight)

  const [expandedGroups, setExpandedGroups] = useState(new Set())
  const toggleExpand = (id) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Drag-to-reorder state
  const [dragState, setDragState] = useState(null) // { dragId, dropId }
  const onDragStart = (id) => setDragState({ dragId: id, dropId: null })
  const onDragOver = (id) => setDragState(prev => prev ? { ...prev, dropId: id } : null)
  const onDrop = (dropId) => {
    if (!dragState?.dragId || dragState.dragId === dropId) { setDragState(null); return }
    const dragId = dragState.dragId
    setDragState(null)

    // Layers panel is reversed: top item = highest z-index = last in array
    // We need to place dragId at the same array position as dropId
    const dropIdx = objects.findIndex(o => o.id === dropId)
    if (dropIdx === -1) return
    pushUndo()
    reorderObject(dragId, dropIdx)
  }

  const layers = [...objects].reverse()

  // Build flat ID list matching visible render order (for shift-click range select)
  const flatIds = React.useMemo(() => {
    const ids = []
    const collect = (list, expanded) => {
      for (const obj of list) {
        ids.push(obj.id)
        const isGroup = obj.type === 'group' || obj.type === 'mask'
        if (isGroup && expanded.has(obj.id) && obj.children) {
          collect([...obj.children].reverse(), expanded)
        }
      }
    }
    collect(layers, expandedGroups)
    return ids
  }, [layers, expandedGroups])

  const lastClickedRef = useRef(null)

  return (
    <div className="uc__layers"
      onDragEnd={() => setDragState(null)}
      onDragLeave={(e) => {
        // Only clear drop target if leaving the entire layers list
        if (!e.currentTarget.contains(e.relatedTarget)) setDragState(null)
      }}>
      <div className="uc__layers-header">
        <span className="uc__layers-title">图层</span>
        <span className="uc__layers-count">{objects.length}</span>
      </div>
      <div className="uc__layers-list">
        {layers.length === 0 && <div key="__empty__" className="uc__layers-empty">暂无图层</div>}
        {layers.map(obj => (
          <LayerItem key={obj.id} obj={obj} depth={0}
            selectedIds={selectedIds} setSelectedIds={setSelectedIds}
            updateObject={updateObject} removeObject={removeObject} pushUndo={pushUndo}
            expandedGroups={expandedGroups} toggleExpand={toggleExpand}
            isMaskShape={false}
            dragState={dragState} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
            flatIds={flatIds} lastClickedRef={lastClickedRef} />
        ))}
      </div>
      {/* Only show create button if no canvas layer exists */}
      {!objects.some(o => o.type === 'canvas') ? (
        <button className="uc__layers-add-canvas" onClick={() => {
          pushUndo()
          const id = addObject({
            type: 'canvas', x: 0, y: 0,
            width: canvasWidth, height: canvasHeight,
            fill: '', stroke: '', strokeWidth: 0,
            _canvasData: null,
          })
          // Move to top of z-order
          const objs = useUnifiedDesignStore.getState().objects
          useUnifiedDesignStore.getState().reorderObject(id, objs.length - 1)
          setSelectedIds([id])
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          新建画板图层
        </button>
      ) : (
        <button className="uc__layers-add-canvas uc__layers-add-canvas--exists" onClick={() => {
          const cl = objects.find(o => o.type === 'canvas')
          if (cl) setSelectedIds([cl.id])
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
          </svg>
          选择画板图层
        </button>
      )}
    </div>
  )
}
