/**
 * UnifiedComposer — Jitter 式设计 + 动画合一 Composer
 *
 * 策略(2026-05-29 用户拍板):整体 fork DC,基于完整 DC 做增量动画实现。
 *  - designer/ 是 DC 完整副本(cp -r + sed dc__→uc__ + useDesignStore→useUnifiedDesignStore)
 *  - DesignerView.jsx 是 DC index.jsx 的副本(改名 + 加 topbarCenter prop)
 *  - 本文件是顶层 thin wrapper:portal-less(.uc 自身 fixed)/ mode 切换 / savedState 包装
 *
 * mode='design' → 渲染 <DesignerView />(完整 DC UI),topbarCenter 注入 segmented
 * mode='animate' → 渲染 <AnimatePlaceholder />(Phase 2 接通底部时间轴 + keyframe + preset)
 *
 * _unifiedState v=1:
 *   { v:1, mode:'design'|'animate', designState (DC v=1 子结构), motionState (Motion v=2 子结构) }
 *
 * 切 mode 时:强制 flush(决策书 §3.5)
 *
 * 来源:UnifiedComposer/CONTRACT.md(完整契约)
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import DesignerView from './designer/DesignerView'
import AnimateView from './animate/AnimateView'
import UCErrorBoundary from './ErrorBoundary'
import { rebuildMotionFromDesign as rebuildMotionFromDesignPure } from './rebuildMotion'
import './designer/styles.css'
import './animate/styles.css'

function UnifiedComposerInner({
  nodeId,
  savedState,
  designInputs = [],
  mediaInputs = [],
  onSaveState,
  onExport,
  onClose,
}) {
  const [mode, setMode] = useState(savedState?.mode === 'animate' ? 'animate' : 'design')
  const lastDesignStateRef = useRef(savedState?.designState ?? null)
  const lastMotionStateRef = useRef(savedState?.motionState ?? null)

  // 包装 DesignerView 的 onSaveState:把 designState 子结构合到 _unifiedState
  const handleDesignSave = useCallback((designState) => {
    lastDesignStateRef.current = designState
    onSaveState?.({
      v: 1,
      mode,
      designState,
      motionState: lastMotionStateRef.current,
    })
  }, [mode, onSaveState])

  // mode 切换时强制 flush(决策书 §3.5,防 setMode 后崩溃丢数据)
  // 用 ref 避开初始 mount 时也触发
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    onSaveState?.({
      v: 1,
      mode,
      designState: lastDesignStateRef.current,
      motionState: lastMotionStateRef.current,
    })
  }, [mode]) // eslint-disable-line

  // mode='animate' 时 DesignerView 不渲染,Esc 无监听 — wrapper 兜底
  useEffect(() => {
    if (mode !== 'animate') return
    const fn = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [mode, onClose])

  /**
   * 节点内操作隔离 — 防 Backspace/Delete 删外部画板节点(2026-05-31 用户需求)
   *
   * 现象:Backspace 在 unified composer 内打开时会冒泡到外部 useCanvasStore
   *      的 removeSelected,误删画板上的节点。
   *
   * 修法:UnifiedComposer mount 时挂全局 keydown(capture phase)+ stopImmediatePropagation
   *      把事件源在 .uc / .ua 内的 Backspace/Delete 阻断,防止后续 listener 触发。
   *
   * 注意:不阻止 AnimateView 自己内部的 kf 删除 — AnimateView 的 listener 也用 capture
   *      phase + 在 wrapper 之后挂载,因 React effect 子先于父,所以子先 fired。
   *
   * 此外:Cmd+Z / Cmd+A 等 modifier 组合,只在事件源在 unified composer 内才阻断,
   *      保证外部画板 undo 不被吃。
   */
  useEffect(() => {
    const ISOLATED_KEYS = new Set(['Backspace', 'Delete'])
    const fn = (e) => {
      if (!ISOLATED_KEYS.has(e.key)) return
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      // 只阻断事件源在 unified composer 内的(.uc 设计态根 / .ua 动画态根)
      const node = e.target
      if (node && typeof node.closest === 'function' && node.closest('.uc, .ua')) {
        e.stopImmediatePropagation()
      }
    }
    // capture phase 必须早于外部 canvas 的 Backspace listener
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  }, [])

  const segmented = (
    <div className="uc__mode-seg" role="tablist" aria-label="Composer mode">
      <button
        role="tab"
        className={`uc__mode-seg-btn${mode === 'design' ? ' is-active' : ''}`}
        onClick={() => setMode('design')}
        data-tip="设计模式 (M)"
      >设计</button>
      <button
        role="tab"
        className={`uc__mode-seg-btn${mode === 'animate' ? ' is-active' : ''}`}
        onClick={() => setMode('animate')}
        data-tip="动画模式 (M) — Phase 2 即将接通"
      >动画</button>
    </div>
  )

  // M 键全局 toggle(沿用 Jitter 肌肉记忆)
  useEffect(() => {
    const fn = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() === 'm') {
        setMode((m) => (m === 'design' ? 'animate' : 'design'))
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  // ── 双向同步工具函数 ──

  // 2026-06-03 cornerRadius 加入 motion→design 反向同步(rect-only,但 non-rect layer
  // 没 cornerRadius kf,kfs.length 始终 0,该循环对非 rect 是 no-op,无副作用)
  const SYNC_PROPS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity', 'cornerRadius']

  // 递归找 design.objects 树里 id 对应的 object
  const findDesignObjectById = useCallback(function find(list, id) {
    if (!Array.isArray(list)) return null
    for (const o of list) {
      if (o.id === id) return o
      if (Array.isArray(o.children)) {
        const c = find(o.children, id)
        if (c) return c
      }
    }
    return null
  }, [])

  // 递归遍历 motion layers(支持 group children)
  const walkMotionLayers = useCallback((layers, visitor) => {
    if (!Array.isArray(layers)) return
    for (const l of layers) {
      visitor(l)
      if (Array.isArray(l.children)) walkMotionLayers(l.children, visitor)
    }
  }, [])

  /**
   * 完整 rebuild motionState from designState(2026-05-29 用户反馈"设计增删改不同步"修复)
   *
   * 处理 case:
   *  - design 新增 object → motion 加新 layer(初始 kf 来自 design base)
   *  - design 删除 object → motion 同 sourceId layer 自动消失(orphan 清理)
   *  - design 改非动画字段(fill / text / cornerRadius...)→ motion base 直接覆盖
   *  - design 改动画字段(x/y/rotation/scale/opacity):
   *    - 该 layer 该属性 keyframes ≤ 1(没真正做动画)→ 用 design 最新值覆盖 base + init kf
   *    - keyframes ≥ 2(用户做过动画)→ 保留 motion 自己的 base + keyframes(不破坏动画)
   *  - group/mask children 递归同步
   *  - 顺序按 design.objects 保留(支持 z-order 调整)
   *  - 保留每个已有 layer 的:inPoint/outPoint/presets/keyframes(动画化的)/name/id(layer 自己的 id 不变)
   */
  // rebuildMotionFromDesign 已提取为纯函数模块(2026-06-05 预合成产物渲染复用),
  // 行为逐字不变;此处保留同名引用,调用方零改动。
  const rebuildMotionFromDesign = rebuildMotionFromDesignPure

  // 切到 animate 时 useMemo 同步重建(在 AnimateView render 之前,确保拿到最新)
  const motionStateForAnimate = useMemo(() => {
    if (mode !== 'animate') return lastMotionStateRef.current
    if (!lastDesignStateRef.current?.objects?.length) return lastMotionStateRef.current
    return rebuildMotionFromDesign(lastMotionStateRef.current, lastDesignStateRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, rebuildMotionFromDesign])

  // 把同步后的 motionState 回写 ref(让 design mode 切回时持久化生效)
  useEffect(() => {
    if (mode === 'animate' && motionStateForAnimate && motionStateForAnimate !== lastMotionStateRef.current) {
      lastMotionStateRef.current = motionStateForAnimate
    }
  }, [mode, motionStateForAnimate])

  // 把 designState 包成 MotionComposer 期望的 designInputs 形状(给 importDesignState 用,fallback 路径)
  const animateDesignInputs = useMemo(() => {
    if (!lastDesignStateRef.current) return []
    return [{ nodeId, title: '设计图层', state: lastDesignStateRef.current }]
  }, [nodeId, mode])

  const handleAnimateSave = useCallback((motionState) => {
    // 动画 → 设计 同步(2026-05-29 用户需求):无 keyframe 时拖图层回写设计 base
    // 递归遍历 motion layers(含 group children),按 sourceId 找 design object 同步
    const ds = lastDesignStateRef.current
    if (ds?.objects?.length && motionState?.layers?.length) {
      const updates = new Map() // sourceId → partial changes
      walkMotionLayers(motionState.layers, (layer) => {
        if (!layer.sourceId) return
        const target = findDesignObjectById(ds.objects, layer.sourceId)
        if (!target) return
        const changes = {}
        for (const prop of SYNC_PROPS) {
          const kfs = layer.keyframes?.[prop] || []
          if (kfs.length <= 1) {
            const v = layer.base?.[prop]
            if (v !== undefined && v !== target[prop]) {
              changes[prop] = v
            }
          }
        }
        if (Object.keys(changes).length) updates.set(target.id, changes)
      })

      if (updates.size) {
        // 递归 update design.objects 树(支持 group children 也回写)
        const patch = (list) => list.map((o) => {
          let next = o
          if (updates.has(o.id)) next = { ...next, ...updates.get(o.id) }
          if (Array.isArray(o.children)) {
            const newChildren = patch(o.children)
            if (newChildren !== o.children) next = { ...next, children: newChildren }
          }
          return next
        })
        lastDesignStateRef.current = { ...ds, objects: patch(ds.objects) }
      }
    }
    lastMotionStateRef.current = motionState
    onSaveState?.({
      v: 1,
      mode,
      designState: lastDesignStateRef.current,
      motionState,
    })
  }, [mode, onSaveState, findDesignObjectById, walkMotionLayers])

  // ── design mode:渲染完整 DesignerView ──
  if (mode === 'design') {
    return (
      <DesignerView
        key={`design-${nodeId}`}
        nodeId={nodeId}
        savedState={lastDesignStateRef.current}
        mediaInputs={mediaInputs}
        onClose={onClose}
        onSaveState={handleDesignSave}
        onExport={onExport}
        topbarCenter={segmented}
      />
    )
  }

  // ── animate mode:渲染完整 AnimateView(MC fork)──
  // savedState 用 motionStateForAnimate(已 rebuild from design):每次切到 animate
  // 都是新 mount(前一帧是 DesignerView),AnimateView mount 时 restore 拿到最新同步后的状态
  return (
    <AnimateView
      key={`animate-${nodeId}`}
      nodeId={nodeId}
      savedState={motionStateForAnimate}
      designInputs={animateDesignInputs}
      mediaInputs={mediaInputs}
      onClose={onClose}
      onSaveState={handleAnimateSave}
      onExport={onExport}
      topbarCenter={segmented}
    />
  )
}

// 外层 ErrorBoundary 包装:防 mount throw 黑屏
export default function UnifiedComposer(props) {
  return (
    <UCErrorBoundary onClose={props.onClose}>
      <UnifiedComposerInner {...props} />
    </UCErrorBoundary>
  )
}
