/**
 * DesignComposer right-click context menu — Figma-style.
 *
 * Receives all action handlers from the parent so it can stay stateless.
 * Auto-positions inside the viewport, closes on outside click / Escape.
 */
import React, { useEffect, useRef, useState } from 'react'

const SEP = { sep: true }

function shortcut(s) {
  return <span className="uc__cm-kbd">{s}</span>
}

export default function ContextMenu({
  x, y, onClose,
  // selection state
  selectedObj, selectedIds, hasClipboard,
  // history
  canUndo, canRedo,
  // actions
  onUndo, onRedo,
  onCut, onCopy, onPaste,
  onDuplicate, onDelete,
  onGroup, onUngroup, onMask, onReleaseMask,
  onOutlineText,
  onConvertPathToPen,
  onBringToFront, onBringForward, onSendBackward, onSendToBack,
  onAlign,
}) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ x, y })

  // Outside click + Escape
  useEffect(() => {
    const onDocMouse = (e) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    // Use capture so we close before other handlers run
    document.addEventListener('mousedown', onDocMouse, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDocMouse, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  // Reposition if menu would overflow viewport
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    let nx = x, ny = y
    if (rect.width + x > vw - 8) nx = Math.max(8, vw - rect.width - 8)
    if (rect.height + y > vh - 8) ny = Math.max(8, vh - rect.height - 8)
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny })
  }, [x, y, pos.x, pos.y])

  const isSingle = selectedIds.length === 1 && !!selectedObj
  const isMulti = selectedIds.length >= 2
  const hasAny = selectedIds.length >= 0  // alignment etc work even with 0 if single
  const isText = isSingle && selectedObj.type === 'text'
  const isGroup = isSingle && selectedObj.type === 'group'
  const isMask = isSingle && selectedObj.type === 'mask'
  const hasSelection = selectedIds.length > 0
  // SVG-imported path (no penNodes) — eligible for promotion to editable pen object.
  // Pen-created objects (`type: 'pen'`) already have penNodes and are double-click editable.
  const isConvertiblePath = isSingle && selectedObj.type === 'path' && !selectedObj.penNodes?.length

  // Build menu items dynamically — null entries are filtered, SEP marks separators
  const items = [
    canUndo && { label: '撤销',  kbd: '⌘Z',  onClick: onUndo },
    canRedo && { label: '重做',  kbd: '⌘⇧Z', onClick: onRedo },
    (canUndo || canRedo) && SEP,

    hasSelection && { label: '剪切', kbd: '⌘X', onClick: onCut },
    hasSelection && { label: '复制', kbd: '⌘C', onClick: onCopy },
    hasClipboard && { label: '粘贴', kbd: '⌘V', onClick: onPaste },
    hasSelection && { label: '复制副本', kbd: '⌘D', onClick: onDuplicate },
    hasSelection && { label: '删除', kbd: '⌫', onClick: onDelete, danger: true },
    hasSelection && SEP,

    isMulti && { label: '编组', kbd: '⌘G', onClick: onGroup },
    isGroup && { label: '解组', kbd: '⌘⇧G', onClick: onUngroup },
    isMulti && { label: '创建蒙版', onClick: onMask },
    isMask && { label: '释放蒙版', onClick: onReleaseMask },
    (isMulti || isGroup || isMask) && SEP,

    // [Eas-Term 移植] 砍掉「文字轮廓化」「转为可编辑路径(钢笔)」右键菜单项

    isSingle && { label: '置顶', kbd: '⌘]', onClick: onBringToFront },
    isSingle && { label: '上移一层', kbd: '⌘⇧]', onClick: onBringForward },
    isSingle && { label: '下移一层', kbd: '⌘⇧[', onClick: onSendBackward },
    isSingle && { label: '置底', kbd: '⌘[', onClick: onSendToBack },
    isSingle && SEP,

    hasSelection && { submenu: '对齐', items: [
      { label: '左对齐',     kbd: '⌥A', onClick: () => onAlign('left') },
      { label: '水平居中',   kbd: '⌥H', onClick: () => onAlign('center-h') },
      { label: '右对齐',     kbd: '⌥D', onClick: () => onAlign('right') },
      SEP,
      { label: '顶对齐',     kbd: '⌥W', onClick: () => onAlign('top') },
      { label: '垂直居中',   kbd: '⌥V', onClick: () => onAlign('center-v') },
      { label: '底对齐',     kbd: '⌥S', onClick: () => onAlign('bottom') },
      ...(selectedIds.length >= 3 ? [
        SEP,
        { label: '水平等间隔', onClick: () => onAlign('distribute-h') },
        { label: '垂直等间隔', onClick: () => onAlign('distribute-v') },
      ] : []),
    ]},
  ].filter(Boolean)

  // Drop trailing separator
  while (items.length && items[items.length - 1] === SEP) items.pop()
  // Collapse consecutive SEPs
  for (let i = items.length - 1; i > 0; i--) {
    if (items[i] === SEP && items[i - 1] === SEP) items.splice(i, 1)
  }

  return (
    <div ref={ref} className="uc__cm" style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => {
        if (item === SEP) return <div key={`s${i}`} className="uc__cm-sep" />
        if (item.submenu) return <SubMenu key={`m${i}`} label={item.submenu} items={item.items} onClose={onClose} />
        return (
          <button key={`b${i}`}
            className={`uc__cm-item${item.danger ? ' uc__cm-item--danger' : ''}${item.accent ? ' uc__cm-item--accent' : ''}`}
            onClick={() => { item.onClick?.(); onClose() }}>
            <span className="uc__cm-lbl">{item.label}</span>
            {item.kbd && shortcut(item.kbd)}
          </button>
        )
      })}
    </div>
  )
}

function SubMenu({ label, items, onClose }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  return (
    <div ref={ref} className={`uc__cm-sub${open ? ' uc__cm-sub--open' : ''}`}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="uc__cm-item uc__cm-sub-head">
        <span className="uc__cm-lbl">{label}</span>
        <span className="uc__cm-arrow">▸</span>
      </div>
      {open && (
        <div className="uc__cm uc__cm-sub-panel">
          {items.map((it, i) => {
            if (it === SEP) return <div key={`s${i}`} className="uc__cm-sep" />
            return (
              <button key={`b${i}`} className="uc__cm-item"
                onClick={() => { it.onClick?.(); onClose() }}>
                <span className="uc__cm-lbl">{it.label}</span>
                {it.kbd && <span className="uc__cm-kbd">{it.kbd}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
