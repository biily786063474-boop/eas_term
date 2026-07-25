/**
 * MotionComposer state — keyframe-based animation system
 *
 * Each layer has a `keyframes` object:
 *   { x: [{t, v, easing}, ...], y: [...], opacity: [...], rotation: [...], scaleX: [...], scaleY: [...] }
 * Values are interpolated between keyframes at render time.
 *
 * Each layer also has a `presets` object (filter layer, additive on top of keyframes):
 *   { enter:    { name, duration, delay, strength } | null,
 *     continuous:{ name, speed, strength }            | null,
 *     exit:     { name, duration, strength }           | null }
 * See presetEngine.js for the rendering math.
 *
 * Persisted state schema version: 2 (was 1 before presets).
 */
import { create } from 'zustand'
import { getPresetData as getPresetDefault, getPresetMeta, PRESETS_LIB } from './presets'
// [Eas-Term 移植] 迁移文件带到 composer/_shared/ ,相对路径由 ../../ 改为 ../
import { migrateState, SCHEMA_VERSIONS } from '../_shared/composerStateMigration'

const STATE_VERSION = SCHEMA_VERSIONS.motion

let _id = Date.now()
function gid(p = 'l') { return `${p}_${++_id}_${Math.random().toString(36).slice(2, 5)}` }

// Animatable properties with defaults
const ANIM_PROPS = { x: 0, y: 0, opacity: 1, rotation: 0, scaleX: 1, scaleY: 1 }

const EMPTY_PRESETS = () => ({ enter: null, continuous: null, exit: null })

/**
 * 递归在 layers tree(含 group/mask children)里找 id 对应的 layer,应用 patchFn
 * 返回新树(immutable patch);若没找到则返回原引用
 *
 * 2026-05-31 用户需求:group 内 child 可独立 K 帧 / 加预设动画 / 改基础值
 */
function patchLayerInTree(layers, id, patchFn) {
  let changed = false
  const next = layers.map(l => {
    if (l.id === id) {
      const patched = patchFn(l)
      if (patched !== l) changed = true
      return patched
    }
    if (Array.isArray(l.children)) {
      const newChildren = patchLayerInTree(l.children, id, patchFn)
      if (newChildren !== l.children) {
        changed = true
        return { ...l, children: newChildren }
      }
    }
    return l
  })
  return changed ? next : layers
}

/** 递归在 layers tree 中按 id 查找 layer(支持 group children),用于 selectedLayer */
export function findLayerInTree(layers, id) {
  if (!Array.isArray(layers) || !id) return null
  for (const l of layers) {
    if (l.id === id) return l
    if (Array.isArray(l.children)) {
      const c = findLayerInTree(l.children, id)
      if (c) return c
    }
  }
  return null
}

/** 递归从树里删除 layer(连同 children 一起)*/
function removeLayerFromTree(layers, id) {
  const filtered = layers.filter(l => l.id !== id)
  if (filtered.length !== layers.length) return filtered
  let changed = false
  const next = layers.map(l => {
    if (Array.isArray(l.children)) {
      const newChildren = removeLayerFromTree(l.children, id)
      if (newChildren !== l.children) {
        changed = true
        return { ...l, children: newChildren }
      }
    }
    return l
  })
  return changed ? next : layers
}

/**
 * Materialize 预设动画为真实 keyframes(2026-05-29 用户需求)
 *
 * 输入:stage / presetName / presetDur(动画段时长)/ layerDur(layer 总时长)/ base(layer.base)
 * 输出:{ propName: [{t, v, easing}, ...] }(不带 presetGroupId,调用方添加)
 *
 * 白名单覆盖最常用 ~25 个预设;白名单外返回 {} → setLayerPreset 走 legacy applyPresetDelta 滤镜路径
 *
 * 时间约定:
 *  - enter:[0, presetDur]
 *  - exit:[layerDur - presetDur, layerDur]
 *  - continuous:[0, layerDur] 完整 loop
 */
