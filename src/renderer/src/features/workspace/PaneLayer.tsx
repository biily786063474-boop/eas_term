// 全局「活内容层」：所有 tab 的所有 leaf 都渲染在这一个容器里，永不换父。
// 无限画布不断连的地基（实现规划 §5-A）：
//   · split 模式：仅激活 tab 的 leaf 按 computeLayout 显示，其余 display:none（保挂载）。
//   · canvas 模式：被某 Frame 节点引用的 leaf 按「世界坐标 × 视口」像素定位，浮在装饰层之上；
//     未引用 / 折叠 Frame 内的 leaf 隐藏。空白处 pointer-events 穿透给底层画布（见 canvas.css）。
//   · board 模式：卡片里留一个空的 `.board-slot`，这里**实测**它的屏幕坐标把终端浮上去。
//     为什么不让看板自己渲染终端：那样切一次视图就换一次父容器，xterm 重挂载，
//     滚动缓冲和正在跑的会话全丢 —— 三种视图共用一个 PaneView 实例正是为了避免这个。
// 无论怎么切模式，PaneView 的父容器与 key(=leaf.id) 都不变 → React 走 update 而非 remount，
// xterm 实例与滚动缓冲全程保留。

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { computeLayout, collectLeaves, LeafRect, DividerRect, Rect } from '../../layout'
import { PaneView, CanvasPlacement } from './PaneView'
import { liveMaximizedNode } from '../../store/canvas/selectors'

const HIDDEN_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 }

/** 视口裁剪的余量（屏幕像素）。平移一帧最多挪几十像素，600 足够让节点
 *  在露头之前就准备好；给太大又白白多渲染几个。
 *
 *  **这个裁剪省的是内存，不只是绘制。** 同一份画布（30 个终端）实测对照：
 *    不裁：平移 6 秒 rss 536 → 668 MB，一路爬
 *    裁了：全程稳定在 378 MB
 *  终端用的是 CanvasAddon，每个 4 张 canvas；可见的终端在画布平移时每帧
 *  都要重新分配后备存储、重传纹理，内存就这么累积起来。 */
const VIEW_MARGIN = 600

