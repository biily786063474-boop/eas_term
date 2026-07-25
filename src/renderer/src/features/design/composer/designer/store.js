/**
 * DesignComposer state management — self-contained zustand store
 * Manages canvas state, layers, selection, undo/redo
 *
 * Objects are plain JS descriptors rendered declaratively by Konva.
 * The store IS the source of truth — no sync needed.
 */
import { create } from 'zustand'
import { CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_BG, DEFAULT_FILL, DEFAULT_WIDTH, DEFAULT_HEIGHT, UNDO_MAX, GRID_SIZE, GRID_COLUMNS, GRID_MARGIN, GRID_GUTTER, GRID_ROWS, GRID_ROW_GUTTER, COLOR_GRID_COLORS } from './constants'
import { textObjectToPaths } from './textOutline'
// [Eas-Term 移植] 迁移文件带到 composer/_shared/ ,相对路径由 ../../ 改为 ../
import { migrateState, SCHEMA_VERSIONS } from '../_shared/composerStateMigration'

const STATE_VERSION = SCHEMA_VERSIONS.design

let _idCounter = Date.now()
function genId() {
  return `obj_${++_idCounter}_${Math.random().toString(36).slice(2, 6)}`
}

function snapshot(state) {
  return JSON.parse(JSON.stringify({
    objects: state.objects.map(o => {
      if (o._liveCanvas) { const { _liveCanvas, ...rest } = o; return rest }
      return o
    }),
    canvasWidth: state.canvasWidth,
    canvasHeight: state.canvasHeight,
    backgroundColor: state.backgroundColor,
  }))
}