function generatePresetKeyframes(stage, presetName, presetDur, layerDur, base) {
  const out = {}
  const x0 = base?.x ?? 0
  const y0 = base?.y ?? 0
  const sx0 = base?.scaleX ?? 1
  const sy0 = base?.scaleY ?? 1
  const r0 = base?.rotation ?? 0
  const op0 = base?.opacity ?? 1
  const OFFSET = 60 // 滑入/滑出 距离

  if (stage === 'enter') {
    const easing = 'easeOut'
    const T = presetDur
    switch (presetName) {
      case 'fadeIn':
        out.opacity = [{ t: 0, v: 0, easing }, { t: T, v: op0, easing }]
        break
      case 'slideUpIn':
      case 'slideUp':
        out.y = [{ t: 0, v: y0 + OFFSET, easing }, { t: T, v: y0, easing }]
        out.opacity = [{ t: 0, v: 0, easing }, { t: T, v: op0, easing }]
        break
      case 'slideDownIn':
      case 'slideDown':
        out.y = [{ t: 0, v: y0 - OFFSET, easing }, { t: T, v: y0, easing }]
        out.opacity = [{ t: 0, v: 0, easing }, { t: T, v: op0, easing }]
        break
      case 'slideLeftIn':
      case 'slideLeft':
        out.x = [{ t: 0, v: x0 + OFFSET, easing }, { t: T, v: x0, easing }]
        out.opacity = [{ t: 0, v: 0, easing }, { t: T, v: op0, easing }]
        break
      case 'slideRightIn':
      case 'slideRight':
        out.x = [{ t: 0, v: x0 - OFFSET, easing }, { t: T, v: x0, easing }]
        out.opacity = [{ t: 0, v: 0, easing }, { t: T, v: op0, easing }]
        break
      case 'scaleIn':
        out.scaleX = [{ t: 0, v: 0, easing }, { t: T, v: sx0, easing }]
        out.scaleY = [{ t: 0, v: 0, easing }, { t: T, v: sy0, easing }]
        out.opacity = [{ t: 0, v: 0, easing }, { t: T, v: op0, easing }]
        break
      case 'popIn':
      case 'bounceIn':
        out.scaleX = [{ t: 0, v: 0, easing: 'spring' }, { t: T, v: sx0, easing: 'spring' }]
        out.scaleY = [{ t: 0, v: 0, easing: 'spring' }, { t: T, v: sy0, easing: 'spring' }]
        out.opacity = [{ t: 0, v: 0, easing: 'easeOut' }, { t: T * 0.5, v: op0, easing }]
        break
      case 'rotateIn':
      case 'spinIn':
        out.rotation = [{ t: 0, v: r0 - 180, easing }, { t: T, v: r0, easing }]
        out.opacity = [{ t: 0, v: 0, easing }, { t: T, v: op0, easing }]
        break
      case 'zoomIn':
        out.scaleX = [{ t: 0, v: sx0 * 0.5, easing }, { t: T, v: sx0, easing }]
        out.scaleY = [{ t: 0, v: sy0 * 0.5, easing }, { t: T, v: sy0, easing }]
        out.opacity = [{ t: 0, v: 0, easing }, { t: T, v: op0, easing }]
        break
      case 'zoomOutIn':
        out.scaleX = [{ t: 0, v: sx0 * 1.5, easing }, { t: T, v: sx0, easing }]
        out.scaleY = [{ t: 0, v: sy0 * 1.5, easing }, { t: T, v: sy0, easing }]
        out.opacity = [{ t: 0, v: 0, easing }, { t: T, v: op0, easing }]
        break
    }
  } else if (stage === 'exit') {
    const easing = 'easeIn'
    const startT = Math.max(0, layerDur - presetDur)
    const endT = layerDur
    switch (presetName) {
      case 'fadeOut':
        out.opacity = [{ t: startT, v: op0, easing }, { t: endT, v: 0, easing }]
        break
      case 'slideUpOut':
      case 'slideUp':
        out.y = [{ t: startT, v: y0, easing }, { t: endT, v: y0 - OFFSET, easing }]
        out.opacity = [{ t: startT, v: op0, easing }, { t: endT, v: 0, easing }]
        break
      case 'slideDownOut':
      case 'slideDown':
        out.y = [{ t: startT, v: y0, easing }, { t: endT, v: y0 + OFFSET, easing }]
        out.opacity = [{ t: startT, v: op0, easing }, { t: endT, v: 0, easing }]
        break
      case 'slideLeftOut':
      case 'slideLeft':
        out.x = [{ t: startT, v: x0, easing }, { t: endT, v: x0 - OFFSET, easing }]
        out.opacity = [{ t: startT, v: op0, easing }, { t: endT, v: 0, easing }]
        break
      case 'slideRightOut':
      case 'slideRight':
        out.x = [{ t: startT, v: x0, easing }, { t: endT, v: x0 + OFFSET, easing }]
        out.opacity = [{ t: startT, v: op0, easing }, { t: endT, v: 0, easing }]
        break
      case 'scaleOut':
        out.scaleX = [{ t: startT, v: sx0, easing }, { t: endT, v: 0, easing }]
        out.scaleY = [{ t: startT, v: sy0, easing }, { t: endT, v: 0, easing }]
        out.opacity = [{ t: startT, v: op0, easing }, { t: endT, v: 0, easing }]
        break
      case 'popOut':
      case 'bounceOut':
        out.scaleX = [{ t: startT, v: sx0, easing: 'spring' }, { t: endT, v: 0, easing: 'spring' }]
        out.scaleY = [{ t: startT, v: sy0, easing: 'spring' }, { t: endT, v: 0, easing: 'spring' }]
        break
      case 'rotateOut':
      case 'spinOut':
        out.rotation = [{ t: startT, v: r0, easing }, { t: endT, v: r0 + 180, easing }]
        out.opacity = [{ t: startT, v: op0, easing }, { t: endT, v: 0, easing }]
        break
    }
  } else if (stage === 'continuous') {
    const easing = 'easeInOut'
    const T = layerDur
    switch (presetName) {
      case 'wobble':
      case 'shake':
        out.rotation = [
          { t: 0, v: r0, easing },
          { t: T * 0.25, v: r0 + 8, easing },
          { t: T * 0.5, v: r0 - 8, easing },
          { t: T * 0.75, v: r0 + 8, easing },
          { t: T, v: r0, easing },
        ]
        break
      case 'pulse':
      case 'heartbeat':
        out.scaleX = [{ t: 0, v: sx0, easing }, { t: T * 0.5, v: sx0 * 1.1, easing }, { t: T, v: sx0, easing }]
        out.scaleY = [{ t: 0, v: sy0, easing }, { t: T * 0.5, v: sy0 * 1.1, easing }, { t: T, v: sy0, easing }]
        break
      case 'float':
      case 'bob':
        out.y = [{ t: 0, v: y0, easing }, { t: T * 0.5, v: y0 - 8, easing }, { t: T, v: y0, easing }]
        break
      case 'rotate':
      case 'spin':
        out.rotation = [{ t: 0, v: r0, easing: 'linear' }, { t: T, v: r0 + 360, easing: 'linear' }]
        break
      case 'breathe':
        out.opacity = [{ t: 0, v: op0, easing }, { t: T * 0.5, v: op0 * 0.6, easing }, { t: T, v: op0, easing }]
        break
    }
  }
  return out
}

