// 画布右键菜单：统一 CRUD 入口。菜单项由 CanvasStage 按右键目标（节点/Frame/图形/空白）构造。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { fuzzyPick } from './fuzzy'

export interface CanvasMenuItem {
  label: string
  danger?: boolean
  kbd?: string
  /** 右侧灰字补充说明（如「当前」） */
  hint?: string
  /** 右侧的状态 icon。和 hint 二选一——两个都给时 icon 优先。 */
  icon?: JSX.Element
  /** 分隔线：忽略其余字段 */
  sep?: boolean
  disabled?: boolean
  /** 二级菜单。**给了它就忽略 onClick** —— 一个既能点又能展开的条目，
   *  点下去到底是执行还是展开，用户没法从外观判断。 */
  sub?: CanvasMenuItem[]
  /** 搜索时**不参与筛选，永远显示**。给「添加项目文件夹…」这类
   *  「不是候选项、是出口」的条目用 —— 搜不到东西时它反而最该在 */
  keep?: boolean
  onClick: () => void
}

/** 菜单顶部那一条。**只在需要时给** —— 大多数右键菜单不该有搜索框。 */
export interface MenuHeader {
  placeholder: string
  /** 右边那排图标按钮（如排序方式）。当前档位用 `active` 标出来 */
  actions?: { icon: JSX.Element; tip: string; active?: boolean; onClick: () => void }[]
}

/**
 * 把浮层夹回可视区：靠窗口右/下缘弹出时不被裁掉。
 * 实测尺寸而非估算——菜单项数不定，估出来的高度对不上。
 *
 * **尺寸要持续跟，不能只量一次。** 浮层的内容常常是异步来的：文件选择器要等 IPC
 * 读完目录才知道自己多高，只在挂载时量一次的话，量到的是「空列表」那一瞬的小尺寸，
 * 等文件填进来面板长高，位置却还停在按小尺寸算的地方，底部就捅出窗口了
 * （Frame 内双击出的插入文件选择器实测如此）。所以挂一个 ResizeObserver，
 * 尺寸一变就重新夹一次。改的是 left/top，不影响自身尺寸，不会自激。
 */
export function useMenuAnchor(
  x: number,
  y: number,
  ref: React.RefObject<HTMLElement>,
  deps: unknown[] = []
): { x: number; y: number } | null {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const place = (): void => {
      const w = el?.offsetWidth ?? 190
      const h = el?.offsetHeight ?? 200
      setPos({
        x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
        y: Math.max(8, Math.min(y, window.innerHeight - h - 8))
      })
    }
    place()
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, ...deps])
  return pos
}

/** 点浮层外 / 窗口失焦 / Esc → 关闭 */
export function useDismiss(onClose: () => void): void {
  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])
}

/** 一行菜单项。一级和二级共用 —— 两份实现迟早分叉，而分叉的那半没人测。 */
function Row({
  it,
  onPick,
  onHover
}: {
  it: CanvasMenuItem
  onPick: () => void
  onHover: (e: React.MouseEvent<HTMLElement>) => void
}): JSX.Element {
  return (
    <button
      className={`cctx-item${it.danger ? ' danger' : ''}${it.sub ? ' has-sub' : ''}`}
      disabled={it.disabled}
      type="button"
      onMouseEnter={onHover}
      // **有子菜单的条目点了不执行也不关闭**：它没有「执行」语义，
      // 点一下就把菜单关掉的话，用户会以为自己误触了什么
      onClick={it.sub ? undefined : onPick}
    >
      <span className="cctx-label">{it.label}</span>
      {it.kbd && <span className="cctx-kbd">{it.kbd}</span>}
      {it.icon ?? (it.hint ? <span className="cctx-hint">{it.hint}</span> : null)}
      {it.sub && <span className="cctx-arrow">›</span>}
    </button>
  )
}

