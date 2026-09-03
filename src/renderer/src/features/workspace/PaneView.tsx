import { lazy, Suspense, useEffect, useRef, useState, useLayoutEffect} from 'react'
import { invertTransform, sameRect, FLIP_EASING, FLIP_MS, type FlipRect } from './flip.ts'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import type { LeafNode, PaneKind, Rect } from '../../layout'
import { TerminalView } from '../terminal/TerminalView'
import { CodeView } from '../editor/CodeView'
import { DiffView } from '../editor/DiffView'
import { ImageView } from '../image/ImageView'
import { HistoryView } from '../git/HistoryView'
import { ChatNavView } from '../chat/ChatNavView'
import { AgentChatView } from '../agentChat/AgentChatView'
import { WebView } from '../web/WebView'
import { useCanvasWheelPassthrough } from '../canvas/wheelPassthrough'
import { makeSubframeDrop } from '../canvas/subframeDrop'
import { AgentCmdBar } from '../canvas/AgentCmdBar'

// 词典懒加载：242 词条的内联 SVG bundle 有 368KB，不该进主包，首次打开词典面板才拉取
const DictView = lazy(() =>
  import('../dict/DictView').then((m) => ({ default: m.DictView }))
)
const WikiView = lazy(() => import('../wiki/WikiView').then((m) => ({ default: m.WikiView })))
import {
  TerminalIcon,
  CodeIcon,
  ImageIcon,
  GitBranchIcon,
  MessageIcon,
  DictIcon,
  ChevronDownIcon,
  CloseIcon,
  MaximizeIcon,
  RestoreIcon,
  SplitHIcon,
  SplitVIcon,
  CheckIcon,
  GlobeIcon,
  FilesIcon,
  SparkleIcon
} from '../../ui/Icons'

const PANE_GAP = 3

// 下拉框可切换到的面板类型（不含 history —— 它只从侧栏「版本」打开）
const KIND_OPTIONS: { kind: PaneKind; label: string; Icon: typeof TerminalIcon }[] = [
  { kind: 'terminal', label: '终端', Icon: TerminalIcon },
  // AI 对话排在终端后面：它是新建 Frame 时的默认节点，但已有节点要换成它得能选得到
  { kind: 'agent', label: 'AI 对话', Icon: SparkleIcon },
  { kind: 'code', label: '代码预览', Icon: CodeIcon },
  { kind: 'image', label: '图片预览', Icon: ImageIcon },
  { kind: 'web', label: '网页', Icon: GlobeIcon },
  { kind: 'dict', label: '辞典', Icon: DictIcon },
  { kind: 'wiki', label: '知识库', Icon: FilesIcon }
]

// 显示当前类型用（含 history/agent，供头部展示）
const KIND_LABEL: Record<PaneKind, { label: string; Icon: typeof TerminalIcon }> = {
  terminal: { label: '终端', Icon: TerminalIcon },
  code: { label: '代码预览', Icon: CodeIcon },
  image: { label: '图片预览', Icon: ImageIcon },
  history: { label: '历史', Icon: GitBranchIcon },
  chat: { label: '对话', Icon: MessageIcon },
  agent: { label: 'AI 对话', Icon: SparkleIcon },
  dict: { label: '辞典', Icon: DictIcon },
  web: { label: '网页', Icon: GlobeIcon },
  wiki: { label: '知识库', Icon: FilesIcon }
}