export const useUnifiedDesignStore = create((set, get) => ({
  // Canvas dimensions
  canvasWidth: CANVAS_WIDTH,
  canvasHeight: CANVAS_HEIGHT,
  backgroundColor: CANVAS_BG,
  bgOpacity: 1,

  // Plain shape descriptors for Konva (z-order = array index)
  objects: [],

  // Selection — array of object ids
  selectedIds: [],

  // Zoom
  zoom: 1,

  // Layout grid system
  gridType: null,       // null | 'grid' | 'columns' | 'modular'
  gridSize: GRID_SIZE,
  gridSizeY: 0,
  gridColumns: GRID_COLUMNS,
  gridMargin: GRID_MARGIN,
  gridGutter: GRID_GUTTER,
  gridRows: GRID_ROWS,
  gridRowHeight: 0,
  gridRowGutter: GRID_ROW_GUTTER,

  colorGrid: null,
  colorGridColors: COLOR_GRID_COLORS,

  // Active tool: 'select' | 'rect' | 'ellipse' | 'text' | 'pen' | 'line'
  activeTool: 'select',

  // Undo
  _undoStack: [],
  _redoStack: [],

  // -- Actions --
  setCanvasSize: (w, h) => set({ canvasWidth: w, canvasHeight: h }),
  setBackgroundColor: (c) => set({ backgroundColor: c }),
  setGridType: (t) => set({ gridType: t }),
  setGridConfig: (cfg) => set(cfg),
  setActiveTool: (t) => set({ activeTool: t }),
  // Guard against NaN / Infinity / non-finite — once NaN enters zoom it
  // propagates to Stage scaleX/scaleY and every transform downstream, causing
  // the "Konva warning: NaN" flood and a frozen canvas. Fallback to previous
  // valid zoom (or 1 if unknown).
  setZoom: (z) => set((s) => {
    const num = Number(z)
    if (!Number.isFinite(num)) return { zoom: s.zoom || 1 }
    return { zoom: Math.max(0.1, Math.min(5, num)) }
  }),
  setSelectedIds: (ids) => set({ selectedIds: ids }),

  // Add a shape descriptor. Auto-generates id if missing.
  addObject: (obj) => {
    const id = obj.id || genId()
    const full = {
      id,
      type: 'rect',
      x: 0,
      y: 0,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      fill: DEFAULT_FILL,
      stroke: '',
      strokeWidth: 0,
      opacity: 1,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      cornerRadius: 0,
      visible: true,
      locked: false,
      ...obj,
      id, // ensure generated id wins
    }
    set((s) => ({ objects: [...s.objects, full] }))
    return id
  },

  // Partial update by id
  updateObject: (id, changes) => {
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, ...changes } : o)),
    }))
  },

  // Remove by id
  removeObject: (id) => {
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selectedIds: s.selectedIds.filter((sid) => sid !== id),
    }))
  },

  // Change z-order: move object to newIndex in the array
  reorderObject: (id, newIndex) => {
    set((s) => {
      const arr = [...s.objects]
      const curIdx = arr.findIndex((o) => o.id === id)
      if (curIdx === -1) return s
      const [item] = arr.splice(curIdx, 1)
      const clamped = Math.max(0, Math.min(arr.length, newIndex))
      arr.splice(clamped, 0, item)
      return { objects: arr }
    })
  },

  // Group selected objects — wraps them in a group container
  groupObjects: (ids) => {
    if (!ids || ids.length < 1) return null
    set((s) => {
      const groupId = genId()
      // Collect children in current z-order
      const children = s.objects.filter(o => ids.includes(o.id))
      if (children.length < 2) return s
      // Calculate bounding box
      let minX = Infinity, minY = Infinity
      children.forEach(c => { minX = Math.min(minX, c.x || 0); minY = Math.min(minY, c.y || 0) })
      // Offset children positions relative to group
      const offsetChildren = children.map(c => ({ ...c, x: (c.x || 0) - minX, y: (c.y || 0) - minY }))
      // Remove children from top level, insert group
      const remaining = s.objects.filter(o => !ids.includes(o.id))
      const insertIdx = s.objects.findIndex(o => ids.includes(o.id))
      const group = {
        id: groupId, type: 'group', x: minX, y: minY,
        width: 0, height: 0, children: offsetChildren,
        fill: '', stroke: '', strokeWidth: 0, opacity: 1,
        rotation: 0, scaleX: 1, scaleY: 1, visible: true, locked: false,
        expanded: true,
      }
      remaining.splice(Math.max(0, insertIdx), 0, group)
      return { objects: remaining, selectedIds: [groupId] }
    })
  },

  // Ungroup — dissolve group/mask back to individual objects
  ungroupObject: (groupId) => {
    set((s) => {
      const group = s.objects.find(o => o.id === groupId)
      if (!group || (group.type !== 'group' && group.type !== 'mask')) return s
      const gx = group.x || 0, gy = group.y || 0
      const restored = (group.children || []).map(c => ({
        ...c, x: (c.x || 0) + gx, y: (c.y || 0) + gy,
      }))
      const idx = s.objects.findIndex(o => o.id === groupId)
      const arr = [...s.objects]
      arr.splice(idx, 1, ...restored)
      return { objects: arr, selectedIds: restored.map(c => c.id) }
    })
  },

  // Create mask — bottom shape (first in z-order / lowest in selection) defines clip area
  // children[0] = mask shape (only outline shown, no fill/stroke, defines clip boundary)
  // children[1..] = content that is clipped to the mask shape area
  createMask: (ids) => {
    if (!ids || ids.length < 2) return null
    set((s) => {
      const maskId = genId()
      // Collect selected objects in their current z-order (array order)
      const children = s.objects.filter(o => ids.includes(o.id))
      if (children.length < 2) return s
      // children[0] = bottom-most = mask shape
      let minX = Infinity, minY = Infinity
      children.forEach(c => { minX = Math.min(minX, c.x || 0); minY = Math.min(minY, c.y || 0) })
      const offsetChildren = children.map(c => ({ ...c, x: (c.x || 0) - minX, y: (c.y || 0) - minY }))
      const remaining = s.objects.filter(o => !ids.includes(o.id))
      const insertIdx = s.objects.findIndex(o => ids.includes(o.id))
      const mask = {
        id: maskId, type: 'mask', x: minX, y: minY,
        width: 0, height: 0, children: offsetChildren,
        fill: '', stroke: '', strokeWidth: 0, opacity: 1,
        rotation: 0, scaleX: 1, scaleY: 1, visible: true, locked: false,
        expanded: true,
      }
      remaining.splice(Math.max(0, insertIdx), 0, mask)
      return { objects: remaining, selectedIds: [maskId] }
    })
  },

  // Reorder a child within its parent group/mask
  reorderChild: (parentId, childId, newIndex) => {
    set((s) => ({
      objects: s.objects.map(o => {
        if (o.id !== parentId || !o.children) return o
        const arr = [...o.children]
        const curIdx = arr.findIndex(c => c.id === childId)
        if (curIdx === -1) return o
        const [item] = arr.splice(curIdx, 1)
        const clamped = Math.max(0, Math.min(arr.length, newIndex))
        arr.splice(clamped, 0, item)
        const updated = { ...o, children: arr }
        return updated
      }),
    }))
  },

  // Update a child inside a group/mask
  updateChild: (parentId, childId, changes) => {
    // Recursive: parent may itself be nested inside another group/mask.
    const patch = (list) => list.map(o => {
      if (o.id === parentId && Array.isArray(o.children)) {
        return { ...o, children: o.children.map(c => c.id === childId ? { ...c, ...changes } : c) }
      }
      if (Array.isArray(o.children)) {
        const next = patch(o.children)
        return next === o.children ? o : { ...o, children: next }
      }
      return o
    })
    set((s) => ({ objects: patch(s.objects) }))
  },

  // Convert a text object to a group of per-character outlined paths.
  // Replaces the text in-place (works for top-level or nested text).
  // Group name = original text content. Returns the new group id, or null on failure.
  outlineText: (id) => {
    let resultId = null
    set((s) => {
      // Locate the text object in the tree
      const findInTree = (list) => {
        for (const o of list) {
          if (o.id === id) return o
          if (Array.isArray(o.children)) {
            const f = findInTree(o.children)
            if (f) return f
          }
        }
        return null
      }
      const target = findInTree(s.objects)
      if (!target || target.type !== 'text') return s

      const paths = textObjectToPaths(target)
      if (!paths || paths.length === 0) return s

      const groupId = genId()
      const childrenWithIds = paths.map(p => ({ ...p, id: genId() }))

      const groupName = (target.text || '').toString().slice(0, 24) || '文字轮廓'

      const newGroup = {
        id: groupId,
        type: 'group',
        name: groupName,
        x: target.x || 0,
        y: target.y || 0,
        width: 0,
        height: 0,
        children: childrenWithIds,
        fill: '',
        stroke: '',
        strokeWidth: 0,
        opacity: target.opacity ?? 1,
        rotation: target.rotation || 0,
        scaleX: target.scaleX ?? 1,
        scaleY: target.scaleY ?? 1,
        blendMode: target.blendMode,
        visible: true,
        locked: false,
        expanded: true,
      }

      // Replace text with group at whatever depth it lives
      const replaceInTree = (list) => list.map(o => {
        if (o.id === id) return newGroup
        if (Array.isArray(o.children)) {
          const next = replaceInTree(o.children)
          return next === o.children ? o : { ...o, children: next }
        }
        return o
      })

      resultId = groupId
      return { objects: replaceInTree(s.objects), selectedIds: [groupId] }
    })
    return resultId
  },

  pushUndo: () => {
    const s = get()
    set({ _undoStack: [...s._undoStack.slice(-UNDO_MAX), snapshot(s)], _redoStack: [] })
  },
  undo: () => {
    const s = get()
    if (s._undoStack.length === 0) return null
    const prev = s._undoStack[s._undoStack.length - 1]
    set({
      _undoStack: s._undoStack.slice(0, -1),
      _redoStack: [...s._redoStack, snapshot(s)],
      objects: prev.objects,
      canvasWidth: prev.canvasWidth,
      canvasHeight: prev.canvasHeight,
      backgroundColor: prev.backgroundColor,
      selectedIds: [],
    })
    return prev
  },
  redo: () => {
    const s = get()
    if (s._redoStack.length === 0) return null
    const next = s._redoStack[s._redoStack.length - 1]
    set({
      _redoStack: s._redoStack.slice(0, -1),
      _undoStack: [...s._undoStack, snapshot(s)],
      objects: next.objects,
      canvasWidth: next.canvasWidth,
      canvasHeight: next.canvasHeight,
      backgroundColor: next.backgroundColor,
      selectedIds: [],
    })
    return next
  },
  canUndo: () => get()._undoStack.length > 0,
  canRedo: () => get()._redoStack.length > 0,

  // Align selected objects
  alignObjects: (direction) => {
    const { selectedIds, objects, canvasWidth, canvasHeight } = get()
    const sel = selectedIds.map(id => objects.find(o => o.id === id)).filter(Boolean)
    if (sel.length === 0) return

    // Helper: get bounding box { x, y, w, h } in canvas coords
    // For groups/text, uses Konva getClientRect for accurate bounds
    const stage = window.__ucStage
    const layer = stage?.findOne?.('Layer')
    const getBox = (o) => {
      const ox = o.x || 0, oy = o.y || 0
      const fallback = { x: ox, y: oy, w: o.width || 100, h: o.height || 100 }
      if (!layer) return fallback
      try {
        let node = null
        for (const n of (layer.children || [])) {
          if (n.getAttr('data-id') === o.id) { node = n; break }
        }
        if (!node || typeof node.getClientRect !== 'function') return fallback
        const cr = node.getClientRect({ relativeTo: layer, skipShadow: true, skipStroke: true })
        if (!cr || !cr.width) return fallback
        return { x: cr.x, y: cr.y, w: cr.width, h: cr.height }
      } catch { return fallback }
    }

    // Compute bounds using actual bounding boxes
    const boxes = sel.map(o => ({ o, box: getBox(o) }))
    const bounds = sel.length === 1
      ? { l: 0, t: 0, r: canvasWidth, b: canvasHeight }
      : boxes.reduce((acc, { box }) => ({
          l: Math.min(acc.l, box.x),
          t: Math.min(acc.t, box.y),
          r: Math.max(acc.r, box.x + box.w),
          b: Math.max(acc.b, box.y + box.h),
        }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity })

    const updates = {}
    for (const { o, box } of boxes) {
      // offset = difference between store x/y and actual bounding box x/y
      // (for groups, bbox.x may differ from o.x due to children offset)
      const offX = (o.x || 0) - box.x
      const offY = (o.y || 0) - box.y
      switch (direction) {
        case 'left':       updates[o.id] = { x: bounds.l + offX }; break
        case 'center-h':   updates[o.id] = { x: (bounds.l + bounds.r) / 2 - box.w / 2 + offX }; break
        case 'right':      updates[o.id] = { x: bounds.r - box.w + offX }; break
        case 'top':        updates[o.id] = { y: bounds.t + offY }; break
        case 'center-v':   updates[o.id] = { y: (bounds.t + bounds.b) / 2 - box.h / 2 + offY }; break
        case 'bottom':     updates[o.id] = { y: bounds.b - box.h + offY }; break
      }
    }
    // Distribute
    if (direction === 'distribute-h' && boxes.length >= 3) {
      const sorted = [...boxes].sort((a, b) => a.box.x - b.box.x)
      const totalW = sorted.reduce((s, { box }) => s + box.w, 0)
      const space = (bounds.r - bounds.l - totalW) / Math.max(1, sorted.length - 1)
      let cx = bounds.l
      for (const { o, box } of sorted) {
        const offX = (o.x || 0) - box.x
        updates[o.id] = { x: cx + offX }
        cx += box.w + space
      }
    }
    if (direction === 'distribute-v' && boxes.length >= 3) {
      const sorted = [...boxes].sort((a, b) => a.box.y - b.box.y)
      const totalH = sorted.reduce((s, { box }) => s + box.h, 0)
      const space = (bounds.b - bounds.t - totalH) / Math.max(1, sorted.length - 1)
      let cy = bounds.t
      for (const { o, box } of sorted) {
        const offY = (o.y || 0) - box.y
        updates[o.id] = { y: cy + offY }
        cy += box.h + space
      }
    }
    set(s => ({
      objects: s.objects.map(o => updates[o.id] ? { ...o, ...updates[o.id] } : o),
    }))
  },

  // Serialize full state for node persistence (strip non-serializable refs)
  serialize: () => {
    const s = get()
    return {
      v: STATE_VERSION,
      objects: s.objects.map(o => {
        if (o._liveCanvas) { const { _liveCanvas, ...rest } = o; return rest }
        return o
      }),
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight,
      backgroundColor: s.backgroundColor,
      bgOpacity: s.bgOpacity ?? 1,
    }
  },

  // Restore from saved state
  restore: (raw) => {
    if (!raw) return
    const saved = migrateState(raw, 'design')
    set({
      objects: saved.objects || [],
      canvasWidth: saved.canvasWidth || CANVAS_WIDTH,
      canvasHeight: saved.canvasHeight || CANVAS_HEIGHT,
      backgroundColor: saved.backgroundColor || CANVAS_BG,
      bgOpacity: saved.bgOpacity ?? 1,
      _undoStack: [],
      _redoStack: [],
      selectedIds: [],
      activeTool: 'select',
      zoom: 1,
    })
  },

  reset: () => set({
    objects: [],
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    backgroundColor: CANVAS_BG,
    _undoStack: [],
    _redoStack: [],
    selectedIds: [],
    activeTool: 'select',
    zoom: 1,
  }),
}))