export function CanvasContextMenu({
  x,
  y,
  items,
  header,
  onClose
}: {
  x: number
  y: number
  items: CanvasMenuItem[]
  header?: MenuHeader
  onClose: () => void
}): JSX.Element {
  useDismiss(onClose)
  const ref = useRef<HTMLDivElement>(null)
  /** 展开着的二级菜单：哪一条 + 画在哪。**同一时刻只有一个** ——
   *  鼠标移到别的条目上就换，移到没有子菜单的条目上就收。
   *
   *  **必须记坐标、单独 portal 出去**：父菜单有 `overflow-y: auto`
   *  （状态列多了要能滚），子菜单当子元素会被那个滚动容器直接裁掉。 */
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // **`autoFocus` 在这儿不管用**：菜单是 portal 出去的，而打开它的那一下
  // （双击画布）之后，画布自己会把焦点抢回去 —— 实测打开菜单直接打字
  // 一个字都进不去，得先点一下输入框。排到下一帧再抢回来。
  useEffect(() => {
    if (!header) return
    const r = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(r)
  }, [header])
  // 搜出来的结果 + 永远保留的出口项。**分隔线在筛选后原样保留会留下
  // 一堆孤零零的横线**，所以搜索时把它们去掉
  const shown = q.trim()
    ? [
        ...fuzzyPick(
          items.filter((i) => !i.sep && !i.keep),
          q,
          (i) => i.label
        ),
        ...items.filter((i) => i.keep)
      ]
    : items
  // 搜出来的条数会变，菜单高度跟着变 —— 夹回可视区的计算要跟着 q 重跑
  const pos = useMenuAnchor(x, y, ref, [items.length, q])
  const [sub, setSub] = useState<{ items: CanvasMenuItem[]; x: number; y: number } | null>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const subPos = useMenuAnchor(sub?.x ?? 0, sub?.y ?? 0, subRef, [sub?.items.length, sub?.x, sub?.y])

  const open = (it: CanvasMenuItem) => (e: React.MouseEvent<HTMLElement>) => {
    if (!it.sub) return setSub(null)
    const r = e.currentTarget.getBoundingClientRect()
    // 贴着父项右边缘弹出；越界由 useMenuAnchor 夹回来
    setSub({ items: it.sub, x: r.right - 4, y: r.top - 5 })
  }

  return createPortal(
    <>
      <div
        ref={ref}
        className="canvas-ctxmenu"
        style={{ left: pos?.x ?? x, top: pos?.y ?? y, visibility: pos ? 'visible' : 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {header && (
          <div className="cctx-head">
            <input
              ref={inputRef}
              className="cctx-search"
              placeholder={header.placeholder}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              // 回车直接选中第一条 —— 打完字还要伸手去点，那这个框就只帮了一半
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const first = shown.find((i) => !i.sep && !i.disabled && !i.sub)
                if (first) {
                  first.onClick()
                  onClose()
                }
              }}
            />
            {header.actions?.map((a, i) => (
              <button
                key={i}
                className={`cctx-act${a.active ? ' on' : ''}`}
                data-tip={a.tip}
                onClick={a.onClick}
                type="button"
              >
                {a.icon}
              </button>
            ))}
          </div>
        )}
        {shown.length === 0 && <div className="cctx-none">没有匹配的项目</div>}
        {shown.map((it, i) =>
          it.sep ? (
            <div key={i} className="cctx-sep" />
          ) : (
            <Row
              key={i}
              it={it}
              onHover={open(it)}
              onPick={() => {
                it.onClick()
                onClose()
              }}
            />
          )
        )}
      </div>
      {sub && (
        <div
          ref={subRef}
          className="canvas-ctxmenu cctx-sub"
          style={{
            left: subPos?.x ?? sub.x,
            top: subPos?.y ?? sub.y,
            visibility: subPos ? 'visible' : 'hidden'
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {sub.items.map((it, i) =>
            it.sep ? (
              <div key={i} className="cctx-sep" />
            ) : (
              <Row
                key={i}
                it={it}
                onHover={() => {}}
                onPick={() => {
                  it.onClick()
                  onClose()
                }}
              />
            )
          )}
        </div>
      )}
    </>,
    document.body
  )
}
