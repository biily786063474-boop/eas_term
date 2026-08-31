// 画布装饰层：viewport（点阵背景 + 平移缩放捕获）→ world（transform 变换）→ Frame 卡片。
// 这一层只画「死内容」（Frame 边框/标题/点阵/缩放条），可随意位图缩放。
// 活终端由 PaneLayer 渲染、浮在此层之上按同一视口变换对齐（实现规划 §5-A 双层渲染）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { teamModeOf } from './teamMode'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import type { CanvasFrame, CanvasShape } from '../../store'
import type { ProjectMenuSort } from '../../store/uiSlice'
import { attachBlurGuard } from '../../blurGuard'
import {
  PlusIcon,
  MinusIcon,
  TerminalIcon,
  CopyIcon,
  GlobeIcon,
  ClockIcon,
  TidyIcon,
  CameraIcon,
  SparkleIcon, ChipIcon } from '../../ui/Icons'
import { CanvasFileNode } from './CanvasFileNode'
import { CanvasFreeFileNode } from './CanvasFreeFileNode'
import { CanvasMiniMap } from './CanvasMiniMap'
import { CanvasComponentNode } from './CanvasComponentNode'
import { stageMenuItems } from './stageMenu'
import { CanvasContextMenu, type CanvasMenuItem, type MenuHeader } from './CanvasContextMenu'
import { CanvasFilePicker } from './CanvasFilePicker'
import { paneForFile, isHtmlPath } from './media'
import { HtmlOpenChoice } from './HtmlOpenChoice'
import type { PaneState } from '../../layout'
import { FrameStatusPicker } from './FrameStatusPicker'
import { statusLabel, statusColor, statusOfFrame } from './frameStatus'
import { useProjectRows, focusTerminal } from '../status/useStatus.ts'
import { StatusIcon } from '../status/StatusIcon'
import { RunMonitor } from '../status/RunMonitor'

/** 把列的颜色变成 CSS 认的 `"r, g, b"`（用法是 rgba(var(--dot-rgb), α)，
 *  所以要的是三个数，不是 #rrggbb）。没颜色就不设，回落主题色。
 *
 *  ── 2026-08-31：只染色点，不再染整个 Frame ──────────────────────
 *  原来这个值注在 `.cframe` 上，于是**整个框**（边框、标题栏渐变、
 *  状态高亮）都跟着看板分类的颜色走。用户要的是反过来：
 *  **框一律主题色，分类色只出现在标题栏那颗圆点上。**
 *
 *  理由是对的：画布上十几个 Frame 各染各的色，整体就散了 ——
 *  而「这个项目属于哪一类」是一条**次要信息**，一颗 9px 的点足够承载，
 *  不需要把整个容器都染上。 */
function dotTint(hex?: string): Record<string, string> {
  if (!hex) return {}
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim())
  if (!m) return {}
  return { '--dot-rgb': `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` }
}
import { collectLeaves } from '../../layout'
import './canvas.css'
import { liveMaximizedNode } from '../../store/canvas/selectors'
import { dropModuleOnTerminal } from './dropOnTerminal'
import { runCanvasSnapshot, setClearDialogOpen } from './snapshotRun'

const SCALE_MIN = 0.2
const SCALE_MAX = 2.2
const HEAD_H = 34
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

/**
 * 有全屏覆盖层盖着时，画布的全局键盘监听一律让路。
 *
 * 画布有四条 window 级 keydown（Esc 还原最大化、Delete/⌘D、撤销、空格平移手势）。
 * 设计模块打开后是 portal 到 body 的 fixed 全屏层，画布在它下面看不见也够不着，
 * 但这四条照样在收键 —— 于是在设计模块里按 Delete 删掉的是画布上的节点，
 * 按空格切成了画布平移，按 Esc 两边一起响应。
 *
 * 判据不用 DOM 祖先：覆盖层 portal 出去了，closest() 够不着；判它自己的根 class
 * 又得逐个视图去认（.ua / .uc__… 各不相同，还是移植来的 jsx，同步上游会变）。
 * 状态与 DOM 结构无关，下一个全屏模块也能直接复用。
 *
 * 鼠标那几条不用管：contextmenu 和 mousedown 本来就有 `.canvas-viewport` /
 * `.pane-layer` 的范围守卫，wheel 直接挂在 viewport 元素上，都进不到覆盖层里。
 */
function overlayHasKeyboard(): boolean {
  return useStore.getState().fullscreenOverlay !== null
}

/** 这个 Frame 里有几个「手机碰过、你还没看过」的节点。
 *  纯函数放组件外 —— 它不依赖任何 hook，放里面每次渲染都要重建一次。 */
function phoneMarks(f: { nodes: { phoneAt?: number }[] }): number {
  return f.nodes.reduce((n, x) => n + (x.phoneAt ? 1 : 0), 0)
}

