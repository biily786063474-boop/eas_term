/**
 * LayersPanel — layer list with groups, masks, drag-to-reorder
 */
import React, { useState, useRef } from 'react'
import { useUnifiedMotionStore } from './store'

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

/**
 * 动画态 LayersPanel — fork from designer/LayersPanel.jsx
 *
 * 适配 motion store:
 * - objects[] → layers[](flatten,无嵌套)
 * - selectedIds[] (多选) → selectedLayerId (单选,用 [selectedLayerId] 包装)
 * - updateObject/removeObject → updateLayer (via setLayers patch) / removeLayer
 * - reorderObject → reorderLayer
 * - 不渲染 group/mask 展开(motion 已 flatten),不渲染 dnd drop target(暂不支持)
 *
 * 视觉用 designer 同款 .uc__layers / .uc__layer-item(完全等同设计态左侧体验)
 */
export default function LayersPanel({ expandedGroups: expandedGroupsProp, toggleExpand: toggleExpandProp } = {}) {
  const layers = useUnifiedMotionStore(s => s.layers)
  const selectedLayerId = useUnifiedMotionStore(s => s.selectedLayerId)
  const selectLayer = useUnifiedMotionStore.getState().selectLayer
  const toggleLayerVisible = useUnifiedMotionStore.getState().toggleLayerVisible
  const toggleLayerLocked = useUnifiedMotionStore.getState().toggleLayerLocked
  const removeLayer = useUnifiedMotionStore.getState().removeLayer
  const reorderLayer = useUnifiedMotionStore.getState().reorderLayer
  const pushUndo = useUnifiedMotionStore.getState().pushUndo

  // 把 motion layer 适配成 design object 形状(让 LayerItem 复用)
  // 递归暴露 children — 用户在动画态左侧可展开 group 看子元素
  const adaptLayer = React.useCallback((l) => ({
    id: l.id,
    type: l.type,
    text: l.base?.text || l.name,
    visible: l.visible !== false,
    locked: !!l.locked,
    children: l.children?.map(adaptLayer),
  }), [])
  const objects = React.useMemo(() => layers.map(adaptLayer), [layers, adaptLayer])

  // Round-12: expandedGroups + toggleExpand 由父级 AnimateView 持有(支持钻入时
  // editingId path 上 group 同步展开)。fallback 本地 state 仅供测试场景(props 未传时)。
  const [expandedGroupsLocal, setExpandedGroupsLocal] = useState(new Set())
  const expandedGroups = expandedGroupsProp || expandedGroupsLocal
  const toggleExpand = (id) => {
    if (toggleExpandProp) { toggleExpandProp(id); return }
    setExpandedGroupsLocal(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectedIds = selectedLayerId ? [selectedLayerId] : []

  // 适配 setSelectedIds(motion 单选,只取数组第一个)
  const setSelectedIds = (ids) => {
    selectLayer(ids[ids.length - 1] || null)
  }

  // updateObject 适配 visible / locked / 重命名
  const updateObject = (id, changes) => {
    if ('visible' in changes) toggleLayerVisible(id)
    if ('locked' in changes) toggleLayerLocked(id)
    // 其他字段不暴露(motion 改属性走 keyframe panel)
  }

  const removeObject = (id) => removeLayer(id)

  // dnd 排序
  const [dragState, setDragState] = useState(null)
  const onDragStart = (id) => setDragState({ dragId: id, dropId: null })
  const onDragOver = (id) => setDragState(prev => prev ? { ...prev, dropId: id } : null)
  const onDrop = (dropId) => {
    if (!dragState?.dragId || dragState.dragId === dropId) { setDragState(null); return }
    const dragId = dragState.dragId
    setDragState(null)
    // motion layers 数组顺序就是 z-order,跟 design objects 一样
    const dropIdx = layers.findIndex(l => l.id === dropId)
    if (dropIdx === -1) return
    pushUndo()
    reorderLayer(dragId, dropIdx)
  }

  // 反向显示:顶部 = z-order 高 = layers 数组末尾
  const displayLayers = [...objects].reverse()
  const flatIds = displayLayers.map(o => o.id)
  const lastClickedRef = useRef(null)

  return (
    <div className="uc__layers"
      onDragEnd={() => setDragState(null)}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragState(null)
      }}>
      <div className="uc__layers-header">
        <span className="uc__layers-title">动画图层</span>
        <span className="uc__layers-count">{objects.length}</span>
      </div>
      <div className="uc__layers-list">
        {displayLayers.length === 0 && <div key="__empty__" className="uc__layers-empty">请连接设计节点或切回设计态创建</div>}
        {displayLayers.map(obj => (
          <LayerItem key={obj.id} obj={obj} depth={0}
            selectedIds={selectedIds} setSelectedIds={setSelectedIds}
            updateObject={updateObject} removeObject={removeObject} pushUndo={pushUndo}
            expandedGroups={expandedGroups} toggleExpand={toggleExpand}
            isMaskShape={false}
            dragState={dragState} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
            flatIds={flatIds} lastClickedRef={lastClickedRef} />
        ))}
      </div>
    </div>
  )
}