export const EASING_OPTIONS = [
  { value: 'linear',    label: '线性' },
  { value: 'easeIn',    label: '缓入' },
  { value: 'easeOut',   label: '缓出' },
  { value: 'easeInOut', label: '缓入缓出' },
  { value: 'spring',    label: '弹性' },
]

function snapshot(s) {
  return JSON.parse(JSON.stringify({ layers: s.layers, duration: s.duration, canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight, backgroundColor: s.backgroundColor }))
}

export const useUnifiedMotionStore = create((set, get) => ({
  canvasWidth: 1920, canvasHeight: 1080, backgroundColor: 'transparent',
  fps: 30, duration: 5,
  layers: [], selectedLayerId: null,
  // 2026-06-03 round-11(group/钻入/选中对齐 designer):多选 ids 数组
  // 协议:selectedIds 是真值字段,selectedLayerId 是首项派生(向后兼容旧消费方)
  //  - selectLayer(id)        → selectedIds = id ? [id] : [], selectedLayerId = id || null
  //  - selectLayers(ids)      → selectedIds = ids, selectedLayerId = ids[0] || null
  //  - toggleLayerSelection   → shift+click 加/减 selectedIds 中的 id
  //  - clearSelection         → 两字段全清
  // ⚠️ 旧字段 selectedLayerId 仍保留(LayersPanel/Timeline/PropertiesPanel 都还在用),
  //    新加多选场景(marquee / shift+click)走 selectedIds,其它路径不变。
  selectedIds: [],
  playhead: 0, playing: false,
  zoom: 1, showBounds: true,
  _undoStack: [], _redoStack: [],

  // ── Import(2026-05-29 改造:保留 group/mask 父子嵌套,子元素 base.x/y 保持相对父级)──
  importDesignState: (ds) => {
    if (!ds?.objects?.length) return
    const dur = get().duration
    const buildLayer = (obj) => {
      if (obj.type === 'canvas') return null
      const initKf = {}
      for (const [prop, def] of Object.entries(ANIM_PROPS)) {
        const val = obj[prop] ?? def
        initKf[prop] = [{ t: 0, v: val, easing: 'easeOut' }]
      }
      const layer = {
        id: gid('l'),
        sourceId: obj.id, // 保 design.objects[id] 链路,wrapper syncBack 用
        name: obj.text?.slice(0, 12) || obj.type,
        type: obj.type,
        base: { ...obj },
        inPoint: 0, outPoint: dur,
        keyframes: initKf,
        presets: EMPTY_PRESETS(),
        visible: obj.visible !== false,
        locked: !!obj.locked,
      }
      // group / mask 递归 children(保持父子坐标关系)
      if ((obj.type === 'group' || obj.type === 'mask') && obj.children?.length) {
        layer.children = obj.children.map(buildLayer).filter(Boolean)
      }
      return layer
    }
    const layers = ds.objects.map(buildLayer).filter(Boolean)
    set({ layers, canvasWidth: ds.canvasWidth || 1920, canvasHeight: ds.canvasHeight || 1080, backgroundColor: ds.backgroundColor || 'transparent' })
  },

  // Import upstream media (images/videos) as layers
  importMedia: (mediaList) => {
    if (!mediaList?.length) return
    const s = get()
    const newLayers = mediaList.map((m, i) => {
      const isVideo = m.type === 'video'
      const initKf = {}
      for (const [prop, def] of Object.entries(ANIM_PROPS)) {
        const val = prop === 'x' ? 0 : prop === 'y' ? 0 : def
        initKf[prop] = [{ t: 0, v: val, easing: 'easeOut' }]
      }
      return {
        id: gid('l'), sourceId: `media_${i}`,
        name: m.name || (isVideo ? '视频' : '图片'),
        type: isVideo ? 'video' : 'image',
        base: {
          type: isVideo ? 'video' : 'image',
          src: m.url, x: 0, y: 0,
          width: s.canvasWidth, height: s.canvasHeight,
          opacity: 1, rotation: 0, scaleX: 1, scaleY: 1,
        },
        inPoint: 0, outPoint: s.duration,
        keyframes: initKf,
        presets: EMPTY_PRESETS(),
        visible: true,
      }
    })
    // Prepend media layers (behind design elements)
    set({ layers: [...newLayers, ...s.layers] })
  },

  // Round-11 multi-select API
  //  ⚠️ 任何 selectLayer / selectLayers / toggleLayerSelection / clearSelection
  //  都同步维护 selectedLayerId(首项)与 selectedIds(完整集),不要绕开。
  selectLayer: (id) => set({ selectedLayerId: id, selectedIds: id ? [id] : [] }),
  selectLayers: (ids) => {
    const arr = Array.isArray(ids) ? ids.filter(Boolean) : []
    set({ selectedIds: arr, selectedLayerId: arr[0] || null })
  },
  toggleLayerSelection: (id) => {
    if (!id) return
    set(s => {
      const cur = s.selectedIds || (s.selectedLayerId ? [s.selectedLayerId] : [])
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
      return { selectedIds: next, selectedLayerId: next[0] || null }
    })
  },
  clearSelection: () => set({ selectedIds: [], selectedLayerId: null }),

  setLayerTiming: (id, inP, outP) => set(s => ({
    layers: patchLayerInTree(s.layers, id, l => ({ ...l, inPoint: inP, outPoint: outP })),
  })),

  // ── Keyframe CRUD(2026-05-31:递归支持 group children)──
  // Set keyframe: insert or update at time t for property prop
  setKeyframe: (layerId, prop, t, value, easing = 'easeOut') => {
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => {
        const kfs = { ...l.keyframes }
        const arr = [...(kfs[prop] || [])]
        const idx = arr.findIndex(k => Math.abs(k.t - t) < 0.01)
        if (idx >= 0) arr[idx] = { ...arr[idx], v: value, easing }
        else arr.push({ t, v: value, easing })
        arr.sort((a, b) => a.t - b.t)
        kfs[prop] = arr
        return { ...l, keyframes: kfs }
      }),
    }))
  },

  // Remove keyframe at time t for property prop
  removeKeyframe: (layerId, prop, t) => {
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => {
        const kfs = { ...l.keyframes }
        kfs[prop] = (kfs[prop] || []).filter(k => Math.abs(k.t - t) > 0.01)
        if (kfs[prop].length === 0) delete kfs[prop]
        return { ...l, keyframes: kfs }
      }),
    }))
  },

  // Set keyframe for current playhead position
  setKeyframeAtPlayhead: (layerId, prop, value) => {
    const t = get().playhead
    get().setKeyframe(layerId, prop, t, value)
  },

  // Update layer base (for dragging in preview)
  updateLayerBase: (layerId, changes) => {
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => ({ ...l, base: { ...l.base, ...changes } })),
    }))
  },

  // Quick: set keyframe for all transform props at current playhead
  addTransformKeyframe: (layerId) => {
    const s = get()
    const layer = findLayerInTree(s.layers, layerId)
    if (!layer) return
    const t = s.playhead
    for (const [prop, def] of Object.entries(ANIM_PROPS)) {
      const val = layer.base[prop] ?? def
      s.setKeyframe(layerId, prop, t, val)
    }
  },

  toggleLayerVisible: (id) => set(s => ({
    layers: patchLayerInTree(s.layers, id, l => ({ ...l, visible: !l.visible })),
  })),

  toggleLayerLocked: (id) => set(s => ({
    layers: patchLayerInTree(s.layers, id, l => ({ ...l, locked: !l.locked })),
  })),
  removeLayer: (id) => {
    get().pushUndo()
    set(s => {
      const remainIds = (s.selectedIds || []).filter(x => x !== id)
      return {
        layers: removeLayerFromTree(s.layers, id),
        selectedLayerId: s.selectedLayerId === id ? (remainIds[0] || null) : s.selectedLayerId,
        selectedIds: remainIds,
      }
    })
  },
  renameLayer: (id, name) => set(s => ({
    layers: patchLayerInTree(s.layers, id, l => ({ ...l, name })),
  })),

  // ── Preset → keyframes materialize(2026-05-29 用户需求:预设变真 kf)──
  //
  // 改造:setLayerPreset 直接生成真实 keyframes 写入 layer.keyframes 各属性,
  // 不再走滤镜层 applyPresetDelta(legacy 路径作为 fallback 保留:如果预设不在
  // generatePresetKeyframes 白名单,仍然存到 layer.presets[stage] 走 applyPresetDelta)。
  //
  // 每个生成的 kf 带 presetGroupId 标识(`${stage}:${presetName}:${ts}`),时间轴 UI
  // 用它视觉区分预设 kf 和基础 kf;后续支持整组拖动也用它。
  setLayerPreset: (layerId, stage, presetName) => {
    if (!['enter', 'continuous', 'exit'].includes(stage)) return
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => {
        const presets = { ...(l.presets || EMPTY_PRESETS()) }

        // 1. 先清掉该 layer 同 stage 的所有 preset-tagged keyframes
        const cleanKfs = {}
        for (const [prop, arr] of Object.entries(l.keyframes || {})) {
          cleanKfs[prop] = (arr || []).filter(k =>
            !k.presetGroupId || !k.presetGroupId.startsWith(`${stage}:`)
          )
        }

        if (!presetName) {
          // 清除模式
          presets[stage] = null
          return { ...l, presets, keyframes: cleanKfs }
        }

        const meta = getPresetMeta(stage, presetName) || PRESETS_LIB.textChar?.[presetName] || null
        if (!meta) return l
        if (meta.layerTypes && meta.layerTypes.length
            && !meta.layerTypes.includes('all')
            && !meta.layerTypes.includes(l.type)) return l

        // 2. 尝试 materialize 成 keyframes
        const layerDur = (l.outPoint - l.inPoint) || 5
        const presetDur = meta.defaultDuration ?? (stage === 'enter' ? 0.6 : stage === 'exit' ? 0.5 : layerDur)
        const kfsToAdd = generatePresetKeyframes(stage, presetName, presetDur, layerDur, l.base)

        if (kfsToAdd && Object.keys(kfsToAdd).length > 0) {
          // ── materialize 路径 ──
          const groupId = `${stage}:${presetName}:${Date.now()}`
          for (const [prop, arr] of Object.entries(kfsToAdd)) {
            const tagged = arr.map(k => ({ ...k, presetGroupId: groupId }))
            // 注意:对预设影响的属性,先清掉该属性的 init kf(t=0 的 base 默认值)
            //  enter/exit 预设的起点 / 终点会作为新的"图层显示值",避免和 init 冲突
            const existing = (cleanKfs[prop] || []).filter(k => !(k.t === 0 && !k.presetGroupId && arr.length > 0))
            cleanKfs[prop] = [...existing, ...tagged].sort((a, b) => a.t - b.t)
          }
          presets[stage] = null // materialize 后不走 legacy 滤镜路径
        } else {
          // ── legacy fallback:白名单外的预设仍然走 applyPresetDelta 滤镜 ──
          const cfg = { name: presetName }
          if (stage === 'enter') { cfg.duration = presetDur; cfg.delay = 0; cfg.strength = 1 }
          else if (stage === 'exit') { cfg.duration = presetDur; cfg.strength = 1 }
          else if (stage === 'continuous') { cfg.speed = 1; cfg.strength = 1 }
          presets[stage] = cfg
        }

        return { ...l, presets, keyframes: cleanKfs }
      }),
    }))
  },

  /**
   * 批量改 keyframe t 值(2026-05-30 用户需求:kf 拖动)
   *  ops: [{ prop, oldT, newT, presetGroupId? }]
   */
  moveMultipleKfsT: (layerId, ops) => set(s => ({
    layers: patchLayerInTree(s.layers, layerId, l => {
      const newKfs = { ...(l.keyframes || {}) }
      const byProp = {}
      for (const op of ops) {
        if (!byProp[op.prop]) byProp[op.prop] = []
        byProp[op.prop].push(op)
      }
      for (const [prop, propOps] of Object.entries(byProp)) {
        const arr = (newKfs[prop] || [])
        const updated = arr.map(k => {
          for (const op of propOps) {
            if (Math.abs(k.t - op.oldT) < 0.0001 && (!op.presetGroupId || k.presetGroupId === op.presetGroupId)) {
              return { ...k, t: op.newT }
            }
          }
          return k
        })
        newKfs[prop] = updated.sort((a, b) => a.t - b.t)
      }
      return { ...l, keyframes: newKfs }
    })
  })),

  setKeyframeEasing: (layerId, prop, t, easing) => {
    get().pushUndo()
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => {
        const arr = (l.keyframes?.[prop] || []).map(k =>
          Math.abs(k.t - t) < 0.0001 ? { ...k, easing } : k
        )
        return { ...l, keyframes: { ...l.keyframes, [prop]: arr } }
      })
    }))
  },

  setKeyframeBezier: (layerId, prop, t, bezier) => {
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => {
        const arr = (l.keyframes?.[prop] || []).map(k =>
          Math.abs(k.t - t) < 0.0001 ? { ...k, easing: bezier } : k
        )
        return { ...l, keyframes: { ...l.keyframes, [prop]: arr } }
      })
    }))
  },

  /**
   * 拆预设组(去掉 presetGroupId,让 kf 变成普通可单独编辑)
   */
  breakPresetGroup: (layerId, groupId) => {
    if (!groupId) return
    get().pushUndo()
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => {
        const newKfs = {}
        for (const [p, arr] of Object.entries(l.keyframes || {})) {
          newKfs[p] = (arr || []).map(k =>
            k.presetGroupId === groupId
              ? (() => { const { presetGroupId: _, ...rest } = k; return rest })()
              : k
          )
        }
        const stage = groupId.split(':')[0]
        const presets = { ...(l.presets || EMPTY_PRESETS()) }
        if (['enter', 'continuous', 'exit'].includes(stage)) presets[stage] = null
        return { ...l, keyframes: newKfs, presets }
      })
    }))
  },

  removeKeyframeAt: (layerId, prop, t, presetGroupId) => {
    get().pushUndo()
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => {
        const arr = (l.keyframes?.[prop] || []).filter(k => {
          if (Math.abs(k.t - t) > 0.0001) return true
          if (presetGroupId && k.presetGroupId !== presetGroupId) return true
          return false
        })
        return { ...l, keyframes: { ...l.keyframes, [prop]: arr } }
      })
    }))
  },

  /**
   * Batch-scale a set of keyframes' time values atomically.
   *
   * Used by Timeline marquee+stretch-handle UI (2026-06-04): user框选 N 个 kf
   * 跨多个时间点 → 拖左/右手柄改 [oldStart, oldEnd] 到 [newStart, newEnd]
   *   → 中间所有 kf 按比例 linear remap:
   *     newT = newStart + (oldT - oldStart) / (oldEnd - oldStart) * (newEnd - newStart)
   *
   * Input format: ops = [{ layerId, prop, oldT, newT }]
   *   Caller does all remap math; this action只负责原子写入 + undo 一次。
   *
   * Constraints:
   *   - 预设组 kf(k.presetGroupId 非空)默认**跳过**(预设作为整体不允许被部分拉伸)
   *     若需要拉伸预设组,UI 层应先调 breakPresetGroup 把整组打散成普通 kf。
   *   - oldT 匹配阈值 0.0001s(与 removeKeyframeAt / setKeyframeBezier 一致)
   *   - newT 不做 clamp(UI 层 onMove 已 clamp 到 [0, duration]),但若 newT 与同
   *     layer/prop 下另一 kf(非本 op 集合内)冲突(< 0.01s),保留新值覆盖现有
   *     (与 setKeyframe 同冲突处理:findIndex 命中即覆盖)。
   *   - 全部写完后 re-sort 每个 (layer, prop) 的 kfs 数组。
   *
   * Side effects: pushUndo 一次(整批一个 undo step);set 一次。
   *
   * 调用示例(UI 层 Timeline 拉伸手柄释放):
   *   const ops = []
   *   for (const { layerId, prop, originalT } of snapshot) {
   *     const newT = newStart + (originalT - oldStart) / (oldEnd - oldStart) * (newEnd - newStart)
   *     ops.push({ layerId, prop, oldT: originalT, newT })
   *   }
   *   useUnifiedMotionStore.getState().batchScaleKeyframes(ops)
   */
  batchScaleKeyframes: (ops) => {
    if (!Array.isArray(ops) || ops.length === 0) return
    get().pushUndo()
    set(s => {
      // 按 layerId 分组,减少 patchLayerInTree 调用次数
      const byLayer = new Map()
      for (const op of ops) {
        if (!op || !op.layerId || !op.prop) continue
        if (typeof op.oldT !== 'number' || typeof op.newT !== 'number') continue
        if (!isFinite(op.oldT) || !isFinite(op.newT)) continue
        if (!byLayer.has(op.layerId)) byLayer.set(op.layerId, [])
        byLayer.get(op.layerId).push(op)
      }
      let layers = s.layers
      for (const [layerId, layerOps] of byLayer.entries()) {
        layers = patchLayerInTree(layers, layerId, l => {
          const kfs = { ...l.keyframes }
          // 按 prop 分组当前 layer 内 ops
          const byProp = new Map()
          for (const op of layerOps) {
            if (!byProp.has(op.prop)) byProp.set(op.prop, [])
            byProp.get(op.prop).push(op)
          }
          for (const [prop, propOps] of byProp.entries()) {
            const arr = [...(kfs[prop] || [])]
            // 标记要改的 kf:用 index → newT 映射(避免 oldT 接近时误中)
            const updates = new Map() // index → newT
            for (const op of propOps) {
              const idx = arr.findIndex(k => Math.abs(k.t - op.oldT) < 0.0001)
              if (idx < 0) continue
              const kf = arr[idx]
              if (kf.presetGroupId) continue // 跳过预设组
              updates.set(idx, op.newT)
            }
            if (updates.size === 0) continue
            // 应用 newT
            for (const [idx, newT] of updates.entries()) {
              arr[idx] = { ...arr[idx], t: newT }
            }
            // 同 prop 内若 newT 与未改 kf 冲突(< 0.01s),保留改后版本覆盖(set 行为)
            // 简化:先 sort,再去重(优先保留 updates 命中的)
            arr.sort((a, b) => a.t - b.t)
            kfs[prop] = arr
          }
          return { ...l, keyframes: kfs }
        })
      }
      return { layers }
    })
  },

  clearLayerPreset: (layerId, stage) => {
    if (!['enter', 'continuous', 'exit'].includes(stage)) return
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => {
        const presets = { ...(l.presets || EMPTY_PRESETS()) }
        presets[stage] = null
        const cleanKfs = {}
        for (const [prop, arr] of Object.entries(l.keyframes || {})) {
          cleanKfs[prop] = (arr || []).filter(k =>
            !k.presetGroupId || !k.presetGroupId.startsWith(`${stage}:`)
          )
        }
        return { ...l, presets, keyframes: cleanKfs }
      }),
    }))
  },

  updateLayerPresetParam: (layerId, stage, key, value) => {
    if (!['enter', 'continuous', 'exit'].includes(stage)) return
    set(s => ({
      layers: patchLayerInTree(s.layers, layerId, l => {
        const presets = { ...(l.presets || EMPTY_PRESETS()) }
        if (!presets[stage]) return l
        presets[stage] = { ...presets[stage], [key]: value }
        return { ...l, presets }
      }),
    }))
  },

  reorderLayer: (id, ni) => set(s => {
    const arr = [...s.layers], ci = arr.findIndex(l => l.id === id)
    if (ci === -1) return s
    const [it] = arr.splice(ci, 1)
    arr.splice(Math.max(0, Math.min(arr.length, ni)), 0, it)
    return { layers: arr }
  }),

  // ── Playback ──
  setPlayhead: (t) => set({ playhead: Math.max(0, Math.min(t, get().duration)) }),
  setPlaying: (v) => set({ playing: v }),
  setDuration: (d) => set({ duration: Math.max(1, d) }),
  setFps: (f) => set({ fps: Math.max(1, Math.min(60, f)) }),

  // ── AI 动画助手 modal 开关 ──
  // [Eas-Term 移植] AI 已整体剥离(不带 MotionAIModal)。以下两字段成为死代码但保留:
  //   纯 UI 显隐状态,不入 serialize()/restore()/reset(),对动画核心零影响,删留皆可。
  motionAIOpen: false,
  setMotionAIOpen: (open) => set({ motionAIOpen: !!open }),
  setZoom: (z) => set({ zoom: Math.max(0.5, Math.min(4, z)) }),
  toggleBounds: () => set(s => ({ showBounds: !s.showBounds })),

  // ── Undo / Redo ──
  pushUndo: () => { const s = get(); set({ _undoStack: [...s._undoStack.slice(-30), snapshot(s)], _redoStack: [] }) },
  undo: () => {
    const s = get(); if (!s._undoStack.length) return
    const prev = s._undoStack[s._undoStack.length - 1]
    set({ _undoStack: s._undoStack.slice(0, -1), _redoStack: [...s._redoStack, snapshot(s)], ...prev, selectedLayerId: null, selectedIds: [] })
  },
  redo: () => {
    const s = get(); if (!s._redoStack.length) return
    const next = s._redoStack[s._redoStack.length - 1]
    set({ _redoStack: s._redoStack.slice(0, -1), _undoStack: [...s._undoStack, snapshot(s)], ...next, selectedLayerId: null, selectedIds: [] })
  },

  serialize: () => {
    const s = get()
    return {
      v: STATE_VERSION,
      canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight, backgroundColor: s.backgroundColor,
      fps: s.fps, duration: s.duration, layers: s.layers,
    }
  },
  restore: (raw) => {
    if (!raw) return
    // Run through the central migration entry — version bump + layer-preset
    // patching now lives in _shared/composerStateMigration.js.
    const d = migrateState(raw, 'motion')
    const layers = Array.isArray(d.layers) ? d.layers : []
    set({
      canvasWidth: d.canvasWidth || 1920,
      canvasHeight: d.canvasHeight || 1080,
      backgroundColor: d.backgroundColor || 'transparent',
      fps: d.fps || 30,
      duration: d.duration || 5,
      layers,
      playhead: 0, playing: false, selectedLayerId: null, selectedIds: [],
    })
  },
  reset: () => set({ layers: [], selectedLayerId: null, selectedIds: [], playhead: 0, playing: false, canvasWidth: 1920, canvasHeight: 1080, backgroundColor: 'transparent', fps: 30, duration: 5, zoom: 1, showBounds: true }),
}))