export function PaneLayer(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const viewMode = useStore((s) => s.viewMode)
  const canvas = useStore((s) => s.canvas)
  const setSplitRatio = useStore((s) => s.setSplitRatio)
  // 走 liveMaximizedNode 而不是直接读 —— 它指向的节点可能已经被关掉了，
  // 那时候直接读会让下面的 `maximizedNode && !isMax` 把**所有**节点都隐藏掉
  const maximizedNode = useStore(liveMaximizedNode)
  const committedScale = useStore((s) => s.canvasCommittedScale)
  // 看板全屏进/出时必须重挂观察器 —— 见下面 measure effect 依赖里的说明。
  // 这个 leafId 本身在这里用不上，要的是「它变了」这个事实。
  const boardFull = useStore((s) => s.boardFullscreen)

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

  // leafId → 所属 tab 标题：画布节点没被手动命名时，节点头显示分屏那边的标签名（两个模式看到同一个名字）
  const titleByLeaf = useMemo(() => {
    const m = new Map<string, string>()
    tabs.forEach((t) => collectLeaves(t.root).forEach((l) => m.set(l.id, t.title)))
    return m
  }, [tabs])

  // canvas 模式：每个被 Frame 节点引用的 leaf → 屏幕像素 placement（世界坐标 × 视口）
  const canvasByLeaf = useMemo(() => {
    const m = new Map<string, CanvasPlacement>()
    if (viewMode !== 'canvas') return m
    const vp = canvas.viewport
    // 有节点最大化时：该节点铺满画布视口（1:1 字号，沉浸式），其余终端一律隐藏
    const vpEl = document.querySelector('.canvas-viewport') as HTMLElement | null
    const cw = vpEl?.clientWidth ?? window.innerWidth
    const ch = vpEl?.clientHeight ?? window.innerHeight
    canvas.frames.forEach((f) => {
      if (f.collapsed && !(maximizedNode && maximizedNode.frameId === f.id)) return
      f.nodes.forEach((n) => {
        if (!n.leafId) return
        const isMax = !!maximizedNode && maximizedNode.frameId === f.id && maximizedNode.nodeId === n.id
        if (maximizedNode && !isMax) return // 其它节点隐藏
        if (isMax) {
          m.set(n.leafId, {
            left: 0,
            top: 0,
            // PaneView 用 w*scale 算像素宽高：最大化走 1:1，所以直接给视口尺寸
            w: cw,
            h: ch,
            scale: 1,
            maximized: true,
            frameId: f.id,
            nodeId: n.id,
            nodeX: n.x,
            nodeY: n.y,
            name: n.name ?? titleByLeaf.get(n.leafId)
          })
          return
        }
        // **视口裁剪**：画布世界可以很大（实测 4700x7100），而视口里通常只有几个节点。
        // 不裁的话 30 个终端全在渲染 —— 实测 120 个 xterm canvas、renderer 413MB、
        // GPU 130MB，而当时视口里一个节点都没有。
        // 留一圈余量：平移时节点要提前备好，等露头才开始渲染会看到白块。
        const left = vp.x + (f.x + n.x) * vp.scale
        const top = vp.y + (f.y + n.y) * vp.scale
        const w = n.w * vp.scale
        const h = n.h * vp.scale
        if (left + w < -VIEW_MARGIN || left > cw + VIEW_MARGIN) return
        if (top + h < -VIEW_MARGIN || top > ch + VIEW_MARGIN) return
        m.set(n.leafId, {
          left,
          top,
          w: n.w,
          h: n.h,
          scale: vp.scale,
          frameId: f.id,
          nodeId: n.id,
          nodeX: n.x,
          nodeY: n.y,
          name: n.name ?? titleByLeaf.get(n.leafId)
        })
      })
    })
    return m
  }, [viewMode, canvas, titleByLeaf, maximizedNode, committedScale])

  // board 模式：量每张卡片里那个空槽位，把终端浮到它上面。
  //
  // 只能实测，不能算：看板是普通 CSS 布局（列宽随窗口、卡片高随内容、列内还能滚），
  // 想算出坐标就得把这些规则在 TS 里再写一遍，改个 padding 两边就对不上了。
  const [boardByLeaf, setBoardByLeaf] = useState<Map<string, CanvasPlacement>>(new Map())
  useLayoutEffect(() => {
    if (viewMode !== 'board') {
      setBoardByLeaf((m) => (m.size ? new Map() : m))
      return
    }
    let raf = 0
    const measure = (): void => {
      raf = 0
      const layer = containerRef.current
      if (!layer) return
      const base = layer.getBoundingClientRect()
      const board = document.querySelector('.board')
      const bb = board?.getBoundingClientRect()
      const next = new Map<string, CanvasPlacement>()
      document.querySelectorAll<HTMLElement>('.board-slot').forEach((el) => {
        const leafId = el.dataset.leaf
        if (!leafId) return
        // 折叠成一摞的卡片不给终端：缩过、还盖着别的卡片，浮个终端上去既看不清
        // 又白烧一份渲染。**但最上面那张要留着**（data-fold="top"）——
        // 折叠是收纳，顶上放个不能用的空壳等于白占一块屏幕（见 useBoardScroll）
        const fold = el.closest('.board-card')?.getAttribute('data-fold')
        if (fold && fold !== 'top') return
        const r = el.getBoundingClientRect()
        if (r.width < 8 || r.height < 8) return
        // 槽位被列滚出可视区时别显示：终端是绝对定位在 pane-layer 上的，
        // 不受列的 overflow 裁剪，不挡的话会飘到列头甚至别的列上面
        if (bb && (r.bottom < bb.top + 4 || r.top > bb.bottom - 4)) return
        // **frameId/nodeId 要填真的**。agent 控制条（角色/模型/思考档位）是拿这两个
        // 去 store 里查那个画布节点的配置的 —— 早先这里填空串，于是看板里那条控制条
        // 读不到任何配置、全部回落默认值，跟画布上同一个终端显示的东西对不上，
        // 改了也存不回去。找这个 leaf 在画布上对应的节点即可。
        let fid = ''
        let nid = ''
        for (const f of canvas.frames) {
          const n = f.nodes.find((x) => x.leafId === leafId)
          if (n) {
            fid = f.id
            nid = n.id
            break
          }
        }
        next.set(leafId, {
          left: r.left - base.left,
          top: r.top - base.top,
          w: r.width,
          h: r.height,
          scale: 1,
          board: true,
          frameId: fid,
          nodeId: nid,
          nodeX: 0,
          nodeY: 0
        })
      })
      // 位置没变就别 setState —— 滚动时每帧都测，每帧都换 Map 的话整层跟着重渲染
      setBoardByLeaf((prev) => {
        if (prev.size === next.size) {
          let same = true
          for (const [k, v] of next) {
            const o = prev.get(k)
            if (!o || o.left !== v.left || o.top !== v.top || o.w !== v.w || o.h !== v.h) {
              same = false
              break
            }
          }
          if (same) return prev
        }
        return next
      })
    }
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    measure()
    const ro = new ResizeObserver(schedule)
    const board = document.querySelector('.board')
    if (board) ro.observe(board)
    // 捕获阶段收所有滚动：列各自有滚动条，逐个绑迟早漏掉新加的那一列
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    // 卡片增删、换显示的终端（data-leaf 变了）都要重测
    const mo = new MutationObserver(schedule)
    if (board) mo.observe(board, { childList: true, subtree: true, attributes: true })
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
    // canvas.frames 变了要重测：节点增删会改上面那段 frameId/nodeId 的查找结果。
    //
    // **boardFull 必须在依赖里**，否则看板全屏点开一次之后就再也打不开了：
    // 上面两个观察器绑的是**进入这个 effect 那一刻**的 `.board` 元素，而全屏时
    // BoardStage 走的是 `if (fullOf) return <div className="board-fs">` —— `.board`
    // 整棵被卸载，退出全屏时 React 建的是一个**新**元素。依赖不含全屏状态的话
    // effect 不重跑，观察器就一直盯着那个已经不在文档里的旧节点，schedule 再也不触发，
    // measure 不跑 → boardByLeaf 空 → `hidden={!bp}` 把终端整个藏起来。
    // 症状是「看板里点开终端一片空白，连控制条和输入框都没有」，而且是**间歇性**的：
    // 切到看板后第一次通常正常（卸载那一下恰好还能触发一次），之后全废，
    // 直到切走再切回看板（viewMode 变化让 effect 重跑）才恢复 ——
    // 所以现象是「只有几个打不开」，很容易误以为是某几个终端自己的问题。
    // 实测：加之前点 12 次空 11 次。
  }, [viewMode, canvas.frames, boardFull])

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
    <div
      ref={containerRef}
      className={`pane-layer${viewMode === 'canvas' ? ' canvas-mode' : ''}${viewMode === 'board' ? ' board-mode' : ''}`}
    >
      {allLeaves.map(({ leaf, tabId, activeLeafId }) => {
        if (viewMode === 'board') {
          const bp = boardByLeaf.get(leaf.id)
          return (
            <PaneView
              key={leaf.id}
              tabId={tabId}
              leaf={leaf}
              rect={HIDDEN_RECT}
              canvasRect={bp}
              isActive={false}
              hidden={!bp}
            />
          )
        }
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