function PaneKindSelect({
  kind,
  onChange,
  canvasMode
}: {
  kind: PaneKind
  onChange: (kind: PaneKind) => void
  /** 画布模式下排除「辞典」——它改由标题栏叫出的浮动面板承载（且作为画布节点会崩溃） */
  canvasMode?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const options = canvasMode ? KIND_OPTIONS.filter((o) => o.kind !== 'dict') : KIND_OPTIONS

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (e.target instanceof Node && btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const current = KIND_LABEL[kind]

  return (
    <>
      <button
        ref={btnRef}
        className={`pane-kind-btn${open ? ' open' : ''}`}
        data-tip="切换面板功能"
        onClick={() => {
          const r = btnRef.current!.getBoundingClientRect()
          setMenuPos({ x: r.left, y: r.bottom + 6 })
          setOpen((v) => !v)
        }}
      >
        <current.Icon size={13} />
        <span>{current.label}</span>
        <ChevronDownIcon size={11} className="pane-kind-chevron" />
      </button>
      {open &&
        // Portal 到 body：玻璃面板的 backdrop-filter 会让 position:fixed
        // 相对面板定位并被 overflow:hidden 裁切，必须逃逸出去
        createPortal(
          <div className="glass-menu" style={{ left: menuPos.x, top: menuPos.y }}>
            {options.map(({ kind: k, label, Icon }) => (
              <button
                key={k}
                className={`glass-menu-item${k === kind ? ' selected' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setOpen(false)
                  if (k !== kind) onChange(k)
                }}
              >
                <Icon size={14} />
                <span>{label}</span>
                {k === kind && <CheckIcon size={12} className="glass-menu-check" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

/** 画布模式下节点的屏幕像素定位（世界坐标 × 视口换算的结果 + 拖动所需上下文） */
export interface CanvasPlacement {
  left: number
  top: number
  w: number
  h: number
  scale: number
  frameId: string
  nodeId: string
  nodeX: number
  nodeY: number
  /** 自定义名称（画布节点重命名） */
  name?: string
  /** 最大化沉浸：铺满画布视口、1:1 字号、盖住其它内容 */
  maximized?: boolean
  /** 看板模式：位置来自卡片里那个空槽位的实测坐标，不是画布世界坐标。
   *  复用同一套定位是为了**不换父容器** —— 换了 xterm 就重挂载，会话和滚动缓冲全丢。
   *  但画布特有的交互（拖节点、拉伸、选中）在看板里都不该有：卡片是被拖的那个，
   *  终端只是嵌在里面的内容。 */
  board?: boolean
}

interface Props {
  tabId: string
  leaf: LeafNode
  rect: Rect
  isActive: boolean
  /** 隐藏但保持挂载（非激活 tab 或画布模式下的 leaf）——终端不断连的关键 */
  hidden?: boolean
  /** 画布模式定位；存在时用像素 + transform 缩放，否则用分屏百分比 rect */
  canvasRect?: CanvasPlacement
}

export function PaneView({ tabId, leaf, rect, isActive, hidden, canvasRect }: Props): JSX.Element {
  const setPaneKind = useStore((s) => s.setPaneKind)
  const moveNode = useStore((s) => s.moveNode)
  const settleNode = useStore((s) => s.settleNode)
  const resizeNode = useStore((s) => s.resizeNode)
  const settleResize = useStore((s) => s.settleResize)
  const splitLeaf = useStore((s) => s.splitLeaf)
  const closeLeaf = useStore((s) => s.closeLeafSafely)
  const setActiveLeaf = useStore((s) => s.setActiveLeaf)
  const openChat = useStore((s) => s.openChat)
  const tabCwd = useStore((s) => s.tabs.find((t) => t.id === tabId)?.cwd ?? '')
  const renameNode = useStore((s) => s.renameNode)
  const toggleCanvasSel = useStore((s) => s.toggleCanvasSel)
  const [editingName, setEditingName] = useState(false)
  const paneRef = useRef<HTMLDivElement>(null)

  // ── 最大化 / 还原的丝滑动画（FLIP）─────────────────────────────────────
  //
  // 用户 2026-09-02：「所有的全屏都要有丝滑的放大动画，缩小也有，
  // 类似于苹果的最大化动画。」
  //
  // **不能直接给 left/top/width/height 加 transition** —— 那四个属性每帧触发
  // 布局→绘制→合成，而节点里装的是终端、编辑器这些重内容；xterm 还会按容器尺寸
  // 重算字符网格，动画期间字一直跳。
  //
  // FLIP：布局一步到位（瞬间变成终态），只用 transform 把视觉倒推回起点，
  // 再跑回 identity。**全程只动 transform** —— 走合成层，不触发布局，
  // 也满足 `check-animations.mjs` 那道闸。
  const lastRect = useRef<FlipRect | null>(null)
  useLayoutEffect(() => {
    const el = paneRef.current
    if (!el || !canvasRect) return
    const now: FlipRect = { left: canvasRect.left, top: canvasRect.top, w: canvasRect.w, h: canvasRect.h }
    const prev = lastRect.current
    lastRect.current = now
    // 第一次挂载没有起点可倒推；几乎没变的也别动画（硬跑一遍只会闪一下）
    if (!prev || sameRect(prev, now)) return
    // **只给最大化/还原这一类跳变做动画**，平移和缩放画布时 rect 也在变，
    // 那些本来就是连续的，再叠一层补间会拖泥带水。判据是「面积变了一大截」。
    const ratio = (now.w * now.h) / Math.max(1, prev.w * prev.h)
    if (ratio > 0.6 && ratio < 1.7) return
    const grow = ratio > 1
    const anim = el.animate(
      [{ transform: invertTransform(prev, now) }, { transform: 'none' }],
      { duration: grow ? FLIP_MS.grow : FLIP_MS.shrink, easing: FLIP_EASING }
    )
    return () => anim.cancel()
  }, [canvasRect?.left, canvasRect?.top, canvasRect?.w, canvasRect?.h])
  // 画布模式下本终端节点的选中 key，供高亮 + 点选
  const selKey = canvasRect && !canvasRect.board ? 'n:' + canvasRect.frameId + ':' + canvasRect.nodeId : ''
  const selected = useStore((s) => (selKey ? s.canvasSel.includes(selKey) : false))
  const isCanvas = !!canvasRect

  // 画布模式：滚轮落在本模块上时——「选中」才让模块内部（终端/预览）自己滚动，
  // 「未选中」则拦下滚轮平移/缩放画板（与画板空白处一致，鼠标经过模块不再抢走 pan）。
  // 终端浮在 pane-layer、滚轮不经 canvas-viewport，故这里在 pane 上加原生捕获监听（passive:false 方可 preventDefault）。
  //
  // **看板模式必须排除掉。** 它跟画布共用 canvasRect 定位（为的是不换父容器、
  // xterm 不重挂载），于是 isCanvas 也跟着为真，这套拦截就一起挂上了 ——
  // 后果有两个，都很隐蔽：
  //   1. 看板里点开的终端翻不动 scrollback（滚轮在 capture 阶段就被 stopPropagation 掉，
  //      xterm 根本收不到）；
  //   2. 更糟的是它照旧去 setViewport 平移**画布**的视口 —— 你在看板里滚几下，
  //      切回画布发现整个画面跑掉了，而看板上什么都没发生，根本联想不到是这里。
  // 看板没有可平移的画布，这套逻辑在那儿没有任何意义。
  // 驱动画布那段（平移 / ctrl 缩放）已提到 canvas/wheelPassthrough.ts —— 标记层要用同一套，
  // 各写一份的话以后改缩放手感会漏改一处，而症状只是「有的地方手感不一样」，很难查。
  useCanvasWheelPassthrough(
    paneRef,
    isCanvas && !canvasRect?.board,
    // 铺满视口时画布已经被整个盖住，「滚轮平移画布」没有任何意义 —— 直接放行。
    // 最大化时 store 那边也会顺手选中它，这里是第二道：即使选中状态没同步上，
    // 滚轮该归内容还是归内容
    () =>
      !!canvasRect?.maximized ||
      (!!selKey && useStore.getState().canvasSel.includes(selKey)) // 选中 → 放行给模块内容
  )

  const pane = leaf.pane
  const hasFile = pane.kind === 'code' || pane.kind === 'image'
  const fileName = hasFile && pane.filePath ? pane.filePath.split('/').pop() : null

  const cs = canvasRect?.scale ?? 1 // 实时缩放比(每帧跟手)
  // ── canvasCommittedScale 这里不再用了（2026-08-30 改真缩放）──────────
  // 它原来的用途：画布终端按「落定的缩放比」重排字号，缩放手势中先用 transform
  // 做视觉预览，停定后再真正 fit。真缩放之后终端在自己的坐标系里恒为 1:1、
  // 视觉缩放全交给 pane 的 transform，**没有「落定」这件事了**。
  // store 里那个字段还在（画布场景要持久化它），PaneLayer 也还引着，
  // 但渲染这一侧不再依赖它 —— 别再从它推导终端该多大。
  const setMaximizedNode = useStore((s) => s.setMaximizedNode)
  const canvasTerm = !!canvasRect && pane.kind === 'terminal'
  // 还没探测出结果（null）时按「可用」渲染，避免启动瞬间控制条闪一下才出现
  const agentCli = useStore((s) => s.agentCli)
  const agentAvailable = !agentCli || agentCli.claude || agentCli.codex
  const isMax = !!canvasRect?.maximized
  // 最大化：脱离画布缩放，按 1:1 渲染（字号正常，真沉浸）

  // 画布模式：终端=按 committed 像素尺寸 + 缩放手势中 transform 预览；其它节点=像素定位 + 整体位图缩放；分屏=百分比 rect
  const paneStyle: CSSProperties = canvasRect
    ? canvasTerm
      ? {
          // ── 真缩放（2026-08-30，用户在对比页上选的 B）──────────────────
          // 原来终端走的是「裁剪」：按 committed 缩放渲染成真实像素，字号不跟着缩，
          // 缩小 = 少看几行。问题是**输入框没有内容可裁**（它就一行），
          // 只能整块占着 —— 缩到 35% 时它从占 8.9% 涨到 25.6%，整个节点头重脚轻。
          // 而且手势中做位图预览、停定后重排回真实尺寸，那一下会跳。
          //
          // 现在和画布上其它节点走同一条路：**按 1:1 布局，再整体 transform**。
          // 比例在任何缩放下都恒定，手势中的跳变也自然消失（全程就是同一个 transform）。
          // 代价是缩小时字会跟着变小 —— 那正是「缩略图」该有的样子，
          // 想读内容就放大或最大化。
          display: hidden ? 'none' : undefined,
          left: canvasRect.left,
          top: canvasRect.top,
          width: canvasRect.w,
          height: canvasRect.h,
          zIndex: isMax ? 200 : undefined,
          transform: isMax ? undefined : `scale(${cs})`,
          transformOrigin: '0 0'
        }
      : {
          display: hidden ? 'none' : undefined,
          left: canvasRect.left,
          top: canvasRect.top,
          width: canvasRect.w,
          height: canvasRect.h,
          transform: isMax ? undefined : `scale(${cs})`,
          transformOrigin: '0 0',
          zIndex: isMax ? 200 : undefined
        }
    : {
        display: hidden ? 'none' : undefined,
        left: `calc(${rect.x * 100}% + ${PANE_GAP}px)`,
        top: `calc(${rect.y * 100}% + ${PANE_GAP}px)`,
        width: `calc(${rect.w * 100}% - ${PANE_GAP * 2}px)`,
        height: `calc(${rect.h * 100}% - ${PANE_GAP * 2}px)`
      }

  // 画布模式下拖动节点头部 → 改节点相对坐标（moveNode）
  const onCanvasHeadDown = (e: React.MouseEvent): void => {
    if (!canvasRect || canvasRect.board || e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    e.stopPropagation()
    // 选中由 pane 的 onMouseDownCapture 统一处理
    const { frameId, nodeId, nodeX, nodeY, scale } = canvasRect
    const sx = e.clientX
    const sy = e.clientY
    const drop = makeSubframeDrop(frameId, nodeId)
    const onMove = (ev: MouseEvent): void => {
      drop.track(ev.clientX, ev.clientY) // 悬停子 Frame 1s → 移入
      if (drop.done) return
      moveNode(frameId, nodeId, nodeX + (ev.clientX - sx) / scale, nodeY + (ev.clientY - sy) / scale)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      drop.end()
      if (!drop.done) settleNode(frameId, nodeId)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 画布模式下拖右下角 → 调节节点尺寸（终端会经 ResizeObserver 自动 fit 重算行列）
  const onCanvasResize = (e: React.MouseEvent): void => {
    if (!canvasRect || canvasRect.board || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const { frameId, nodeId, w, h, scale } = canvasRect
    const sx = e.clientX
    const sy = e.clientY
    const onMove = (ev: MouseEvent): void =>
      resizeNode(frameId, nodeId, w + (ev.clientX - sx) / scale, h + (ev.clientY - sy) / scale)
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      settleResize(frameId, nodeId) // 松手让位，见 canvas/layout.ts 的 pushDownOverlaps
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={paneRef}
      className={`pane${isActive ? ' active' : ''}${selected ? ' sel' : ''}`}
      data-leaf-id={leaf.id}
      style={paneStyle}
      onMouseDown={canvasRect ? undefined : () => setActiveLeaf(tabId, leaf.id)}
      // 画布：点终端任意部分即选中该模块（捕获阶段，不 preventDefault 故仍可在终端里输入/选字）
      onMouseDownCapture={
        canvasRect && selKey
          ? (e) => {
              if (!(e.target as HTMLElement).closest('button, input'))
                toggleCanvasSel(selKey, e.shiftKey)
            }
          : undefined
      }
    >
      {/* 看板里卡片自己有头（项目名 + 状态点 + 终端下拉），终端再来一个头就是重复，
          而卡片本来就矮，省下这 28px 全给终端内容 */}
      <div
        className="pane-header"
        hidden={!!canvasRect?.board}
        style={
          canvasRect
            ? // 改真缩放之后**不再需要 zoom 补偿**：面板本身按 1:1 布局、整体 transform 缩放，
              // 头部跟着一起缩就对了。留着 `zoom: effScale` 会缩两次（外层 transform 一次、
              // 这里再一次），节点越小头部越扁
              { cursor: 'move' }
            : undefined
        }
        onMouseDown={canvasRect ? onCanvasHeadDown : undefined}
      >
        <PaneKindSelect
          kind={pane.kind}
          canvasMode={!!canvasRect}
          onChange={(k) => void setPaneKind(tabId, leaf.id, k)}
        />
        {canvasRect &&
          (editingName ? (
            <input
              className="pane-node-rename"
              defaultValue={canvasRect.name ?? ''}
              autoFocus
              placeholder="命名此模块"
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                renameNode(canvasRect.frameId, canvasRect.nodeId, e.target.value.trim())
                setEditingName(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditingName(false)
              }}
            />
          ) : (
            <span
              className="pane-node-name"
              data-tip="双击重命名"
              onDoubleClick={() => setEditingName(true)}
            >
              {canvasRect.name || '未命名'}
            </span>
          ))}
        {fileName && (
          <span className="pane-file" data-tip={hasFile ? (pane.filePath ?? '') : ''}>
            {fileName}
          </span>
        )}
        <span className="pane-spacer" />
        {pane.kind === 'terminal' && (
          <button
            className="icon-btn"
            data-tip="Claude Code 对话导航"
            onClick={() => openChat(tabCwd)}
          >
            <MessageIcon />
          </button>
        )}
        {canvasRect && (
          <button
            className="icon-btn"
            data-tip={isMax ? '还原到画布（Esc）' : '最大化沉浸'}
            onClick={() =>
              setMaximizedNode(
                isMax ? null : { frameId: canvasRect.frameId, nodeId: canvasRect.nodeId }
              )
            }
          >
            {isMax ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
        )}
        {/* 分屏只在分屏模式给：画布模式的节点是自由摆放的，没有「向右/向下切一半」这回事，
            按钮点了也无处生效——摆着就是误导 */}
        {!canvasRect && (
          <>
            <button
              className="icon-btn"
              data-tip="向右分屏（⌘D）"
              onClick={() => void splitLeaf(tabId, leaf.id, 'row')}
            >
              <SplitHIcon />
            </button>
            <button
              className="icon-btn"
              data-tip="向下分屏（⌘⇧D）"
              onClick={() => void splitLeaf(tabId, leaf.id, 'column')}
            >
              <SplitVIcon />
            </button>
          </>
        )}
        <button
          className="icon-btn"
          data-tip="关闭面板（⌘W）"
          onClick={() => closeLeaf(tabId, leaf.id)}
        >
          <CloseIcon />
        </button>
      </div>
      {/* 终端的命令按钮条。**画布和分屏都要有。**
          用户 2026-09-03 明确要求：「下面那行要留。」

          ⚠️ 这里原来的条件是 `!canvasRect`（只在分屏渲染），因为画布那侧
          由 `CanvasAgentBar` 的第二行内嵌一份。**2026-09-03 那条控制条下线之后，
          画布上的这一份也跟着没了** —— 那是拆除时最容易漏的一处：
          用户要拆的是上面那排胶囊（选 CLI / 模型 / 角色 / 启动），
          而这排是往终端里塞常用命令的快捷键，**跟 AI 对话入口无关，纯终端也用得上**。
          去掉条件之后两种视图各渲染一份，不再依赖那条已经不存在的控制条。

          AgentCmdBar 自己按 `ptyAgent[ptyId]`（主进程探出来的真实进程名）
          决定显不显示，认不出就返回 null —— 所以无条件挂着是安全的。 */}
      {pane.kind === 'terminal' && <AgentCmdBar ptyId={pane.ptyId} />}
      {/* ── Agent 控制台控制条已下线（2026-09-03）────────────────────────────
          用户：「终端里面的 top bar 上面的内容选项等取消，终端就是纯粹的终端。
          所有的 AI 对话由 AI 对话模块来单方面承接。」

          它原来在这儿渲染 `<CanvasAgentBar>`（角色/模型/思考三枚胶囊 + ▶ 启动）。
          取代它的是**空造梦空间上那三颗按钮**（`canvas/FrameStart.tsx`）——
          那也是 2026-08-27 那条「一个 CLI 都没装时也照常显示」要解决的问题
          （新用户什么都看不到）现在的去处。

          **组件文件保留在仓库里**，见 `CanvasAgentBar.tsx` 文件头的说明。

          ⚠️ **终端里手敲 `claude` 的一切照常** —— 状态机、甘特采集、审批解析、
          终端待办、密钥徽章、MCP 桥全由终端 I/O 驱动，与这条控制条零引用关系
          （改动前 grep 实证）。这里拆掉的只是 UI 入口。 */}
      <div className="pane-body">
        {pane.kind === 'terminal' && (
          <TerminalView
            key={pane.ptyId}
            tabId={tabId}
            leafId={leaf.id}
            ptyId={pane.ptyId}
            isActive={isActive}
            // **恒为 1**：真缩放之后终端在自己的坐标系里始终 1:1 排版，
            // 视觉缩放由 pane 的 transform 承担。传 committedScale 会让它
            // 再缩一次字号 —— 那是「裁剪」那条路的做法，两条叠加就是缩两次
            canvasScale={1}
          />
        )}
        {pane.kind === 'code' &&
          (pane.diff ? (
            <DiffView cwd={pane.diff.cwd} relPath={pane.diff.relPath} mode={pane.diff.mode} />
          ) : (
            <CodeView filePath={pane.filePath} />
          ))}
        {pane.kind === 'image' && <ImageView filePath={pane.filePath} cwd={tabCwd} />}
        {pane.kind === 'history' && <HistoryView cwd={pane.cwd} />}
        {pane.kind === 'chat' && <ChatNavView cwd={pane.cwd} />}
        {pane.kind === 'agent' && (
          <AgentChatView cwd={pane.cwd} tabId={tabId} leafId={leaf.id} />
        )}
        {pane.kind === 'wiki' && (
          <Suspense fallback={<div className="pane-placeholder">加载知识库…</div>}>
            <WikiView />
          </Suspense>
        )}
        {pane.kind === 'dict' && (
          <Suspense fallback={<div className="pane-placeholder">加载辞典…</div>}>
            <DictView />
          </Suspense>
        )}
        {pane.kind === 'web' && (
          <WebView url={pane.url} frameId={canvasRect?.frameId} nodeId={canvasRect?.nodeId} />
        )}
      </div>
      {canvasRect && <div className="pane-rz" onMouseDown={onCanvasResize} />}
    </div>
  )
}
