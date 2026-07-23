// 画布模式右侧资源抽屉：项目列表 + 文件树。整体可收起、分区可折叠。
// 拖项目 → 落画布生成 Frame（已在画布则聚焦）；双击项目 → 新开终端。
// 文件树复用 FileTree（拖文件入画布在下一步接入）。

import { useState } from 'react'
import { useStore } from '../../store'
import type { Project } from '../../../../shared/types'
import { collectLeaves } from '../../layout'
import type { PaneState } from '../../layout'
import { FileTree } from '../files/FileTree'
import { CANVAS_COMPONENTS } from './components/registry'
import type { CanvasComponentDef } from './components/registry'
import { PlusIcon, ChevronRightIcon, ChevronLeftIcon } from '../../ui/Icons'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'])

function paneForFile(path: string): PaneState {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'html' || ext === 'htm') return { kind: 'web', url: 'file://' + path }
  // 图片 / 动图(gif,webp) / 视频 都归 image 型媒体节点，由 CanvasFileNode 按扩展名分流渲染
  if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) return { kind: 'image', filePath: path }
  return { kind: 'code', filePath: path }
}

function shellQuote(p: string): string {
  return /[^\w@%+=:,./-]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
}

export function CanvasDrawer(): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [projOpen, setProjOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(true)
  const [compOpen, setCompOpen] = useState(true)
  const [projH, setProjH] = useState(180)
  const [compH, setCompH] = useState(110)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const openTerminal = useStore((s) => s.openTerminal)
  const addProject = useStore((s) => s.addProject)
  const addProjectFrame = useStore((s) => s.addProjectFrame)
  const addFileNode = useStore((s) => s.addFileNode)
  const addSubFrame = useStore((s) => s.addSubFrame)
  const addComponentNode = useStore((s) => s.addComponentNode)
  const setViewport = useStore((s) => s.setViewport)
  const frames = useStore((s) => s.canvas.frames)
  const tabs = useStore((s) => s.tabs)
  const attentionPtys = useStore((s) => s.attentionPtys)
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
        // 点击项目：激活 + 把画布聚焦到该项目的 Frame
        setActiveProject(project.id)
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
      const under = document.elementFromPoint(ev.clientX, ev.clientY)
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
      const under = document.elementFromPoint(ev.clientX, ev.clientY)
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
          addFileNode(frameId, paneForFile(path), wx - frame.x - 90, wy - frame.y - 15)
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
      const under = document.elementFromPoint(ev.clientX, ev.clientY)
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
      // 坐标交给 placeNodeInFrame 自动堆叠（Frame 会扩大到合适位置）
      addComponentNode(frame.id, comp.id, 0, 0, comp.defaultSize.w, comp.defaultSize.h)
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

  if (collapsed) {
    return (
      <button className="drawer-expand" data-tip="展开资源" onClick={() => setCollapsed(false)}>
        <ChevronLeftIcon size={16} />
      </button>
    )
  }

  return (
    <aside className="canvas-drawer">
      <div className="cd-head">
        <span className="cd-drawer-title">资源</span>
        <button className="cd-collapse" data-tip="收起抽屉" onClick={() => setCollapsed(true)}>
          <ChevronRightIcon size={15} />
        </button>
      </div>
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
                  <div
                    key={p.id}
                    className={`cd-proj${p.id === activeProjectId ? ' active' : ''}${projectHasAttention(p.id) ? ' breathing' : ''}${projectFrameSelected(p.id) ? ' framesel' : ''}`}
                    data-tip={p.path}
                    onMouseDown={(e) => startProjectDrag(p, e)}
                    onDoubleClick={() => void openTerminal({ projectId: p.id })}
                  >
                    <span className="cd-proj-dot" />
                    <span className="cd-proj-name">{p.name}</span>
                    {projectHasAttention(p.id) ? (
                      <span className="cd-proj-badge attn">待处理</span>
                    ) : onCanvas ? (
                      <span className="cd-proj-badge">画布中</span>
                    ) : null}
                  </div>
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
          </div>
          {filesOpen && activeProject && (
            <div
              className="cd-files"
              onMouseDown={(e) => {
                const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
                if (!item) return
                const path = item.dataset.path
                if (!path) return
                if (item.dataset.dir) startFolderDrag(path, e)
                else startFileDrag(path, e)
              }}
            >
              <FileTree key={activeProject.id} rootPath={activeProject.path} refreshKey={0} />
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
  )
}
