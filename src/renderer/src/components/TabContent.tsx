import { useMemo, useRef } from 'react'
import { useStore, TermTab } from '../store'
import { computeLayout, LeafRect, DividerRect } from '../layout'
import { PaneView } from './PaneView'

interface Props {
  tab: TermTab
  visible: boolean
}

export function TabContent({ tab, visible }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const setSplitRatio = useStore((s) => s.setSplitRatio)

  const { leaves, dividers } = useMemo(() => {
    const leaves: LeafRect[] = []
    const dividers: DividerRect[] = []
    computeLayout(tab.root, { x: 0, y: 0, w: 1, h: 1 }, leaves, dividers)
    // 按 leafId 排序，保证 React 子元素顺序稳定，分屏时不重挂载
    leaves.sort((a, b) => a.leaf.id.localeCompare(b.leaf.id))
    return { leaves, dividers }
  }, [tab.root])

  const startDrag = (divider: DividerRect, e: React.MouseEvent): void => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
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
      setSplitRatio(tab.id, divider.splitId, ratio)
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
    <div
      ref={containerRef}
      className="tab-content"
      style={{ display: visible ? 'block' : 'none' }}
    >
      {leaves.map(({ leaf, rect }) => (
        <PaneView
          key={leaf.id}
          tabId={tab.id}
          leaf={leaf}
          rect={rect}
          isActive={visible && tab.activeLeafId === leaf.id}
        />
      ))}
      {dividers.map((d) => (
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
