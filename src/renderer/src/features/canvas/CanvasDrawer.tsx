// 画布模式右侧资源抽屉：项目列表 + 文件树。整体可收起、分区可折叠。
// 拖项目 → 落画布生成 Frame（已在画布则聚焦）；双击项目 → 新开终端。
// 文件树复用 FileTree（拖文件入画布在下一步接入）。

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { Project } from '../../../../shared/types'
import { collectLeaves } from '../../layout'
import type { PaneState } from '../../layout'
import { FileTree } from '../files/FileTree'
import { paneForFile, isHtmlPath } from './media'
import { CANVAS_COMPONENTS } from './components/registry'
import type { CanvasComponentDef } from './components/registry'
import { PlusIcon, ChevronRightIcon, FilePlusIcon, FolderPlusIcon } from '../../ui/Icons'
import { HtmlOpenChoice } from './HtmlOpenChoice'
import { SwipeRow } from '../../ui/SwipeRow'
import { CanvasContextMenu } from './CanvasContextMenu'
import { projectMenuItems } from '../workspace/projectMenu'
import { liveMaximizedNode } from '../../store/canvas/selectors'
import { shellQuote } from './shellQuote'
import { elementUnderPoint } from './hitTest'

export function CanvasDrawer(): JSX.Element {
  // 有节点最大化时让位：那是沉浸式阅读/工作，把手压在内容上很碍事
  const maximizedNode = useStore(liveMaximizedNode)
  // 开合状态放 store 而不是本地 state：右下角的基本操作条 / 缩放条在 CanvasStage 里，
  // 和抽屉是兄弟不是父子，拿不到本地 state；靠根节点 class 通知它们让位最省事
  const open = useStore((s) => s.resDrawerOpen)
  const setOpen = useStore((s) => s.setResDrawerOpen)
  const [edgeHover, setEdgeHover] = useState(false)
  /** 项目行右键菜单的落点 */
  const [projMenu, setProjMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [projOpen, setProjOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(true)
  /** 头部两个新建按钮 → 文件树。nonce 变一次触发一次；
   *  用计数器而不是 ref，是和 FileTree 已有的 refreshKey 同一种模式 */
  const [createReq, setCreateReq] = useState<{ kind: 'file' | 'dir'; nonce: number } | undefined>()
  /** 拖 .html 进画布时的「渲染还是源码」选择。place 把落点信息包起来，
   *  等用户选完再真正建节点 —— 那会儿 Frame 可能已经 reflow 过，所以里面要重新取 */
  const [htmlPick, setHtmlPick] = useState<{
    x: number
    y: number
    path: string
    place: (pane: PaneState) => void
  } | null>(null)
  const [compOpen, setCompOpen] = useState(true)
  const [projH, setProjH] = useState(180)
  const [compH, setCompH] = useState(110)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const openTerminal = useStore((s) => s.openTerminal)
  const addProject = useStore((s) => s.addProject)
  const removeProject = useStore((s) => s.removeProject)
  const addProjectFrame = useStore((s) => s.addProjectFrame)
  const addFileNode = useStore((s) => s.addFileNode)
  const addSubFrame = useStore((s) => s.addSubFrame)
  const addComponentNode = useStore((s) => s.addComponentNode)
  const setViewport = useStore((s) => s.setViewport)
  const frames = useStore((s) => s.canvas.frames)
  const tabs = useStore((s) => s.tabs)
  const attentionPtys = useStore((s) => s.attentionPtys)
  const clearAttention = useStore((s) => s.clearAttention)
  const canvasSel = useStore((s) => s.canvasSel)
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  // 该项目的 Frame 是否被选中（画布里点选 Frame → 抽屉对应项高亮）
  const projectFrameSelected = (pid: string): boolean =>
    frames.some((f) => f.projectId === pid && canvasSel.includes('f:' + f.id))

  // 该项目是否有终端「需处理」（响铃未查看）——用于条目呼吸高亮
  const projectHasAttention = (pid: string): boolean =>
    attentionPtys.length > 0 &&
    tabs.some(
      (t) =>
        t.projectId === pid &&
        collectLeaves(t.root).some(
          (l) => l.pane.kind === 'terminal' && attentionPtys.includes(l.pane.ptyId)
        )
    )

  // 待处理项目数（收起时右上角气泡显示）
  const attentionCount = projects.filter((p) => projectHasAttention(p.id)).length

  // 抽屉打开时：在抽屉以外任何地方点击 → 收起（延后一拍挂载，避开"开抽屉那一下"）
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      // 右键菜单和确认弹窗都是 portal 到 body 的，DOM 上不在抽屉内部但**逻辑上是抽屉的一部分**。
      // 不放过它们的话：在抽屉里右键文件点「重命名」，抽屉当场收起、重命名框跟着滑出屏幕，
      // 这个功能等于不存在。
      if (t.closest?.('.canvas-ctxmenu') || t.closest?.('.context-menu') || t.closest?.('.confirm-overlay')) return
      if (!t.closest?.('.canvas-drawer')) setOpen(false)
    }
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown, true), 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [open])

  // 收起态右缘触发器：鼠标越靠右边缘，左箭头越向左「探出」跟手（橡皮筋趋势）；离开时回弹
  const edgeArrowRef = useRef<HTMLSpanElement>(null)
  const onEdgeMove = (e: React.MouseEvent): void => {
    const el = edgeArrowRef.current
    if (!el) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const t = Math.max(0, Math.min(1, 1 - (r.right - e.clientX) / r.width))
    el.style.transition = 'transform 0.1s ease-out, opacity 0.22s ease'
    el.style.transform = `translateX(${(-9 * t).toFixed(2)}px)`
  }
  const resetEdgeArrow = (): void => {
    const el = edgeArrowRef.current
    if (!el) return
    el.style.transition = 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease'
    el.style.transform = ''
  }

  const focusFrame = (frameId: string): void => {
    const f = useStore.getState().canvas.frames.find((x) => x.id === frameId)
    const vpEl = document.querySelector('.canvas-viewport')
    if (!f || !vpEl) return
    const scale = useStore.getState().canvas.viewport.scale
    setViewport({
      x: vpEl.clientWidth / 2 - (f.x + f.w / 2) * scale,
      y: vpEl.clientHeight / 2 - (f.y + f.h / 2) * scale
    })
  }

  // 拖项目：移动超过阈值算拖拽，落画布内生成/聚焦 Frame；未移动算点击（激活项目）
  const startProjectDrag = (project: Project, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY, started: false }
    let ghost: HTMLDivElement | null = null
    const onMove = (ev: MouseEvent): void => {
      if (!start.started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
        start.started = true
        ghost = document.createElement('div')
        ghost.className = 'canvas-drag-ghost'
        ghost.textContent = project.name
        document.body.appendChild(ghost)
        document.querySelector('.canvas-viewport')?.classList.add('drop-active')
      }
      if (ghost) {
        ghost.style.left = ev.clientX + 12 + 'px'
        ghost.style.top = ev.clientY + 10 + 'px'
      }
    }
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      ghost?.remove()
      const vpEl = document.querySelector('.canvas-viewport')
      vpEl?.classList.remove('drop-active')
      if (!start.started) {
        // 点击项目：激活 + 聚焦该项目 Frame + 消除该项目终端的「需处理」呼吸（点一次即知晓）
        setActiveProject(project.id)
        tabs
          .filter((t) => t.projectId === project.id)
          .forEach((t) =>
            collectLeaves(t.root).forEach((l) => {
              if (l.pane.kind === 'terminal') clearAttention(l.pane.ptyId)
            })
          )
        const frame = useStore.getState().canvas.frames.find((f) => f.projectId === project.id)
        if (frame) focusFrame(frame.id)
        return
      }
      if (!vpEl) return
      const r = vpEl.getBoundingClientRect()
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom)
        return
      const existing = useStore.getState().canvas.frames.find((f) => f.projectId === project.id)
      if (existing) {
        focusFrame(existing.id)
        return
      }
      const vp = useStore.getState().canvas.viewport
      const wx = (ev.clientX - r.left - vp.x) / vp.scale
      const wy = (ev.clientY - r.top - vp.y) / vp.scale
      void addProjectFrame(project.id, wx - 60, wy - 17)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 拖文件夹 → 落到某 Frame（或落终端节点回溯其 Frame）→ 在其内新增一个空的子 Frame（嵌套）
  const startFolderDrag = (path: string, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY, started: false }
    let ghost: HTMLDivElement | null = null
    const name = path.split('/').pop() ?? path
    const clearDrop = (): void =>
      document.querySelectorAll('.cframe.drop-target').forEach((el) => el.classList.remove('drop-target'))
    const targetUnder = (ev: MouseEvent): Element | null => {
      if (ghost) ghost.style.display = 'none'
      // 不用 elementFromPoint：标记层盖在终端 / Frame 之上，会把落点全接走（见 hitTest.ts）
      const under = elementUnderPoint(ev.clientX, ev.clientY)
      if (ghost) ghost.style.display = ''
      return under
    }
    const onMove = (ev: MouseEvent): void => {
      if (!start.started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
        start.started = true
        ghost = document.createElement('div')
        ghost.className = 'canvas-drag-ghost'
        ghost.textContent = '📁 ' + name
        document.body.appendChild(ghost)
      }
      if (ghost) {
        ghost.style.left = ev.clientX + 12 + 'px'
        ghost.style.top = ev.clientY + 10 + 'px'
      }
      clearDrop()
      const cframe = targetUnder(ev)?.closest('.cframe')
      if (cframe) cframe.classList.add('drop-target')
    }
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const under = start.started ? targetUnder(ev) : null
      ghost?.remove()
      clearDrop()
      if (!start.started || !under) return
      const frames = useStore.getState().canvas.frames
      let frameId = (under.closest('.cframe') as HTMLElement | null)?.dataset.fid
      if (!frameId) {
        const lid = (under.closest('.pane[data-leaf-id]') as HTMLElement | null)?.dataset.leafId
        if (lid) frameId = frames.find((f) => f.nodes.some((n) => n.leafId === lid))?.id
      }
      if (!frameId) return
      addSubFrame(frameId, path, name)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 拖文件：落终端节点 → 插路径；落 Frame → 新增文件预览节点（.html → web）
  const startFileDrag = (path: string, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY, started: false }
    let ghost: HTMLDivElement | null = null
    const name = path.split('/').pop() ?? path
    const clearDrop = (): void =>
      document
        .querySelectorAll('.cframe.drop-target, .pane.drop-target')
        .forEach((el) => el.classList.remove('drop-target'))
    const targetUnder = (ev: MouseEvent): Element | null => {
      if (ghost) ghost.style.display = 'none'
      // 不用 elementFromPoint：标记层盖在终端 / Frame 之上，会把落点全接走（见 hitTest.ts）
      const under = elementUnderPoint(ev.clientX, ev.clientY)
      if (ghost) ghost.style.display = ''
      return under
    }
    const onMove = (ev: MouseEvent): void => {
      if (!start.started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
        start.started = true
        ghost = document.createElement('div')
        ghost.className = 'canvas-drag-ghost'
        ghost.textContent = name
        document.body.appendChild(ghost)
      }
      if (ghost) {
        ghost.style.left = ev.clientX + 12 + 'px'
        ghost.style.top = ev.clientY + 10 + 'px'
      }
      clearDrop()
      const under = targetUnder(ev)
      const termPane = under?.closest('.pane[data-leaf-id]')
      const cframe = under?.closest('.cframe')
      if (termPane) termPane.classList.add('drop-target')
      else if (cframe) cframe.classList.add('drop-target')
    }
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const under = start.started ? targetUnder(ev) : null
      ghost?.remove()
      clearDrop()
      if (!start.started || !under) return
      const termPane = under.closest('.pane[data-leaf-id]') as HTMLElement | null
      if (termPane?.dataset.leafId) {
        const leaf = useStore
          .getState()
          .tabs.flatMap((t) => collectLeaves(t.root))
          .find((l) => l.id === termPane.dataset.leafId)
        if (leaf?.pane.kind === 'terminal')
          window.api.pty.write(leaf.pane.ptyId, shellQuote(path) + ' ')
        return
      }
      const cframe = under.closest('.cframe') as HTMLElement | null
      if (cframe?.dataset.fid) {
        const frameId = cframe.dataset.fid
        const vpEl = document.querySelector('.canvas-viewport')
        const frame = useStore.getState().canvas.frames.find((f) => f.id === frameId)
        if (vpEl && frame) {
          const r = vpEl.getBoundingClientRect()
          const vp = useStore.getState().canvas.viewport
          const wx = (ev.clientX - r.left - vp.x) / vp.scale
          const wy = (ev.clientY - r.top - vp.y) / vp.scale
          // .html 两种看法都合理（渲染 / 源码），不替用户定 —— 在落点弹一下让他选。
          // 选完再落节点，所以 frameId 和坐标要先存下来
          if (isHtmlPath(path)) {
            setHtmlPick({
              x: ev.clientX,
              y: ev.clientY,
              path,
              place: (pane) => addFileNode(frameId, pane, wx - frame.x - 90, wy - frame.y - 15)
            })
          } else {
            addFileNode(frameId, paneForFile(path), wx - frame.x - 90, wy - frame.y - 15)
          }
        }
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 拖组件：落 Frame → 新增组件节点（needsProject 组件要求 Frame 绑定了项目）
  const startComponentDrag = (comp: CanvasComponentDef, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY, started: false }
    let ghost: HTMLDivElement | null = null
    const clearDrop = (): void =>
      document.querySelectorAll('.cframe.drop-target').forEach((el) => el.classList.remove('drop-target'))
    const targetUnder = (ev: MouseEvent): Element | null => {
      if (ghost) ghost.style.display = 'none'
      // 不用 elementFromPoint：标记层盖在终端 / Frame 之上，会把落点全接走（见 hitTest.ts）
      const under = elementUnderPoint(ev.clientX, ev.clientY)
      if (ghost) ghost.style.display = ''
      return under
    }
    const onMove = (ev: MouseEvent): void => {
      if (!start.started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
        start.started = true
        ghost = document.createElement('div')
        ghost.className = 'canvas-drag-ghost'
        ghost.textContent = comp.name
        document.body.appendChild(ghost)
      }
      if (ghost) {
        ghost.style.left = ev.clientX + 12 + 'px'
        ghost.style.top = ev.clientY + 10 + 'px'
      }
      clearDrop()
      const cframe = targetUnder(ev)?.closest('.cframe')
      if (cframe) cframe.classList.add('drop-target')
    }
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const under = start.started ? targetUnder(ev) : null
      ghost?.remove()
      clearDrop()
      if (!start.started || !under) return
      // 落点认 Frame，或落在终端节点上时回溯它所属的 Frame（Frame 被终端占满时也能接住）
      const frames = useStore.getState().canvas.frames
      let frameId = (under.closest('.cframe') as HTMLElement | null)?.dataset.fid
      if (!frameId) {
        const lid = (under.closest('.pane[data-leaf-id]') as HTMLElement | null)?.dataset.leafId
        if (lid) frameId = frames.find((f) => f.nodes.some((n) => n.leafId === lid))?.id
      }
      const frame = frames.find((f) => f.id === frameId)
      if (!frame) return
      if (comp.needsProject && !frame.projectId) return
      // 插到离松手鼠标点最近的空位（换算成相对 Frame 的落点，以组件中心对齐光标）
      const vpEl = document.querySelector('.canvas-viewport')
      const r = vpEl?.getBoundingClientRect()
      const vp = useStore.getState().canvas.viewport
      let px = 0
      let py = 0
      if (r) {
        const wx = (ev.clientX - r.left - vp.x) / vp.scale
        const wy = (ev.clientY - r.top - vp.y) / vp.scale
        px = wx - frame.x - comp.defaultSize.w / 2
        py = wy - frame.y - 14
      }
      addComponentNode(frame.id, comp.id, px, py, comp.defaultSize.w, comp.defaultSize.h)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 分区之间的分隔线：拖动调整项目区 / 组件区高度（文件区自适应剩余空间）
  const startResize = (which: 'proj' | 'comp', e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const start0 = which === 'proj' ? projH : compH
    const onMove = (ev: MouseEvent): void => {
      const dy = ev.clientY - startY
      if (which === 'proj') setProjH(Math.max(60, start0 + dy))
      else setCompH(Math.max(48, start0 - dy))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (maximizedNode) return <></>
  return (
    <>
      {/* 收起态：右缘悬停感应区（辉光 + 中部左箭头）+ 右上角待处理气泡 */}
      {!open && (
        <>
          <div className={`cd-edge${edgeHover ? ' hot' : ''}`}>
            <span
              className="cd-edge-guide"
              ref={edgeArrowRef}
              data-tip="展开资源抽屉"
              onMouseEnter={() => setEdgeHover(true)}
              onMouseMove={onEdgeMove}
              onMouseLeave={() => {
                setEdgeHover(false)
                resetEdgeArrow()
              }}
              onClick={() => {
                setEdgeHover(false)
                setOpen(true)
              }}
            >
              <span className="cd-edge-label">文件信息</span>
            </span>
          </div>
          {attentionCount > 0 && (
            <button
              className="cd-attn-bubble"
              data-tip="有待处理内容，点击展开"
              onClick={() => setOpen(true)}
            >
              {attentionCount}
            </button>
          )}
        </>
      )}
      <aside className={`canvas-drawer${open ? ' open' : ' closed'}`}>
        <div className="cd-scroll">
        <section className="cd-section" style={projOpen ? { height: projH, flex: 'none' } : undefined}>
          <div className="cd-sec-head" onClick={() => setProjOpen((v) => !v)}>
            <span className={`cd-chev${projOpen ? ' open' : ''}`}>
              <ChevronRightIcon size={12} />
            </span>
            <span className="cd-sec-title">项目</span>
            <button
              className="cd-add"
              data-tip="添加项目文件夹"
              onClick={(e) => {
                e.stopPropagation()
                void addProject()
              }}
            >
              <PlusIcon size={12} />
            </button>
          </div>
          {projOpen && (
            <div className="cd-sec-body">
              {projects.map((p) => {
                const onCanvas = frames.some((f) => f.projectId === p.id)
                return (
                  // pointer={false}：这里左键拖拽是「拖到画布建 Frame」，方向也往左，
                  // 两个手势抢同一个输入必然打架。这行只留触控板横滑 + 右键
                  <SwipeRow
                    key={p.id}
                    onRemove={() => void removeProject(p.id)}
                    className={`cd-proj${p.id === activeProjectId ? ' active' : ''}${projectHasAttention(p.id) ? ' breathing' : ''}${projectFrameSelected(p.id) ? ' framesel' : ''}`}
                    data-tip={p.path}
                    onMouseDown={(e) => startProjectDrag(p, e)}
                    onDoubleClick={() => void openTerminal({ projectId: p.id })}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setProjMenu({ x: e.clientX, y: e.clientY, id: p.id })
                    }}
                  >
                    <span className="cd-proj-dot" />
                    <span className="cd-proj-name">{p.name}</span>
                    {projectHasAttention(p.id) ? (
                      <span className="cd-proj-badge attn">待处理</span>
                    ) : onCanvas ? (
                      <span className="cd-proj-badge">画布中</span>
                    ) : null}
                  </SwipeRow>
                )
              })}
            </div>
          )}
        </section>
        {projOpen && <div className="cd-resizer" onMouseDown={(e) => startResize('proj', e)} />}
        <section className="cd-section cd-section-grow">
          <div className="cd-sec-head" onClick={() => setFilesOpen((v) => !v)}>
            <span className={`cd-chev${filesOpen ? ' open' : ''}`}>
              <ChevronRightIcon size={12} />
            </span>
            <span className="cd-sec-title">文件</span>
            {/* 新建入口按 IDE 惯例摆在这一节的右上角：两个图标各自说清建的是什么，
                不用先点开一个菜单再选一次。
                stopPropagation 是必须的 —— 整个 cd-sec-head 挂着「折叠/展开本节」的 onClick，
                不拦住的话点新建会顺手把这一节收起来，输入框刚出现就没了。 */}
            {activeProject && (
              <span className="cd-sec-acts">
                <button
                  className="cd-sec-act"
                  data-tip="新建文件"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFilesOpen(true)
                    setCreateReq((p) => ({ kind: 'file', nonce: (p?.nonce ?? 0) + 1 }))
                  }}
                >
                  <FilePlusIcon size={13} />
                </button>
                <button
                  className="cd-sec-act"
                  data-tip="新建文件夹"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFilesOpen(true)
                    setCreateReq((p) => ({ kind: 'dir', nonce: (p?.nonce ?? 0) + 1 }))
                  }}
                >
                  <FolderPlusIcon size={13} />
                </button>
              </span>
            )}
          </div>
          {filesOpen && !activeProject && (
            <div className="cd-empty">在画布上点一个 Frame 或终端，这里显示它的文件</div>
          )}
          {filesOpen && activeProject && (
            <div
              className="cd-files"
              onMouseDown={(e) => {
                // 落在文件树的内联输入框上（重命名/新建）→ 让给输入框。
                // 不跳过的话：closest('.tree-item') 会命中它的父行，于是这里 preventDefault()
                // 掉 mousedown，输入框里就既定位不了光标也划不了选
                if ((e.target as HTMLElement).closest('input')) return
                const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
                if (!item) return
                const path = item.dataset.path
                if (!path) return
                if (item.dataset.dir) startFolderDrag(path, e)
                else startFileDrag(path, e)
              }}
            >
              <FileTree
                key={activeProject.id}
                rootPath={activeProject.path}
                refreshKey={0}
                createRequest={createReq}
              />
            </div>
          )}
        </section>
        {compOpen && <div className="cd-resizer" onMouseDown={(e) => startResize('comp', e)} />}
        <section className="cd-section" style={compOpen ? { height: compH, flex: 'none' } : undefined}>
          <div className="cd-sec-head" onClick={() => setCompOpen((v) => !v)}>
            <span className={`cd-chev${compOpen ? ' open' : ''}`}>
              <ChevronRightIcon size={12} />
            </span>
            <span className="cd-sec-title">组件</span>
          </div>
          {compOpen && (
            <div className="cd-sec-body">
              {CANVAS_COMPONENTS.map((c) => (
                <div
                  key={c.id}
                  className="cd-comp"
                  data-tip={c.description ?? c.name}
                  onMouseDown={(e) => startComponentDrag(c, e)}
                >
                  <c.Icon size={13} />
                  <span className="cd-comp-name">{c.name}</span>
                  <span className="cd-comp-hint">拖入画布</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
    {projMenu && (
      <CanvasContextMenu
        x={projMenu.x}
        y={projMenu.y}
        items={projectMenuItems(projMenu.id)}
        onClose={() => setProjMenu(null)}
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
    </>
  )
}
