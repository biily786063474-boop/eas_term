// 全局「活内容层」：所有 tab 的所有 leaf 都渲染在这一个容器里，永不换父。
// 无限画布不断连的地基（实现规划 §5-A）：
//   · split 模式：仅激活 tab 的 leaf 按 computeLayout 显示，其余 display:none（保挂载）。
//   · canvas 模式：被某 Frame 节点引用的 leaf 按「世界坐标 × 视口」像素定位，浮在装饰层之上；
//     未引用 / 折叠 Frame 内的 leaf 隐藏。空白处 pointer-events 穿透给底层画布（见 canvas.css）。
// 无论怎么切模式，PaneView 的父容器与 key(=leaf.id) 都不变 → React 走 update 而非 remount，
// xterm 实例与滚动缓冲全程保留。

import { useMemo, useRef } from 'react'
import { useStore } from '../../store'
import { computeLayout, collectLeaves, LeafRect, DividerRect, Rect } from '../../layout'
import { PaneView, CanvasPlacement } from './PaneView'

const HIDDEN_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 }

export function PaneLayer(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const viewMode = useStore((s) => s.viewMode)
  const canvas = useStore((s) => s.canvas)
  const setSplitRatio = useStore((s) => s.setSplitRatio)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // 只对激活 tab 计算分屏布局（其余 tab 的 leaf 一律隐藏）
  const { leaves, dividers } = useMemo(() => {
    const leaves: LeafRect[] = []
    const dividers: DividerRect[] = []
    if (activeTab) computeLayout(activeTab.root, { x: 0, y: 0, w: 1, h: 1 }, leaves, dividers)
    return { leaves, dividers }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.root])

  const rectByLeaf = useMemo(() => {
    const m = new Map<string, Rect>()
    leaves.forEach((lr) => m.set(lr.leaf.id, lr.rect))
    return m
  }, [leaves])

  // canvas 模式：每个被 Frame 节点引用的 leaf → 屏幕像素 placement（世界坐标 × 视口）
  const canvasByLeaf = useMemo(() => {
    const m = new Map<string, CanvasPlacement>()
    if (viewMode !== 'canvas') return m
    const vp = canvas.viewport
    canvas.frames.forEach((f) => {
      if (f.collapsed) return
      f.nodes.forEach((n) => {
        if (!n.leafId) return
        m.set(n.leafId, {
          left: vp.x + (f.x + n.x) * vp.scale,
          top: vp.y + (f.y + n.y) * vp.scale,
          w: n.w,
          h: n.h,
          scale: vp.scale,
          frameId: f.id,
          nodeId: n.id,
          nodeX: n.x,
          nodeY: n.y,
          name: n.name
        })
      })
    })
    return m
  }, [viewMode, canvas])

  // 所有 tab 的所有 leaf，按 leafId 稳定排序 → React 子元素顺序稳定，绝不重挂载
  const allLeaves = useMemo(() => {
    const arr = tabs.flatMap((t) =>
      collectLeaves(t.root).map((leaf) => ({
        leaf,
        tabId: t.id,
        activeLeafId: t.activeLeafId
      }))
    )
    arr.sort((a, b) => a.leaf.id.localeCompare(b.leaf.id))
    return arr
  }, [tabs])

  const splitActive = viewMode === 'split' && !!activeTab

  const startDrag = (divider: DividerRect, e: React.MouseEvent): void => {
    e.preventDefault()
    const container = containerRef.current
    if (!container || !activeTab) return
    const cRect = container.getBoundingClientRect()
    const isRow = divider.dir === 'row'

    const onMove = (ev: MouseEvent): void => {
      const regionStart = isRow
        ? cRect.left + divider.region.x * cRect.width
        : cRect.top + divider.region.y * cRect.height
      const regionSize = isRow
        ? divider.region.w * cRect.width
        : divider.region.h * cRect.height
      if (regionSize <= 0) return
      const pos = (isRow ? ev.clientX : ev.clientY) - regionStart
      const ratio = Math.min(0.9, Math.max(0.1, pos / regionSize))
      setSplitRatio(activeTab.id, divider.splitId, ratio)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove(isRow ? 'dragging-col' : 'dragging-row')
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.classList.add(isRow ? 'dragging-col' : 'dragging-row')
  }

  return (
    <div ref={containerRef} className={`pane-layer${viewMode === 'canvas' ? ' canvas-mode' : ''}`}>
      {allLeaves.map(({ leaf, tabId, activeLeafId }) => {
        if (viewMode === 'canvas') {
          const cp = canvasByLeaf.get(leaf.id)
          return (
            <PaneView
              key={leaf.id}
              tabId={tabId}
              leaf={leaf}
              rect={HIDDEN_RECT}
              canvasRect={cp}
              isActive={false}
              hidden={!cp}
            />
          )
        }
        const rect = rectByLeaf.get(leaf.id)
        const visible = splitActive && tabId === activeTabId && !!rect
        return (
          <PaneView
            key={leaf.id}
            tabId={tabId}
            leaf={leaf}
            rect={rect ?? HIDDEN_RECT}
            isActive={visible && activeLeafId === leaf.id}
            hidden={!visible}
          />
        )
      })}
      {splitActive &&
        dividers.map((d) => (
          <div
            key={d.splitId}
            className={`divider ${d.dir === 'row' ? 'divider-v' : 'divider-h'}`}
            style={
              d.dir === 'row'
                ? {
                    left: `calc(${d.pos.x * 100}% - 3px)`,
                    top: `${d.pos.y * 100}%`,
                    height: `${d.pos.h * 100}%`
                  }
                : {
                    top: `calc(${d.pos.y * 100}% - 3px)`,
                    left: `${d.pos.x * 100}%`,
                    width: `${d.pos.w * 100}%`
                  }
            }
            onMouseDown={(e) => startDrag(d, e)}
          />
        ))}
    </div>
  )
}