export function CanvasStage(): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frames = useStore((s) => s.canvas.frames)
  const vp = useStore((s) => s.canvas.viewport)
  const setViewport = useStore((s) => s.setViewport)
  const moveFrame = useStore((s) => s.moveFrame)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const projects = useStore((s) => s.projects)
  const addTerminalNode = useStore((s) => s.addTerminalNode)
  const addAgentNode = useStore((s) => s.addAgentNode)
  const addBrowserNode = useStore((s) => s.addBrowserNode)
  const tidyFrame = useStore((s) => s.tidyFrame)
  const clearPhoneNode = useStore((s) => s.clearPhoneNode)
  // 注意：这里不再读 canvas.shapes——成品标记的渲染搬去了 CanvasShapeLayer（它自己订阅）。
  // 留着这个订阅会让 CanvasStage 在每次拖动/编辑标记时跟着空转重渲染一次。
  const addShape = useStore((s) => s.addShape)
  // 待办清单同理：成品渲染在 CanvasShapeLayer，这里只需要「新建」这一个写操作
  const addTodoBoard = useStore((s) => s.addTodoBoard)
  const updateShape = useStore((s) => s.updateShape)
  // 有模块在「最大化沉浸」时，右下角那两条要让位（见下面 .on-max 的注释）。
  // 用 liveMaximizedNode 而不是直接读 store：它指的节点可能已经被关掉了。
  const maximized = !!useStore(liveMaximizedNode)
  const freeNodes = useStore((s) => s.canvas.freeNodes)
  // tool / editingSticky 提到 store 了（修复轮 1 的 Important 1/2）：CanvasShapeLayer
  // 要读同一份 tool 才知道选着绘图工具时该不该把 mousedown 让给画布视口穿透过去；
  // editingSticky 要是两份各起一份，CanvasStage 这边 onViewportDown 的守卫
  // （下面 588 行附近）永远读不到 CanvasShapeLayer 那边真实的编辑态，形同虚设。
  // 变量名保持不变，下面几十处用法不用跟着改。
  const tool = useStore((s) => s.canvasTool)
  const setTool = useStore((s) => s.setCanvasTool)
  const [draft, setDraft] = useState<Omit<CanvasShape, 'id'> | null>(null)
  const editingSticky = useStore((s) => s.editingSticky)
  const setEditingSticky = useStore((s) => s.setEditingSticky)
  const [editingFrame, setEditingFrame] = useState<string | null>(null)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    items: CanvasMenuItem[]
    header?: MenuHeader
  } | null>(null)
  // 点标题栏色点 → 状态色板（只记 frameId，当前状态每次渲染从 frames 现取，免得色板开着时被改脏）
  const [statusPop, setStatusPop] = useState<{ x: number; y: number; frameId: string } | null>(null)
  // Frame 内双击 → 「插入文件」选择器（wx/wy 是双击处的世界坐标，插进来的节点就落在那儿）
  const [picker, setPicker] = useState<{
    x: number
    y: number
    frameId: string
    root: string
    rootName: string
    wx: number
    wy: number
  } | null>(null)
  /** 挑到 .html 时的「渲染还是源码」选择。place 把落点包起来，等选完再建节点 */
  const [htmlPick, setHtmlPick] = useState<{
    x: number
    y: number
    path: string
    place: (pane: PaneState) => void
  } | null>(null)
  // 快照失败提示（点一下消失，同 Sidebar 的 ws-inline-error 那种）
  const [snapErr, setSnapErr] = useState<string | null>(null)
  // 拍完之后待确认「要不要清掉标记」——数字是拍照那一刻画布上的标记数，弹窗由 Task 5 接手渲染
  const [pendingClear, setPendingClear] = useState<number | null>(null)
  // 「记住这次选择」勾选框——每次弹窗重新出现都要从未勾选开始，不能继承上一次
  const [remember, setRemember] = useState(false)
  // 防连点：主进程虽已有并发互斥，但重复点击仍会排出多张几乎相同的图、
  // 也可能让后一次调用把前一次还没走完的 .snapshotting 提前摘掉——按钮层必须自己挡一道
  const [snapBusy, setSnapBusy] = useState(false)
  const addProject = useStore((s) => s.addProject)
  const addProjectFrame = useStore((s) => s.addProjectFrame)
  // 双击空白弹出的项目列表要按状态排序、显示状态 icon——rows 在这里取好，
  // 供下面 onViewportDblClick（普通函数不是 hook）闭包捕获。
  const rows = useProjectRows()
  const addFileNode = useStore((s) => s.addFileNode)
  const renameFrame = useStore((s) => s.renameFrame)
  const toggleTeamMode = useStore((s) => s.toggleTeamMode)
  // 选中集合提到 store（含浮层终端节点）：这里派生成 Set 供读取，写用 store action
  const canvasSel = useStore((s) => s.canvasSel)
  const setCanvasSel = useStore((s) => s.setCanvasSel)
  const toggleCanvasSel = useStore((s) => s.toggleCanvasSel)
  const clearCanvasSel = useStore((s) => s.clearCanvasSel)
  const sel = useMemo(() => new Set(canvasSel), [canvasSel])
  const clearAttention = useStore((s) => s.clearAttention)
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const spaceHeld = useRef(false)
  // 单选一个终端节点 → 视为已知晓，清除该终端的「需处理」呼吸标记。
  //
  // **只在单选、且选中对象就是节点本身时才清——不再随框选/多选/整帧选中级联。**
  // 原来 canvasSel 里每个 key 都会触发清除，'f:' 开头（选中整个 Frame）还会连带清掉
  // Frame 下所有终端。这和 focusTerminal「只清被点的那一个」是同一类不对称：框选
  // 一片节点多半是要挪一挪/对齐/编组，不代表每个都被看过了；Frame 折叠时里面的
  // 终端节点根本没渲染，选中一个折叠的 Frame（比如拖它挪位置）就把看不见的终端也
  // 一并清掉，更站不住脚。只有单选且选的是节点本身，才是无歧义的「我在看这一个」——
  // 单击一个节点、或 MCP canvas_maximize_node（也是把 canvasSel 置成唯一一个 'n:' key）
  // 都落在这个形状。这条效果也是 Task 6 doneOpen 泄漏最容易被触发的路径，收紧触发面
  // 顺带把它的暴露面也收窄了。
  useEffect(() => {
    if (canvasSel.length !== 1 || canvasSel[0][0] !== 'n') return
    const st = useStore.getState()
    const [, fid, nid] = canvasSel[0].split(':')
    const n = st.canvas.frames.find((f) => f.id === fid)?.nodes.find((x) => x.id === nid)
    if (!n?.leafId) return
    const leaf = st.tabs.flatMap((t) => collectLeaves(t.root)).find((x) => x.id === n.leafId)
    // 终端认 ptyId，AI 对话节点认它的会话 id —— 两者在通知系统里都是「任务 id」
    //（见 machine.ts 的 locate）。不认 agent 的话，点开一个跑完的对话节点，
    // 呼吸标记会一直亮着，因为它没有终端那条 focusin → clearAttention 的路。
    if (leaf?.pane.kind === 'terminal') clearAttention(leaf.pane.ptyId)
    else if (leaf?.pane.kind === 'agent' && leaf.pane.sessionId) clearAttention(leaf.pane.sessionId)
  }, [canvasSel, clearAttention])

  // 滚轮缩放 / 双指平移（原生监听以便 passive:false 阻止页面滚动）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      // 仅当模块「被选中」时，光标落在其可滚动区（组件/文件预览）才把滚轮交给内容滚动；
      // 未选中则保持画板平移/缩放（避免鼠标经过模块就抢走 pan）。
      const t = e.target as HTMLElement | null
      // 便签写长了要能翻。它比模块小得多，要求「先选中」反而别扭——
      // 光标已经落在一个真的溢出了的便签里，意图很明确，直接给它滚
      const sticky = t?.closest?.('.cshape-sticky-body') as HTMLElement | null
      if (sticky && sticky.scrollHeight - sticky.clientHeight > 1) return
      const body = t?.closest?.('.cfile-body')
      if (body) {
        // 图片宫格是显式打开的浏览视图 → 滚轮始终交给它滚（不要求选中）
        const grid = t?.closest?.('.civ-grid-scroll') as HTMLElement | null
        if (grid && grid.scrollHeight - grid.clientHeight > 1) return
        const nodeEl = t?.closest?.('.cfile-node[data-node-id]') as HTMLElement | null
        const nid = nodeEl?.dataset.nodeId
        const fid = nodeEl?.dataset.frameId
        // 有 fid 是 Frame 内节点（n:frameId:nodeId），没有则是自由节点（p:nodeId）
        const isSel =
          !!nid &&
          (fid
            ? useStore.getState().canvasSel.includes('n:' + fid + ':' + nid)
            : useStore.getState().canvasSel.includes('p:' + nid))
        if (isSel) {
          let sc: HTMLElement | null = t
          while (sc && sc !== body.parentElement) {
            const oy = getComputedStyle(sc).overflowY
            if (sc.scrollHeight - sc.clientHeight > 1 && (oy === 'auto' || oy === 'scroll')) return
            sc = sc.parentElement
          }
        }
      }
      e.preventDefault()
      const cur = useStore.getState().canvas.viewport
      if (e.ctrlKey) {
        // 触控板捏合（pinch，macOS 合成为 ctrl+wheel）/ ⌃+滚轮 → 以光标为锚缩放
        const r = el.getBoundingClientRect()
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        // deltaMode：0=像素（Chromium 常态）、1=行、2=页。不折算的话行/页模式下步长会小得动不了
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1)
        // **鼠标滚轮和触控板必须分开处理。**
        //
        // 原来是 `scale * (1 - dy * 0.01)`，那是照着 macOS 触控板写的 —— 捏合时 dy 是 ±1~10 的
        // 连续小值，乘出来 0.9~1.1，很顺。但 Windows 的鼠标滚轮**一格就是 100 或 120**：
        //   dy=100 → 1 - 1.0 = 0     → scale 归零，被 clamp 拉到 SCALE_MIN(20%)
        //   dy=120 → 1 - 1.2 = -0.2  → 负数，同样掉到 20%
        // 表现就是「往后拉一下，一步到底 20%」。放大方向同理，一格直接翻倍。
        //
        // 判据用「单次跨度是否 ≥40」：触控板再快也是连续小步，滚轮最小的一格也有 100。
        const byWheel = Math.abs(dy) >= 40
        const factor = byWheel
          ? dy > 0
            ? 1 / 1.12
            : 1.12 // 滚轮：每格固定 ±12%，与 dy 具体是 100 还是 120 无关
          : Math.exp(-dy * 0.01) // 触控板：小量下等价于原来的 (1 - dy*0.01)，手感不变，但永远为正
        const s2 = clamp(cur.scale * factor, SCALE_MIN, SCALE_MAX)
        setViewport({
          scale: s2,
          x: px - (px - cur.x) * (s2 / cur.scale),
          y: py - (py - cur.y) * (s2 / cur.scale)
        })
      } else {
        // 双指滑动（上下左右）/ 鼠标滚轮 → 平移
        setViewport({ x: cur.x - e.deltaX, y: cur.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setViewport])

  // 右键菜单：按目标（终端 / 文件·组件节点 / Frame / 图形 / 空白）构造统一 CRUD 菜单。
  // 菜单项的构造搬去了 stageMenu.ts —— 那 70 行的数据全部现取自 store，
  // 不依赖组件渲染态，留在这里只是把手势 effect 之间的距离拉远。
  useEffect(() => {
    const onCtx = (e: MouseEvent): void => {
      const items = stageMenuItems(e, {
        setEditingSticky,
        setEditingFrame,
        viewportEl: viewportRef.current
      })
      if (!items) return // 右键落在画布之外，让它走系统菜单
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, items })
    }
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [])

  // Esc：退出「最大化沉浸」，模块回到画布原位
  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (overlayHasKeyboard()) return // 设计模块自己也认 Esc，别两边一起响应
      if (liveMaximizedNode(useStore.getState())) {
        e.preventDefault()
        useStore.getState().setMaximizedNode(null)
      }
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [])

  // 键盘：Delete 删除选中 / ⌘D 复制选中（画布模式；分屏快捷键已按 viewMode 屏蔽）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 全屏覆盖层在的时候一律让路。**这条最要紧**：设计模块里按 Delete 想删的是
      // 它自己的图层，不该把画布上选中的节点删掉 —— 而且画布还是被盖住的，
      // 人根本看不见自己删了什么。
      if (overlayHasKeyboard()) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      // contentEditable 也要放行：便签正文就是这种，不排除的话在里面按删除键会把节点删掉
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable || !sel.size) return
      // **Delete 和 Backspace 都认。**
      //
      // 原来只认 Delete，理由是「Backspace 留给文字编辑」——但 Mac 键盘上那个写着
      // delete 的键发的正是 Backspace，Delete 要按 Fn+delete。于是在 Mac 上
      // 框选一堆模块后按删除键**根本没反应**，而人不会想到去按 Fn。
      // 文字编辑的场景由上面那行守着（输入框 / textarea / contentEditable 一律放行），
      // 够了；xterm 的输入代理也是 textarea，同样不会误伤。
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const st = useStore.getState()
        // 终端节点单独收集：它不能只从画布上抹掉，还得把底下的 shell 一起收了，
        // 否则 pty 变成孤儿——进程还在跑，而画布上已经找不到它了。
        const terms: { fid: string; nid: string; leafId: string }[] = []
        const plain: string[] = []
        for (const k of sel) {
          if (k[0] === 'f') continue // Frame 仍然不由键盘删：里面可能装着一堆东西
          if (k[0] === 'n') {
            const [, fid, nid] = k.split(':')
            const leafId = st.canvas.frames.find((f) => f.id === fid)?.nodes.find((n) => n.id === nid)?.leafId
            if (leafId) {
              terms.push({ fid, nid, leafId })
              continue
            }
          }
          plain.push(k)
        }
        if (!plain.length && !terms.length) return
        e.preventDefault()

        const wipe = (): void => {
          plain.forEach((k) => {
            if (k[0] === 's') st.removeShape(k.slice(2))
            else if (k[0] === 'n') {
              const [, fid, nid] = k.split(':')
              st.removeNode(fid, nid)
            } else if (k[0] === 'p') st.removeFreeNode(k.slice(2))
          })
          for (const t of terms) {
            st.removeNode(t.fid, t.nid)
            const tab = st.tabs.find((tb) => collectLeaves(tb.root).some((l) => l.id === t.leafId))
            if (tab) st.closeLeaf(tab.id, t.leafId)
          }
          clearCanvasSel()
        }

        // 没有终端就直接删——图片、代码预览这些删错了重新拖一个就是。
        if (!terms.length) {
          wipe()
          return
        }
        // 有终端：**只弹一次**汇总确认。逐个确认的话选了五个就要点五次，
        // 人会开始无脑点确认，那道防线也就废了。
        void (async () => {
          const ptyIds = terms
            .map((t) => {
              for (const tb of st.tabs) {
                const leaf = collectLeaves(tb.root).find((l) => l.id === t.leafId)
                if (leaf?.pane.kind === 'terminal') return leaf.pane.ptyId
              }
              return null
            })
            .filter((x): x is string => !!x)
          const busy = ptyIds.length ? await window.api.pty.busyByIds(ptyIds) : []
          const n = plain.length + terms.length
          st.requestConfirm({
            message: busy.length
              ? `要删除选中的 ${n} 项，其中 ${busy.length} 个终端正在运行命令，删除会终止它们。确定吗？`
              : `要删除选中的 ${n} 项，含 ${terms.length} 个终端。确定吗？`,
            confirmLabel: '删除',
            onConfirm: wipe
          })
        })()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const st = useStore.getState()
        sel.forEach((k) => {
          if (k[0] === 'n') {
            const [, fid, nid] = k.split(':')
            st.duplicateNode(fid, nid)
          } else if (k[0] === 's') {
            const sh = st.canvas.shapes.find((s2) => s2.id === k.slice(2))
            if (sh)
              st.addShape({
                type: sh.type,
                x: sh.x + 22,
                y: sh.y + 22,
                w: sh.w,
                h: sh.h,
                text: sh.text,
                color: sh.color
              })
          } else if (k[0] === 'p') st.duplicateFreeNode(k.slice(2))
        })
      } else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // F：把画面聚焦到选中内容（fit + 居中）
        e.preventDefault()
        const cv = useStore.getState().canvas
        const boxes: { x: number; y: number; w: number; h: number }[] = []
        sel.forEach((k) => {
          if (k[0] === 's') {
            const sh = cv.shapes.find((s2) => s2.id === k.slice(2))
            if (sh)
              boxes.push({
                x: Math.min(sh.x, sh.x + sh.w),
                y: Math.min(sh.y, sh.y + sh.h),
                w: Math.abs(sh.w),
                h: Math.abs(sh.h)
              })
          } else if (k[0] === 'f') {
            const fr = cv.frames.find((x) => x.id === k.slice(2))
            if (fr) boxes.push({ x: fr.x, y: fr.y, w: fr.w, h: fr.collapsed ? HEAD_H : fr.h })
          } else if (k[0] === 'n') {
            const [, fid, nid] = k.split(':')
            const fr = cv.frames.find((x) => x.id === fid)
            const n = fr?.nodes.find((x) => x.id === nid)
            if (fr && n) boxes.push({ x: fr.x + n.x, y: fr.y + n.y, w: n.w, h: n.h })
          } else if (k[0] === 'p') {
            const n = cv.freeNodes.find((x) => x.id === k.slice(2))
            if (n) boxes.push({ x: n.x, y: n.y, w: n.w, h: n.h })
          }
        })
        const el = viewportRef.current
        if (!boxes.length || !el) return
        const x1 = Math.min(...boxes.map((b) => b.x))
        const y1 = Math.min(...boxes.map((b) => b.y))
        const x2 = Math.max(...boxes.map((b) => b.x + b.w))
        const y2 = Math.max(...boxes.map((b) => b.y + b.h))
        const pad = 80
        const sc = clamp(
          Math.min(el.clientWidth / (x2 - x1 + pad * 2), el.clientHeight / (y2 - y1 + pad * 2)),
          SCALE_MIN,
          SCALE_MAX
        )
        setViewport({
          scale: sc,
          x: el.clientWidth / 2 - ((x1 + x2) / 2) * sc,
          y: el.clientHeight / 2 - ((y1 + y2) / 2) * sc
        })
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [sel])

  // ── 撤销 / 重做：Cmd+Z / Cmd+Shift+Z ──────────────────────────────────
  //
  // **挂在冒泡阶段（不是 capture），这是刻意的。** 设计模块自己有一套 undo，
  // 它用 capture + stopPropagation 拦 Cmd+Z（DesignerView.jsx / AnimateView.jsx）——
  // 事件在 window 的 capture 阶段就被它截停，根本冒泡不回来，画布这层天然抢不到。
  // 下面那条 .design-node 守卫是第二道：万一哪天设计模块改了监听写法，
  // 也不至于变成「在设计模块里按撤销，画布上的节点被撤没了」。
  //
  // 输入框 / textarea / contentEditable 一律放行 —— xterm 的输入代理也是 textarea，
  // 所以在终端里按 Cmd+Z 走的还是终端自己那套，不会被画布截走。
  useEffect(() => {
    const onUndoKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      // 设计模块有自己的 undo。它 portal 到了 body，closest('.design-node') 够不着，
      // 得靠状态判断（uiSlice.fullscreenOverlay）。
      if (overlayHasKeyboard()) return
      e.preventDefault()
      const st = useStore.getState()
      // 栈空时什么都不发生 —— 这是撤销的通行行为，不值得为它引一套提示 UI
      if (e.shiftKey) st.redoCanvas()
      else st.undoCanvas()
    }
    window.addEventListener('keydown', onUndoKey)
    return () => window.removeEventListener('keydown', onUndoKey)
  }, [])

  // 空格键临时切换为平移手势（空白拖拽默认是框选）+ 抓手光标（.space-pan）
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (overlayHasKeyboard()) return
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        spaceHeld.current = true
        viewportRef.current?.classList.add('space-pan')
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceHeld.current = false
        viewportRef.current?.classList.remove('space-pan')
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const beginPan = useCallback(
    (clientX: number, clientY: number): void => {
      const cur = useStore.getState().canvas.viewport
      const el = viewportRef.current
      el?.classList.add('panning')
      let detachBlur = (): void => {}
      const onMove = (ev: MouseEvent): void =>
        setViewport({ x: cur.x + (ev.clientX - clientX), y: cur.y + (ev.clientY - clientY) })
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        detachBlur()
        el?.classList.remove('panning')
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      // 拖拽中真的失焦（灵动岛跳转、⌘Tab……）→ 当场收尾，别留悬空的拖拽状态；
      // blur 后很快又 focus 回来的抖动（见 attachBlurGuard 注释，灵动岛跳转失败重试
      // 时的 hide()/show() 会触发这种抖动）不算真失焦，拖拽照常继续。
      // 不加这个的话 mouseup 永远等不到，onMove 会一直挂在 document 上——
      // 同一个毛病 Gantt 那边（GanttStage/GanttNavigator）已经踩过一次并修了，见那两处注释。
      detachBlur = attachBlurGuard(onUp)
    },
    [setViewport]
  )

  const startPan = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    beginPan(e.clientX, e.clientY)
  }

  // 鼠标中键拖动 → 平移画布。走 document 捕获阶段：在终端、模块上按下也照样能拖，
  // 不然一屏被终端占满时中键就没地方按（等价于空格+左键拖，但不用腾出一只手）。
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (e.button !== 1) return
      const t = e.target as HTMLElement
      if (!t.closest?.('.canvas-viewport') && !t.closest?.('.pane-layer')) return
      e.preventDefault()
      e.stopPropagation()
      beginPan(e.clientX, e.clientY)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [beginPan])

  const screenToWorld = (clientX: number, clientY: number): { wx: number; wy: number } => {
    const r = viewportRef.current!.getBoundingClientRect()
    const cur = useStore.getState().canvas.viewport
    return { wx: (clientX - r.left - cur.x) / cur.scale, wy: (clientY - r.top - cur.y) / cur.scale }
  }

  const selectElement = (key: string, additive: boolean): void => {
    toggleCanvasSel(key, additive)
  }

  const centerOnFrame = (f: CanvasFrame): void => {
    const el = viewportRef.current
    if (!el) return
    const sc = useStore.getState().canvas.viewport.scale
    setViewport({
      x: el.clientWidth / 2 - (f.x + f.w / 2) * sc,
      y: el.clientHeight / 2 - (f.y + (f.collapsed ? HEAD_H : f.h) / 2) * sc
    })
  }

  // 选文件夹加项目 → 直接把它的 Frame 落在双击的位置（否则用户还得再拖一次）
  const addProjectAt = async (wx: number, wy: number): Promise<void> => {
    const before = new Set(useStore.getState().projects.map((p) => p.id))
    await addProject()
    const added = useStore.getState().projects.find((p) => !before.has(p.id))
    if (added) await addProjectFrame(added.id, wx - 60, wy - 17)
  }

  // 双击空白：一级菜单选项目 → Frame 落在双击处
  // 双击 Frame 内空白：改为「插入项目文件」选择器 → 文件节点落在双击处
  const onViewportDblClick = (e: React.MouseEvent): void => {
    const t = e.target as HTMLElement
    // 这些各自有双击行为（模块头改名 / 终端选词 / 便签编辑 / Frame 标题改名），浮层控件也不是画布
    if (
      t.closest(
        '.cfile-node, .pane, .cshape, .cframe-head, .ctoolbar-mini, .canvas-zoombar, .canvas-minimap, .crm, .crm-mini, .canvas-drawer, .cd-edge, .wiki-drawer, .wk-edge'
      )
    )
      return
    const st = useStore.getState()
    const { wx, wy } = screenToWorld(e.clientX, e.clientY)
    const fid = (t.closest('.cframe') as HTMLElement | null)?.dataset.fid
    if (fid) {
      const frame = st.canvas.frames.find((f) => f.id === fid)
      if (!frame) return
      // 子 Frame 认自己的文件夹，项目 Frame 认项目根
      const root = frame.folderPath ?? st.projects.find((p) => p.id === frame.projectId)?.path
      if (!root) {
        setMenu({
          x: e.clientX,
          y: e.clientY,
          items: [{ label: '这个 Frame 没有绑定文件夹', disabled: true, onClick: () => {} }]
        })
        return
      }
      setPicker({ x: e.clientX, y: e.clientY, frameId: fid, root, rootName: frame.name, wx, wy })
      return
    }
    // 排序两档，用户在菜单顶部自己切（projectMenuSort，存 localStorage）：
    //   default —— st.projects 的原顺序（添加顺序）
    //   recent  —— 最近点过的排前面（projectMru）
    //
    // **两档都先按状态分层，这一层不受排序方式影响。** approval 是唯一
    // 「不管就永远卡着」的状态，useStatus.ts 引的规格 §1.1 写着它在任何排序里都排最前 ——
    // 不能因为半天没碰这个项目，就把一个卡在权限确认框上的终端沉到底下。
    // 「最近使用」优先的是**顺序**，不是**紧急度**。
    // rank 用的是同一份 useProjectRows 结果，不在这里另算一遍。
    const rank = new Map(rows.map((r, i) => [r.projectId, i]))
    const mru = new Map(st.projectMru.map((id, i) => [id, i]))
    const mx = e.clientX
    const my = e.clientY
    const buildItems = (mode: ProjectMenuSort): CanvasMenuItem[] => {
      const ordered = [...st.projects].sort((a, b) => {
        const ra = rank.get(a.id) ?? 999
        const rb = rank.get(b.id) ?? 999
        if (ra !== rb) return ra - rb
        if (mode !== 'recent') return 0 // Array.sort 是稳定的，返回 0 即保持原顺序
        // 从没点过的排在点过的后面。**用 MAX_SAFE_INTEGER 而不是 Infinity** ——
        // 两个都没点过时 Infinity - Infinity 得到 NaN，sort 拿到 NaN 行为未定义
        const ma = mru.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const mb = mru.get(b.id) ?? Number.MAX_SAFE_INTEGER
        return ma - mb
      })
      const list: CanvasMenuItem[] = ordered.map((p) => {
        const exist = st.canvas.frames.find((f) => f.projectId === p.id)
        const row = rows.find((r) => r.projectId === p.id)
        return {
          label: p.name,
          // 右侧不再提示"是否在画布上"——那是位置信息不是任务状态（同 CanvasDrawer 那处的理由），
          // 换成状态 icon，没有状态就不显示任何东西。
          icon: row ? <StatusIcon state={row.top} size={13} /> : undefined,
          onClick: () => {
            // 用户主动打开/聚焦了这个项目 —— recent 档就是按这个排的
            st.touchProject(p.id)
            // 两档，先判上面这档，不是叠加：
            // 有终端在等你（attn > 0，含「还在跑但 agent 叫了你一声」）就聚焦到最该看的
            // 那一个（这本身会把视图挪过去），并按规格 §1.2 清掉它的状态。
            // 判据用 attn 不用 `top !== 'running'`，理由见 machine.ts 的 ProjectRow。
            if (row && row.attn > 0) {
              focusTerminal(row.focusPtyId)
              return
            }
            // 已经在画布上就不重复建，改为把视图挪过去；不在就新建
            if (exist) centerOnFrame(exist)
            else void addProjectFrame(p.id, wx - 60, wy - 17)
          }
        }
      })
      if (list.length) list.push({ label: '', sep: true, onClick: () => {} })
      // **keep：搜索时不参与筛选。** 它不是候选项、是出口 ——
      // 恰恰在「搜不到东西」的时候最该在
      list.push({ label: '添加项目文件夹…', keep: true, onClick: () => void addProjectAt(wx, wy) })
      return list
    }
    /** 顶部那一条：搜索框 + 两个排序图标。
     *
     *  排序原来是**一行文字**（「排序：最近使用 · 点击切换」）——
     *  它混在项目行之间，点错的代价是白跳一个项目，而且占掉一整行。
     *  改成右上角两个图标：当前档位亮着，hover 才说明它是什么。 */
    const makeHeader = (mode: ProjectMenuSort): MenuHeader => ({
      placeholder: '搜项目…',
      actions: [
        {
          icon: <TidyIcon size={13} />,
          tip: '按添加顺序排',
          active: mode !== 'recent',
          onClick: () => switchSort('default')
        },
        {
          icon: <ClockIcon size={13} />,
          tip: '按最近使用排',
          active: mode === 'recent',
          onClick: () => switchSort('recent')
        }
      ]
    })
    const switchSort = (next: ProjectMenuSort): void => {
      st.setProjectMenuSort(next)
      // CanvasContextMenu 在 onClick 之后一定会 onClose()，同一批 setState
      // 里重开会被它盖掉 —— 排到下一个宏任务再开，用户才当场看得到新顺序，
      // 而不是得再双击一遍
      setTimeout(() => setMenu({ x: mx, y: my, items: buildItems(next), header: makeHeader(next) }), 0)
    }
    setMenu({
      x: mx,
      y: my,
      items: buildItems(st.projectMenuSort),
      header: makeHeader(st.projectMenuSort)
    })
  }

  const rectsIntersect = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
  ): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  // 空白拖拽：橡皮筋框选（相交即选中 图形 / Frame / 文件·组件节点）
  const startBoxSelect = (e: React.MouseEvent): void => {
    const start = screenToWorld(e.clientX, e.clientY)
    const shift = e.shiftKey
    const base = shift ? new Set(sel) : new Set<string>()
    setCanvasSel([...base])
    let moved = false
    let detachBlur = (): void => {}
    const onMove = (ev: MouseEvent): void => {
      const p = screenToWorld(ev.clientX, ev.clientY)
      const rect = {
        x: Math.min(start.wx, p.wx),
        y: Math.min(start.wy, p.wy),
        w: Math.abs(p.wx - start.wx),
        h: Math.abs(p.wy - start.wy)
      }
      if (rect.w + rect.h > 3) moved = true
      setBand(rect)
      const cv = useStore.getState().canvas
      const next = new Set(base)
      cv.shapes.forEach((sh) => {
        const box = {
          x: Math.min(sh.x, sh.x + sh.w),
          y: Math.min(sh.y, sh.y + sh.h),
          w: Math.abs(sh.w),
          h: Math.abs(sh.h)
        }
        if (rectsIntersect(box, rect)) next.add('s:' + sh.id)
      })
      // 框选只选「模块（节点）」，不波及 Frame；Frame 唯一选中方式是点它的 top bar
      cv.frames.forEach((f) => {
        if (f.collapsed) return
        f.nodes.forEach((n) => {
          // 含终端节点（leafId）在内，全部可被框选
          if (rectsIntersect({ x: f.x + n.x, y: f.y + n.y, w: n.w, h: n.h }, rect))
            next.add('n:' + f.id + ':' + n.id)
        })
      })
      // 自由节点已经是世界坐标，直接比较，不用叠加 Frame 偏移
      cv.freeNodes.forEach((n) => {
        if (rectsIntersect({ x: n.x, y: n.y, w: n.w, h: n.h }, rect)) next.add('p:' + n.id)
      })
      setCanvasSel([...next])
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      detachBlur()
      setBand(null)
      if (!moved && !shift) clearCanvasSel()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // 框选中途真失焦 → 当场收尾（同 beginPan 的注释：不加会留下悬空的 mousemove 监听；
    // hide/show 抖动引起的假 blur 由 attachBlurGuard 过滤掉，不会误伤框选）
    detachBlur = attachBlurGuard(onUp)
  }

  // 空白按下：select 模式框选（空格+拖为平移）；图形工具模式绘制
  const onViewportDown = (e: React.MouseEvent): void => {
    if (e.button !== 0 || editingSticky) return
    // 在缩略图等浮层控件上按下不启动画布框选/平移。.ctoolbar-mini 必须在这——
    // 它是 .canvas-viewport 的直接子节点，工具按钮 disabled 时浏览器不会调用
    // 按钮自身的 mousedown 监听（只拦 activation，不拦冒泡），事件会绕过按钮上那句
    // stopPropagation、径直冒泡到这里，被当成一次空白框选清空 canvasSel。
    // 但这条只挡得住"按钮还在但 disabled"这一种情况——真机复测发现光这条不够：
    // .ctoolbar-mini 本身也在 .snapshotting 隐藏清单里，而 takeSnapshot 里
    // classList.add('snapshotting') 和 setSnapBusy(true) 几乎同一时刻生效，
    // 等外部这一下点击真落地时，工具条往往已经 visibility:hidden、不参与命中测试了——
    // 点击直接穿透到画布本身，e.target 压根不在 .ctoolbar-mini 子树里，
    // closest 这条防线形同虚设。所以下面单独再加 snapBusy 兜底：
    // 拍照过程中（不管工具条这一刻是可见还是已经被藏起来）画布一律不接受新的
    // 框选/平移/画图操作，从根上堵住这条路径，不用管点击具体落在哪个元素上。
    if (
      snapBusy ||
      (e.target as HTMLElement).closest?.('.canvas-minimap') ||
      (e.target as HTMLElement).closest?.('.ctoolbar-mini')
    )
      return
    if (tool === 'select') {
      if (spaceHeld.current) startPan(e)
      else startBoxSelect(e)
      return
    }
    const { wx, wy } = screenToWorld(e.clientX, e.clientY)
    if (tool === 'sticky') {
      addShape({ type: 'sticky', x: wx, y: wy, w: 190, h: 96, text: '双击编辑…' })
      setTool('select')
      return
    }
    if (tool === 'todo') {
      // 待办清单不是 CanvasShape（原因见 canvas/types.ts 的 TodoBoard 注释），单独一支落点逻辑，
      // 单击即建、不用像矩形/箭头那样拖出尺寸——默认宽度够用，高度随内容自增
      addTodoBoard(wx, wy)
      setTool('select')
      return
    }
    const type = tool
    let d: Omit<CanvasShape, 'id'> = { type, x: wx, y: wy, w: 0, h: 0 }
    setDraft(d)
    let detachBlur = (): void => {}
    const onMove = (ev: MouseEvent): void => {
      const p = screenToWorld(ev.clientX, ev.clientY)
      d = { ...d, w: p.wx - d.x, h: p.wy - d.y }
      setDraft(d)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      detachBlur()
      let { x, y, w, h } = d
      if (type === 'rect') {
        if (w < 0) {
          x += w
          w = -w
        }
        if (h < 0) {
          y += h
          h = -h
        }
        if (w < 8 && h < 8) {
          w = 160
          h = 90
        }
      }
      addShape({ type, x, y, w, h })
      setDraft(null)
      setTool('select')
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // 画到一半真失焦 → 按当前尺寸收尾（等同松开鼠标），不留悬空监听；
    // hide/show 抖动引起的假 blur 由 attachBlurGuard 过滤掉，不会打断正在画的图形
    detachBlur = attachBlurGuard(onUp)
  }

  const startShapeDrag = (sh: CanvasShape, e: React.MouseEvent): void => {
    if (e.button !== 0 || tool !== 'select') return
    e.stopPropagation()
    selectElement('s:' + sh.id, e.shiftKey)
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const x0 = sh.x
    const y0 = sh.y
    let detachBlur = (): void => {}
    const onMove = (ev: MouseEvent): void =>
      updateShape(sh.id, { x: x0 + (ev.clientX - sx) / scale, y: y0 + (ev.clientY - sy) / scale })
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      detachBlur()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // 拖拽中真失焦 → 当场收尾，不留悬空监听；hide/show 抖动引起的假 blur 由
    // attachBlurGuard 过滤掉（见该文件注释），不会误伤正在进行的拖拽
    detachBlur = attachBlurGuard(onUp)
  }

  /** 图形的右下角缩放。便签原来只能在新建时拖出大小，之后就定死了 ——
   *  写长了的便签既看不全也改不了尺寸。 */
  const startShapeResize = (sh: CanvasShape, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const w0 = sh.w
    const h0 = sh.h
    let detachBlur = (): void => {}
    const onMove = (ev: MouseEvent): void =>
      updateShape(sh.id, {
        w: Math.max(120, w0 + (ev.clientX - sx) / scale),
        h: Math.max(60, h0 + (ev.clientY - sy) / scale)
      })
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      detachBlur()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // 拖拽中真失焦 → 当场收尾，不留悬空监听；hide/show 抖动引起的假 blur 由
    // attachBlurGuard 过滤掉（见该文件注释），不会误伤正在进行的拖拽
    detachBlur = attachBlurGuard(onUp)
  }

  const startFrameDrag = (f: CanvasFrame, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectElement('f:' + f.id, e.shiftKey)
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const fx = f.x
    const fy = f.y
    let detachBlur = (): void => {}
    const onMove = (ev: MouseEvent): void =>
      moveFrame(f.id, fx + (ev.clientX - sx) / scale, fy + (ev.clientY - sy) / scale)
    // 失焦兜底收尾（cleanup）和真正松手（onUp）分开：blur 时没有落点可言，
    // 不该去碰 elementFromPoint；只有真的 mouseup 才判定「有没有落在终端上」。
    const cleanup = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      detachBlur()
    }
    const onUp = (ev: MouseEvent): void => {
      cleanup()
      // 落点不是终端、或这个 Frame 没绑定项目时 dropModuleOnTerminal 直接返回 false，
      // 不影响上面 onMove 已经做的移动——移动本身不受这里影响，插路径只是附加动作
      const proj = useStore.getState().projects.find((p) => p.id === f.projectId)
      dropModuleOnTerminal(ev, proj?.path)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // 拖拽中真失焦 → 当场收尾，不留悬空监听；hide/show 抖动引起的假 blur 由
    // attachBlurGuard 过滤掉（见该文件注释），不会误伤正在进行的拖拽
    detachBlur = attachBlurGuard(cleanup)
  }

  const setScale = (s2: number): void => {
    const cur = useStore.getState().canvas.viewport
    const el = viewportRef.current
    const cx = (el?.clientWidth ?? 0) / 2
    const cy = (el?.clientHeight ?? 0) / 2
    const sc = clamp(s2, SCALE_MIN, SCALE_MAX)
    setViewport({
      scale: sc,
      x: cx - (cx - cur.x) * (sc / cur.scale),
      y: cy - (cy - cur.y) * (sc / cur.scale)
    })
  }

  const fitAll = (): void => {
    const el = viewportRef.current
    if (!el || !frames.length) return
    const x1 = Math.min(...frames.map((f) => f.x)) - 60
    const y1 = Math.min(...frames.map((f) => f.y)) - 70
    const x2 = Math.max(...frames.map((f) => f.x + f.w)) + 60
    const y2 = Math.max(...frames.map((f) => f.y + (f.collapsed ? HEAD_H : f.h))) + 60
    const sw = el.clientWidth
    const sh = el.clientHeight
    const sc = clamp(Math.min(sw / (x2 - x1), sh / (y2 - y1)), SCALE_MIN, 1.3)
    setViewport({
      scale: sc,
      x: (sw - (x2 - x1) * sc) / 2 - x1 * sc,
      y: (sh - (y2 - y1) * sc) / 2 - y1 * sc
    })
  }

  // 选中的工作区属于哪个项目。没选中 → null → 按钮禁用
  const snapProject = useMemo(() => {
    const fid =
      canvasSel.find((k) => k.startsWith('f:'))?.slice(2) ??
      canvasSel.find((k) => k.startsWith('n:'))?.split(':')[1]
    if (!fid) return null
    const f = frames.find((x) => x.id === fid)
    if (!f?.projectId) return null
    return projects.find((p) => p.id === f.projectId) ?? null
  }, [canvasSel, frames, projects])

  const takeSnapshot = async (): Promise<void> => {
    if (!snapProject || snapBusy) return
    const el = viewportRef.current
    if (!el) return
    setSnapBusy(true)
    try {
      // 拍照前先结束绘制态：正在拖的草稿不该进图（正在编辑的便签由 runCanvasSnapshot
      // 统一收尾——它要先把文字存回 shape 再卸载，见那边的 commitEditingSticky）。
      // 上一次失败留下的红字提示也要在这清掉——不清的话："失败→用户没点掉→
      // 直接重试→这次成功"这条路径会让上一次的错误文案原样出现在这张成功的截图里
      // （.csnap-err 是 .canvas-viewport 的直接子元素，必在截图范围内）。
      setDraft(null)
      setSnapErr(null)
      // 藏浮层 / 等两帧 / 量 rect / 落盘 全在 runCanvasSnapshot 里，和 MCP 那条路共用
      // 同一份实现与同一个 .snapshotting 引用计数（见 snapshotRun.ts 顶部注释）
      const res = await runCanvasSnapshot(el, snapProject.path)
      if (!res.ok || !res.path) {
        setSnapErr(res.error ?? '快照失败')
        return
      }
      useStore.getState().setLastSnapshot({ path: res.path, projectId: snapProject.id, at: Date.now() })
      // 已经记住过选择就直接执行、不弹窗；未设置（每次都问）才走下面的确认框
      const pref = (await window.api.prefs.get()).clearShapesAfterSnapshot
      const n = useStore.getState().canvas.shapes.length
      if (pref === 'clear') {
        useStore.getState().clearShapes()
        return
      }
      if (pref === 'keep') return
      if (n > 0) setPendingClear(n) // 一个标记都没有就没必要问
    } catch (e) {
      // 正常的业务失败走上面 res.ok 分支；这里接的是 IPC 本身抛出的意外情况，
      // 同样要给用户看得见的提示，不能只 console.error 完事
      setSnapErr(e instanceof Error ? e.message : '快照失败')
    } finally {
      setSnapBusy(false)
    }
  }

  // 「拍完要不要清掉标记」确认框开着时，agent 那条 MCP 拍照路径也要停手：
  // 那个弹窗 portal 在 document.body 上、z-index 3500，16 条隐藏规则全是
  // `.app.snapshotting xxx` 的后代选择器，够不着它，硬拍会把弹窗原样拍进图。
  // 按钮自己有 disabled 挡着（下面那颗相机），MCP 只能靠这个模块级开关。
  useEffect(() => {
    setClearDialogOpen(pendingClear !== null)
    return () => setClearDialogOpen(false)
  }, [pendingClear])

  /** 「清掉标记」确认框的两个按钮共用这一个收尾：真正清不清、记不记，都在这一处判断 */
  const finishClear = (choice: 'keep' | 'clear'): void => {
    if (choice === 'clear') useStore.getState().clearShapes()
    // 记住的是他按的那个按钮，不是勾选框自带一个默认动作
    if (remember) void window.api.prefs.set('clearShapesAfterSnapshot', choice)
    setPendingClear(null)
    setRemember(false) // 勾选框每次弹出都从未勾选开始，不继承上次
  }

  // 这份 renderShape 不是 CanvasShapeLayer.tsx 那份的残留重复——两处都留着是有意的。
  // 这里只画 draft（正在拖出来的草稿，永远 isDraft=true，走不到选中/拖动/编辑分支）；
  // 成品标记已经搬去 CanvasShapeLayer，渲染在 PaneLayer 之后才压得住活终端（见该文件顶部注释）。
  // 下面 return 里只剩 `{draft && renderShape(draft, true)}` 一行调用，别看到两份同名函数就顺手合并掉。
  const renderShape = (sh: Omit<CanvasShape, 'id'> & { id?: string }, isDraft = false): JSX.Element => {
    const id = sh.id ?? '__draft__'
    const left = Math.min(sh.x, sh.x + sh.w)
    const top = Math.min(sh.y, sh.y + sh.h)
    const w = Math.abs(sh.w)
    const h = Math.abs(sh.h)
    const selCls = !isDraft && sel.has('s:' + id) ? ' sel' : ''
    const onDown = (e: React.MouseEvent): void => {
      if (!isDraft) startShapeDrag(sh as CanvasShape, e)
    }
    if (sh.type === 'sticky') {
      const sw = Math.max(w, 120)
      const shh = Math.max(h, 60)
      if (!isDraft && editingSticky === id) {
        return (
          <textarea
            key={id}
            className="cshape cshape-sticky editing"
            style={{ left, top, width: sw, height: shh }}
            defaultValue={sh.text}
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              updateShape(id, { text: e.target.value })
              setEditingSticky(null)
            }}
          />
        )
      }
      return (
        <div
          key={id}
          className={`cshape cshape-sticky${selCls}`}
          data-sid={id}
          style={{ left, top, width: sw, height: shh }}
          onMouseDown={(e) => {
            // 按在滚动条上时不要启动拖拽 —— 否则想翻内容，结果整个便签跟着鼠标跑
            const b = (e.target as HTMLElement).closest('.cshape-sticky-body') as HTMLElement | null
            if (b && b.scrollHeight > b.clientHeight && e.nativeEvent.offsetX > b.clientWidth) return
            onDown(e)
          }}
          onDoubleClick={() => !isDraft && setEditingSticky(id)}
        >
          {/* 文字单独一层：便签本体不滚，滚的是这里。
              本体要是可滚的，拖动便签时鼠标一动就会先滚内容 */}
          <div className="cshape-sticky-body">{sh.text}</div>
          {!isDraft && <div className="cshape-rz" onMouseDown={(e) => startShapeResize(sh as CanvasShape, e)} />}
        </div>
      )
    }
    if (sh.type === 'rect') {
      return (
        <div
          key={id}
          className={`cshape cshape-rect${selCls}`}
          data-sid={id}
          style={{ left, top, width: w, height: h }}
          onMouseDown={onDown}
        />
      )
    }
    // arrow
    const ax1 = sh.w >= 0 ? 0 : w
    const ay1 = sh.h >= 0 ? 0 : h
    const ax2 = sh.w >= 0 ? w : 0
    const ay2 = sh.h >= 0 ? h : 0
    return (
      <svg
        key={id}
        className={`cshape cshape-arrow${selCls}`}
        data-sid={id}
        style={{ left, top, width: Math.max(w, 2), height: Math.max(h, 2), overflow: 'visible' }}
        onMouseDown={onDown}
      >
        <defs>
          <marker id={`ah-${id}`} markerWidth="10" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="var(--accent)" />
          </marker>
        </defs>
        <line
          x1={ax1}
          y1={ay1}
          x2={ax2}
          y2={ay2}
          stroke="var(--accent)"
          strokeWidth="2"
          markerEnd={`url(#ah-${id})`}
        />
      </svg>
    )
  }

  return (
    <div
      ref={viewportRef}
      className={`canvas-viewport${tool !== 'select' ? ' drawing' : ''}`}
      onMouseDown={onViewportDown}
      onDoubleClick={onViewportDblClick}
      style={{
        backgroundSize: `${26 * vp.scale}px ${26 * vp.scale}px`,
        backgroundPosition: `${vp.x}px ${vp.y}px`
      }}
    >
      {/* 空画布引导。挂在 viewport 而不是 canvas-world 里 —— 后者跟着缩放平移，
          提示会飘走还会被缩小；这条是「这里该怎么开始」，得一直在视野中央。
          pointer-events:none 是硬要求：它正上方就是双击热区，挡住等于把入口堵死。 */}
      {/* 判据只看 frames + freeNodes：shapes（便签/箭头）搬去 CanvasShapeLayer 自己订阅了，
          本组件刻意不订阅它（见上面第 58 行），不为一句引导把那次重渲染优化撤回来。
          画了便签但还没有项目的画布上仍然显示这句 —— 那时它说的也是实话。 */}
      {!frames.length && !freeNodes.length && (
        <div className="canvas-empty-hint">双击开始你第一个项目吧</div>
      )}
      <div
        className="canvas-world"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})` }}
      >
        {draft && renderShape(draft, true)}
        {band && (
          <div
            className="canvas-band"
            style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
          />
        )}
        {frames.map((f) => (
          <div
            key={f.id}
            className={`cframe${f.parentId ? ' sub' : ''}${f.collapsed ? ' collapsed' : ''}${sel.has('f:' + f.id) ? ' sel' : ''}`}
            data-fid={f.id}
            style={
              {
                left: f.x,
                top: f.y,
                width: f.w,
                height: f.collapsed ? HEAD_H : f.h,
                // 状态配色**注入变量，不用写死的 st-* 类**：列是用户自己建的，
                // 新建一列不可能顺手去 canvas.css 里加一条规则。
                //
                // **注的是 `--dot-rgb`，只有那颗圆点读它**（见 .cframe-dot）——
                // 框本身一律走主题色。十几个 Frame 各染各的色，画布整体就散了，
                // 而「属于哪一类」是次要信息，一颗 9px 的点足够承载。
                ...dotTint(statusColor(statusOfFrame(frames, projects, f.id)))
              } as React.CSSProperties
            }
          >
            <div
              className="cframe-head"
              onMouseDown={(e) => startFrameDrag(f, e)}
              onDoubleClick={() => setEditingFrame(f.id)}
            >
              {/* 色点即状态入口：它本来就长在「状态灯」该在的位置，再加一个按钮只会挤标题栏 */}
              <button
                className="cframe-dot"
                data-tip={`状态：${statusLabel(statusOfFrame(frames, projects, f.id))}（点击更改）`}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setStatusPop({ x: r.left, y: r.bottom + 6, frameId: f.id })
                }}
              />
              {/* 多 agent 总闸。放在名字前面 —— 它是这个项目的一个持久属性，
                  跟色点（状态）同类，不是标题栏右边那排「做一件事」的按钮。
                  **只有顶层项目 Frame 出这个开关**：子 Frame 是文件夹分组，
                  跟着父的走（判定见 teamMode.ts）。 */}
              {!f.collapsed && !f.parentId && !!f.projectId && (
                <button
                  className={`cframe-team${teamModeOf(frames, f.id) ? ' on' : ''}`}
                  data-tip={
                    teamModeOf(frames, f.id)
                      ? '多 agent：开。这个项目允许组团队（点击关闭）'
                      : '多 agent：关。开了之后才能把任务拆给多个 agent 并行做'
                  }
                  onMouseDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={() => toggleTeamMode(f.id, !teamModeOf(frames, f.id))}
                >
                  <ChipIcon size={11} />
                </button>
              )}
              {editingFrame === f.id ? (
                <input
                  className="cframe-rename"
                  defaultValue={f.name}
                  autoFocus
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    renameFrame(f.id, e.target.value.trim() || f.name)
                    setEditingFrame(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditingFrame(null)
                  }}
                />
              ) : (
                <b className="cframe-name">{f.name}</b>
              )}
              {/* 手机碰过、你还没看过的节点数。
                  **折叠时也显示** —— 那正是你看不见里面节点的时候，
                  这条恰恰在折叠态最有用。它是信息不是操作按钮，
                  跟状态点同类，所以不在「折叠只留展开」那条规矩里 */}
              {phoneMarks(f) > 0 && (
                <span
                  className="cframe-phone"
                  data-tip={`手机在这里做了 ${phoneMarks(f)} 件事，你还没看过`}
                >
                  {phoneMarks(f)}
                </span>
              )}
              <span className="cframe-spacer" />
              {/* ── 折叠时这排全收掉，只留展开 ────────────────────────────
                  它们做的事都以「你看得见里面」为前提：整理排列看不到结果、
                  新建的节点会落进一个收起来的盒子里、复制路径跟展开与否无关
                  但混在一排里只会让折叠态显得没收干净。
                  折叠态该只剩三样：状态点、名字、展开。 */}
              {!f.collapsed && (
                <>
              <button
                className="cframe-btn"
                data-tip="整理排列（模块按大小从左上对齐）"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => tidyFrame(f.id)}
              >
                <TidyIcon size={13} />
              </button>
              {/* 排在终端前面：新建 Frame 默认落的就是 AI 对话节点，它是更常走的那条路 */}
              <button
                className="cframe-btn"
                data-tip="新建 AI 对话"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void addAgentNode(f.id)}
              >
                <SparkleIcon size={13} />
              </button>
              <button
                className="cframe-btn"
                data-tip="新建终端"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void addTerminalNode(f.id)}
              >
                <TerminalIcon size={13} />
              </button>
              <button
                className="cframe-btn"
                data-tip="新建浏览器"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => addBrowserNode(f.id)}
              >
                <GlobeIcon size={13} />
              </button>
              <button
                className="cframe-btn"
                data-tip="单击复制路径"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  // 子 Frame 复制其文件夹路径，项目 Frame 复制项目根路径
                  const path = f.folderPath ?? projects.find((p) => p.id === f.projectId)?.path
                  if (path) void window.api.clipboard.writeText(path)
                }}
              >
                <CopyIcon size={13} />
              </button>
                </>
              )}
              <button
                className="cframe-btn"
                data-tip={f.collapsed ? '展开' : '折叠'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => toggleCollapse(f.id)}
              >
                {f.collapsed ? <PlusIcon size={13} /> : <MinusIcon size={13} />}
              </button>
            </div>
            {!f.collapsed && f.nodes.length === 0 && <div className="cframe-empty">空 Frame</div>}
            {!f.collapsed &&
              f.nodes
                // **有 leafId 就不画壳。** 那说明这个节点的内容已经由 PaneLayer
                // 接管（它按 leafId 把真实内容浮在画布上），这里再画一个文件节点的壳
                // 就是第二层：两套头部按钮叠着、边框错开几个像素露出两条线。
                // 正常的文件/图片/网页节点没有 leafId（materializeCanvas 里
                // 「文件/图片/网页 → 画布自带节点，不需要 leaf」那条直接 continue），
                // 组件节点同理，所以这条过滤不会误伤它们。
                .filter((n) => (n.pane || n.component) && !n.leafId)
                .map((n) =>
                  n.component ? (
                    <CanvasComponentNode
                      key={n.id}
                      frame={f}
                      node={n}
                      selected={sel.has('n:' + f.id + ':' + n.id)}
                      onSelect={(add) => {
                        selectElement('n:' + f.id + ':' + n.id, add)
                        clearPhoneNode(n.id) // 点开了就是看过了
                      }}
                    />
                  ) : (
                    <CanvasFileNode
                      key={n.id}
                      frameId={f.id}
                      node={n}
                      selected={sel.has('n:' + f.id + ':' + n.id)}
                      onSelect={(add) => {
                        selectElement('n:' + f.id + ':' + n.id, add)
                        clearPhoneNode(n.id) // 点开了就是看过了
                      }}
                    />
                  )
                )}
            {/* 手机碰过的节点：一个角标 + 一圈高亮。
                **画在这一层而不是节点组件里** —— 节点有两种形态
                （自带 pane 的、和内容由 PaneLayer 接管的 leafId 形态），
                按几何位置画的话一处就盖住两种，不用改两个组件。
                点它就消 —— 判据是「你看过了」。 */}
            {!f.collapsed &&
              f.nodes
                .filter((n) => n.phoneAt)
                .map((n) => (
                  <div
                    key={'ph:' + n.id}
                    className="cnode-phone"
                    style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                  >
                    <button
                      className="cnode-phone-dot"
                      data-tip="手机在这里做过事，点掉这个标记"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        clearPhoneNode(n.id)
                      }}
                    />
                  </div>
                ))}
          </div>
        ))}
        {/* 自由节点：拖知识库文件到画布任意位置生成，不属于任何 Frame——世界坐标，直接渲染在
            .canvas-world 下（跟 shapes 同级），随视口 transform 一起缩放平移，不用叠加 Frame 偏移。 */}
        {freeNodes.map((n) => (
          <CanvasFreeFileNode
            key={n.id}
            node={n}
            selected={sel.has('p:' + n.id)}
            onSelect={(add) => selectElement('p:' + n.id, add)}
          />
        ))}
      </div>

      {/* 基本操作收成一条紧凑图标栏（原来占着整个左抽屉，那个位置让给知识库了）。
          删掉的话「在画布上圈一下、写个便签」就无处可做，所以是搬家不是删除。 */}
      <div className={`ctoolbar-mini${maximized ? ' on-max' : ''}`}>
        <button
          className={`ctool${tool === 'select' ? ' on' : ''}`}
          data-tip="选择 / 移动"
          onClick={() => setTool('select')}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M5 3l6 16 2.5-6.5L20 10z" />
          </svg>
        </button>
        <button
          className={`ctool${tool === 'rect' ? ' on' : ''}`}
          data-tip="矩形"
          onClick={() => setTool('rect')}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="5" width="16" height="14" rx="2" />
          </svg>
        </button>
        <button
          className={`ctool${tool === 'arrow' ? ' on' : ''}`}
          data-tip="箭头"
          onClick={() => setTool('arrow')}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 19L19 5M19 5h-7M19 5v7" />
          </svg>
        </button>
        <button
          className={`ctool${tool === 'sticky' ? ' on' : ''}`}
          data-tip="批注"
          onClick={() => setTool('sticky')}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16v11l-5 5H4z" />
            <path d="M20 15h-5v5" />
          </svg>
        </button>
        <button
          className={`ctool${tool === 'todo' ? ' on' : ''}`}
          data-tip="待办清单"
          onClick={() => setTool('todo')}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <path d="M8 12.5l2.4 2.4L16 9.5" />
          </svg>
        </button>
        <button
          className="ctool"
          disabled={!snapProject || snapBusy || pendingClear !== null}
          data-tip={
            pendingClear !== null
              ? '请先处理清空提示'
              : snapProject
                ? '快照当前画板'
                : '请在画板中选择一个工作区'
          }
          // 这颗按钮必须挡住 mousedown 冒泡：不挡的话会先落到 onViewportDown，
          // tool==='select' 时那边会当成一次空白框选、把 canvasSel 清空——
          // 等 click 真正触发 takeSnapshot 时 snapProject 已经变回 null，
          // 按钮形同虚设（真机测试实测到的坑：点了没反应，不报错也不截图）。
          // 同排其余四个工具按钮没这条是因为它们的行为不依赖 canvasSel，这颗必须有。
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => void takeSnapshot()}
        >
          <CameraIcon size={13} />
        </button>
      </div>

      {snapErr && (
        <div className="csnap-err" onClick={() => setSnapErr(null)}>
          {snapErr}
        </div>
      )}

      {/* 快照后「要不要清掉标记」确认框。不能用现成的 requestConfirm/ConfirmDialog——
          那个只有确定/取消两个按钮，装不下「保留 / 清掉 + 记住选择」。
          沿用它的 .confirm-overlay/.confirm-dialog/.confirm-message/.confirm-actions
          视觉样式（同一套危险操作确认弹窗体系，z-index 3500，见 base.css），
          并且同样 portal 到 body——.canvas-viewport 是 overflow: clip 的滚动端口，
          不 portal 出去会被裁到只剩画板那一块，盖不住左边的终端。 */}
      {pendingClear !== null &&
        createPortal(
          <div
            className="confirm-overlay"
            onMouseDown={() => {
              setPendingClear(null)
              setRemember(false) // 点背景等于「这次不处理」，不该让下次弹窗继承勾选状态
            }}
          >
            <div className="confirm-dialog" onMouseDown={(e) => e.stopPropagation()}>
              <div className="confirm-message">
                已保存快照，标记已经拍进图里了。
                <br />
                <br />
                要不要把画板上的 {pendingClear} 个标记清掉？
              </div>
              <label className="cset-row">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span className="cset-rowname">记住这次选择，以后不再问</span>
              </label>
              <div className="confirm-actions">
                <button className="csnap-keep-btn" onClick={() => finishClear('keep')}>
                  保留
                </button>
                <button className="danger-btn" onClick={() => finishClear('clear')}>
                  清掉
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <CanvasMiniMap />
      <RunMonitor />

      <div className={`canvas-zoombar${maximized ? ' on-max' : ''}`}>
        <button
          onClick={() => setScale(useStore.getState().canvas.viewport.scale / 1.15)}
          data-tip="缩小"
        >
          <MinusIcon size={14} />
        </button>
        <button className="zoom-pct" onClick={() => setScale(1)} data-tip="重置 100%">
          {Math.round(vp.scale * 100)}%
        </button>
        <button
          onClick={() => setScale(useStore.getState().canvas.viewport.scale * 1.15)}
          data-tip="放大"
        >
          <PlusIcon size={14} />
        </button>
        <button className="zoom-fit" onClick={fitAll} data-tip="适应全部">
          ⤢
        </button>
      </div>

      {menu && (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          header={menu.header}
          onClose={() => setMenu(null)}
        />
      )}

      {statusPop && (
        <FrameStatusPicker
          x={statusPop.x}
          y={statusPop.y}
          frameId={statusPop.frameId}
          current={statusOfFrame(frames, projects, statusPop.frameId)}
          onClose={() => setStatusPop(null)}
        />
      )}

      {picker && (
        <CanvasFilePicker
          x={picker.x}
          y={picker.y}
          root={picker.root}
          rootName={picker.rootName}
          onClose={() => setPicker(null)}
          onPickPlugin={(plug) => {
            // 插件插进画布 = 开一个**绑定了它**的 AI 对话节点。
            // 插件本身没有界面可渲染（两个生态的插件都不含 UI 代码，2026-08-24 实测），
            // 能落在画布上的只有「带着它的工具的那个会话」。
            //
            // 三样都要带齐，少一样就是「说你能做、工具却不在」：
            //   cli        —— 插件属于谁就用谁起会话，不能让它挑默认的那个
            //   pluginId   —— 主进程据此决定往 agent-mcp.json 里合并谁（一次只带一个）
            //   initialMessage —— 插件自带的 defaultPrompt，Claude 插件没有就不填
            const frame = useStore.getState().canvas.frames.find((f) => f.id === picker.frameId)
            if (!frame) return
            addFileNode(
              picker.frameId,
              {
                kind: 'agent',
                cwd: picker.root,
                cli: plug.cli,
                pluginId: plug.id,
                ...(plug.defaultPrompt ? { initialMessage: plug.defaultPrompt } : {})
              },
              picker.wx - frame.x - 90,
              picker.wy - frame.y - 15
            )
          }}
          onPick={(filePath) => {
            const place = (pane: PaneState): void => {
              // 重新取 Frame：菜单开着的这会儿它可能已被 reflow 挪过位置
              const frame = useStore.getState().canvas.frames.find((f) => f.id === picker.frameId)
              if (!frame) return
              addFileNode(picker.frameId, pane, picker.wx - frame.x - 90, picker.wy - frame.y - 15)
            }
            // .html 两种看法都合理（渲染 / 源码），不替用户定
            if (isHtmlPath(filePath)) {
              setHtmlPick({ x: picker.x, y: picker.y, path: filePath, place })
              return
            }
            place(paneForFile(filePath))
          }}
        />
      )}
      {htmlPick && (
        <HtmlOpenChoice
          x={htmlPick.x}
          y={htmlPick.y}
          fileName={htmlPick.path.split('/').pop() ?? ''}
          onPick={(as) => htmlPick.place(paneForFile(htmlPick.path, as))}
          onClose={() => setHtmlPick(null)}
        />
      )}
    </div>
  )
}
