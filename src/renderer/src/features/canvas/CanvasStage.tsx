// 画布装饰层：viewport（点阵背景 + 平移缩放捕获）→ world（transform 变换）→ Frame 卡片。
// 这一层只画「死内容」（Frame 边框/标题/点阵/缩放条），可随意位图缩放。
// 活终端由 PaneLayer 渲染、浮在此层之上按同一视口变换对齐（实现规划 §5-A 双层渲染）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { CanvasFrame, CanvasShape } from '../../store'
import { PlusIcon, MinusIcon, TerminalIcon, CopyIcon, GlobeIcon, TidyIcon } from '../../ui/Icons'
import { CanvasFileNode } from './CanvasFileNode'
import { CanvasMiniMap } from './CanvasMiniMap'
import { CanvasRunMonitor } from './CanvasRunMonitor'
import { CanvasComponentNode } from './CanvasComponentNode'
import { CanvasContextMenu, type CanvasMenuItem } from './CanvasContextMenu'
import { CanvasFilePicker } from './CanvasFilePicker'
import { paneForFile } from './media'
import { collectLeaves } from '../../layout'
import './canvas.css'

const SCALE_MIN = 0.2
const SCALE_MAX = 2.2
const HEAD_H = 34
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

export function CanvasStage(): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frames = useStore((s) => s.canvas.frames)
  const vp = useStore((s) => s.canvas.viewport)
  const setViewport = useStore((s) => s.setViewport)
  const moveFrame = useStore((s) => s.moveFrame)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const projects = useStore((s) => s.projects)
  const addTerminalNode = useStore((s) => s.addTerminalNode)
  const addBrowserNode = useStore((s) => s.addBrowserNode)
  const tidyFrame = useStore((s) => s.tidyFrame)
  const shapes = useStore((s) => s.canvas.shapes)
  const addShape = useStore((s) => s.addShape)
  const updateShape = useStore((s) => s.updateShape)
  const [tool, setTool] = useState<'select' | 'rect' | 'arrow' | 'sticky'>('select')
  const [draft, setDraft] = useState<Omit<CanvasShape, 'id'> | null>(null)
  const [editingSticky, setEditingSticky] = useState<string | null>(null)
  const [editingFrame, setEditingFrame] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: CanvasMenuItem[] } | null>(null)
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
  const addProject = useStore((s) => s.addProject)
  const addProjectFrame = useStore((s) => s.addProjectFrame)
  const addFileNode = useStore((s) => s.addFileNode)
  const renameFrame = useStore((s) => s.renameFrame)
  // 选中集合提到 store（含浮层终端节点）：这里派生成 Set 供读取，写用 store action
  const canvasSel = useStore((s) => s.canvasSel)
  const setCanvasSel = useStore((s) => s.setCanvasSel)
  const toggleCanvasSel = useStore((s) => s.toggleCanvasSel)
  const clearCanvasSel = useStore((s) => s.clearCanvasSel)
  const sel = useMemo(() => new Set(canvasSel), [canvasSel])
  const clearAttention = useStore((s) => s.clearAttention)
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const spaceHeld = useRef(false)
  // 左侧「基本操作」工具抽屉：收起态左缘 guide，点击滑入；动效/交互镜像右侧资源抽屉
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsHover, setToolsHover] = useState(false)
  const toolsEdgeRef = useRef<HTMLSpanElement>(null)
  // 收起态左缘触发器：鼠标越靠左边缘，guide 越向右「探出」跟手（橡皮筋）；离开回弹
  const onToolsEdgeMove = (e: React.MouseEvent): void => {
    const el = toolsEdgeRef.current
    if (!el) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const t = Math.max(0, Math.min(1, 1 - (e.clientX - r.left) / r.width))
    el.style.transition = 'transform 0.1s ease-out, opacity 0.22s ease'
    el.style.transform = `translateX(${(9 * t).toFixed(2)}px)`
  }
  const resetToolsEdge = (): void => {
    const el = toolsEdgeRef.current
    if (!el) return
    el.style.transition = 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease'
    el.style.transform = ''
  }
  // 抽屉打开时：在工具栏以外点击 → 收起（延后一拍挂载，避开"开抽屉那一下"）
  useEffect(() => {
    if (!toolsOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest?.('.canvas-toolbar')) setToolsOpen(false)
    }
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown, true), 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [toolsOpen])

  // 选中终端节点 / 其所在 Frame → 视为已知晓，清除该终端的「需处理」呼吸标记
  useEffect(() => {
    if (!canvasSel.length) return
    const st = useStore.getState()
    const leaves = st.tabs.flatMap((t) => collectLeaves(t.root))
    const ptyOf = (leafId?: string): string | null => {
      if (!leafId) return null
      const l = leaves.find((x) => x.id === leafId)
      return l?.pane.kind === 'terminal' ? l.pane.ptyId : null
    }
    canvasSel.forEach((key) => {
      if (key[0] === 'n') {
        const [, fid, nid] = key.split(':')
        const n = st.canvas.frames.find((f) => f.id === fid)?.nodes.find((x) => x.id === nid)
        const p = ptyOf(n?.leafId)
        if (p) clearAttention(p)
      } else if (key[0] === 'f') {
        st.canvas.frames
          .find((f) => f.id === key.slice(2))
          ?.nodes.forEach((n) => {
            const p = ptyOf(n.leafId)
            if (p) clearAttention(p)
          })
      }
    })
  }, [canvasSel, clearAttention])

  // 滚轮缩放 / 双指平移（原生监听以便 passive:false 阻止页面滚动）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      // 仅当模块「被选中」时，光标落在其可滚动区（组件/文件预览）才把滚轮交给内容滚动；
      // 未选中则保持画板平移/缩放（避免鼠标经过模块就抢走 pan）。
      const t = e.target as HTMLElement | null
      const body = t?.closest?.('.cfile-body')
      if (body) {
        // 图片宫格是显式打开的浏览视图 → 滚轮始终交给它滚（不要求选中）
        const grid = t?.closest?.('.civ-grid-scroll') as HTMLElement | null
        if (grid && grid.scrollHeight - grid.clientHeight > 1) return
        const nodeEl = t?.closest?.('.cfile-node[data-node-id]') as HTMLElement | null
        const nid = nodeEl?.dataset.nodeId
        const fid = nodeEl?.dataset.frameId
        const isSel = !!nid && !!fid && useStore.getState().canvasSel.includes('n:' + fid + ':' + nid)
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
        const s2 = clamp(cur.scale * (1 - e.deltaY * 0.01), SCALE_MIN, SCALE_MAX)
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

  // 右键菜单：按目标（终端 / 文件·组件节点 / Frame / 图形 / 空白）构造统一 CRUD 菜单
  useEffect(() => {
    const onCtx = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      if (!t.closest('.canvas-viewport') && !t.closest('.pane-layer')) return
      e.preventDefault()
      const st = useStore.getState()
      const paneEl = t.closest('.pane[data-leaf-id]') as HTMLElement | null
      const nodeEl = t.closest('.cfile-node[data-node-id]') as HTMLElement | null
      const shapeEl = t.closest('.cshape[data-sid]') as HTMLElement | null
      const frameEl = t.closest('.cframe') as HTMLElement | null
      let items: CanvasMenuItem[]
      if (paneEl?.dataset.leafId) {
        const leafId = paneEl.dataset.leafId
        let fid = ''
        let nid = ''
        for (const f of st.canvas.frames) {
          const n = f.nodes.find((x) => x.leafId === leafId)
          if (n) {
            fid = f.id
            nid = n.id
            break
          }
        }
        items = [
          {
            label: '关闭终端',
            danger: true,
            onClick: () => {
              if (fid && nid) st.removeNode(fid, nid)
              const tab = st.tabs.find((tb) => collectLeaves(tb.root).some((l) => l.id === leafId))
              if (tab) st.closeLeaf(tab.id, leafId)
            }
          }
        ]
      } else if (nodeEl?.dataset.nodeId && nodeEl.dataset.frameId) {
        const fid = nodeEl.dataset.frameId
        const nid = nodeEl.dataset.nodeId
        const node = st.canvas.frames.find((f) => f.id === fid)?.nodes.find((n) => n.id === nid)
        items = [
          ...(node && !node.leafId
            ? [{ label: '复制', kbd: '⌘D', onClick: () => st.duplicateNode(fid, nid) }]
            : []),
          { label: '删除节点', danger: true, onClick: () => st.removeNode(fid, nid) }
        ]
      } else if (shapeEl?.dataset.sid) {
        const sid = shapeEl.dataset.sid
        const shape = st.canvas.shapes.find((s2) => s2.id === sid)
        items = [
          ...(shape?.type === 'sticky' ? [{ label: '编辑', onClick: () => setEditingSticky(sid) }] : []),
          { label: '删除', danger: true, onClick: () => st.removeShape(sid) }
        ]
      } else if (frameEl?.dataset.fid) {
        const fid = frameEl.dataset.fid
        const frame = st.canvas.frames.find((f) => f.id === fid)
        items = [
          { label: '重命名', onClick: () => setEditingFrame(fid) },
          { label: frame?.collapsed ? '展开' : '折叠', onClick: () => st.toggleCollapse(fid) },
          { label: '删除 Frame', danger: true, onClick: () => st.removeFrame(fid) }
        ]
      } else {
        const r = viewportRef.current?.getBoundingClientRect()
        const cur = st.canvas.viewport
        const wx = r ? (e.clientX - r.left - cur.x) / cur.scale : 0
        const wy = r ? (e.clientY - r.top - cur.y) / cur.scale : 0
        items = [
          {
            label: '新建便签',
            onClick: () => st.addShape({ type: 'sticky', x: wx, y: wy, w: 190, h: 96, text: '双击编辑…' })
          }
        ]
      }
      setMenu({ x: e.clientX, y: e.clientY, items })
    }
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [])

  // Esc：退出「最大化沉浸」，模块回到画布原位
  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (useStore.getState().maximizedNode) {
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
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || !sel.size) return
      // 只认 Delete 删除；Backspace 退回给文字编辑（曾在语音态误删运行中的终端）。
      // 且终端节点(有 leafId)与 Frame 一律不由键盘删——终端只能点右上角关闭(带运行中确认)，杜绝误删丢会话。
      if (e.key === 'Delete') {
        const st = useStore.getState()
        const isTerminalNode = (k: string): boolean => {
          if (k[0] !== 'n') return false
          const [, fid, nid] = k.split(':')
          return !!st.canvas.frames.find((f) => f.id === fid)?.nodes.find((n) => n.id === nid)?.leafId
        }
        const dels = [...sel].filter((k) => k[0] !== 'f' && !isTerminalNode(k))
        if (!dels.length) return
        e.preventDefault()
        dels.forEach((k) => {
          if (k[0] === 's') st.removeShape(k.slice(2))
          else if (k[0] === 'n') {
            const [, fid, nid] = k.split(':')
            st.removeNode(fid, nid)
          }
        })
        clearCanvasSel()
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
          }
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

  // 空格键临时切换为平移手势（空白拖拽默认是框选）+ 抓手光标（.space-pan）
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
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
      const onMove = (ev: MouseEvent): void =>
        setViewport({ x: cur.x + (ev.clientX - clientX), y: cur.y + (ev.clientY - clientY) })
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        el?.classList.remove('panning')
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
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
        '.cfile-node, .pane, .cshape, .cframe-head, .canvas-toolbar, .canvas-zoombar, .canvas-minimap, .crm, .crm-mini, .canvas-drawer, .cd-edge, .ctd-edge'
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
    const items: CanvasMenuItem[] = st.projects.map((p) => {
      const exist = st.canvas.frames.find((f) => f.projectId === p.id)
      return {
        label: p.name,
        hint: exist ? '已在画布' : undefined,
        onClick: () => {
          // 已经在画布上就不重复建，改为把视图挪过去
          if (exist) centerOnFrame(exist)
          else void addProjectFrame(p.id, wx - 60, wy - 17)
        }
      }
    })
    if (items.length) items.push({ label: '', sep: true, onClick: () => {} })
    items.push({ label: '添加项目文件夹…', onClick: () => void addProjectAt(wx, wy) })
    setMenu({ x: e.clientX, y: e.clientY, items })
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
      setCanvasSel([...next])
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setBand(null)
      if (!moved && !shift) clearCanvasSel()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 空白按下：select 模式框选（空格+拖为平移）；图形工具模式绘制
  const onViewportDown = (e: React.MouseEvent): void => {
    if (e.button !== 0 || editingSticky) return
    // 在缩略图等浮层控件上按下不启动画布框选/平移
    if ((e.target as HTMLElement).closest?.('.canvas-minimap')) return
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
    const type = tool
    let d: Omit<CanvasShape, 'id'> = { type, x: wx, y: wy, w: 0, h: 0 }
    setDraft(d)
    const onMove = (ev: MouseEvent): void => {
      const p = screenToWorld(ev.clientX, ev.clientY)
      d = { ...d, w: p.wx - d.x, h: p.wy - d.y }
      setDraft(d)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
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
    const onMove = (ev: MouseEvent): void =>
      updateShape(sh.id, { x: x0 + (ev.clientX - sx) / scale, y: y0 + (ev.clientY - sy) / scale })
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
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
    const onMove = (ev: MouseEvent): void =>
      moveFrame(f.id, fx + (ev.clientX - sx) / scale, fy + (ev.clientY - sy) / scale)
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
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
          onMouseDown={onDown}
          onDoubleClick={() => !isDraft && setEditingSticky(id)}
        >
          {sh.text}
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
      <div
        className="canvas-world"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})` }}
      >
        {shapes.map((sh) => renderShape(sh))}
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
            style={{ left: f.x, top: f.y, width: f.w, height: f.collapsed ? HEAD_H : f.h }}
          >
            <div
              className="cframe-head"
              onMouseDown={(e) => startFrameDrag(f, e)}
              onDoubleClick={() => setEditingFrame(f.id)}
            >
              <span className="cframe-dot" />
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
              <span className="cframe-spacer" />
              <button
                className="cframe-btn"
                data-tip="整理排列（模块按大小从左上对齐）"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => tidyFrame(f.id)}
              >
                <TidyIcon size={13} />
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
                .filter((n) => n.pane || n.component)
                .map((n) =>
                  n.component ? (
                    <CanvasComponentNode
                      key={n.id}
                      frame={f}
                      node={n}
                      selected={sel.has('n:' + f.id + ':' + n.id)}
                      onSelect={(add) => selectElement('n:' + f.id + ':' + n.id, add)}
                    />
                  ) : (
                    <CanvasFileNode
                      key={n.id}
                      frameId={f.id}
                      node={n}
                      selected={sel.has('n:' + f.id + ':' + n.id)}
                      onSelect={(add) => selectElement('n:' + f.id + ':' + n.id, add)}
                    />
                  )
                )}
          </div>
        ))}
      </div>

      {/* 收起态：左缘竖排「基本操作」引导（镜像右侧「文件信息」），点击滑出工具栏 */}
      {!toolsOpen && (
        <div className={`ctd-edge${toolsHover ? ' hot' : ''}`}>
          <span
            className="ctd-edge-guide"
            ref={toolsEdgeRef}
            data-tip="展开基本操作"
            onMouseEnter={() => setToolsHover(true)}
            onMouseMove={onToolsEdgeMove}
            onMouseLeave={() => {
              setToolsHover(false)
              resetToolsEdge()
            }}
            onClick={() => {
              setToolsHover(false)
              setToolsOpen(true)
            }}
          >
            <span className="ctd-edge-label">基本操作</span>
          </span>
        </div>
      )}

      <div className={`canvas-toolbar${toolsOpen ? ' open' : ' closed'}`}>
        <button
          className={`ctool${tool === 'select' ? ' on' : ''}`}
          data-tip="选择 / 移动"
          onClick={() => setTool('select')}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
            <path d="M5 3l6 16 2.5-6.5L20 10z" />
          </svg>
        </button>
        <div className="ctool-sep" />
        <button
          className={`ctool${tool === 'rect' ? ' on' : ''}`}
          data-tip="矩形"
          onClick={() => setTool('rect')}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="5" width="16" height="14" rx="2" />
          </svg>
        </button>
        <button
          className={`ctool${tool === 'arrow' ? ' on' : ''}`}
          data-tip="箭头"
          onClick={() => setTool('arrow')}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 19L19 5M19 5h-7M19 5v7" />
          </svg>
        </button>
        <button
          className={`ctool${tool === 'sticky' ? ' on' : ''}`}
          data-tip="便签"
          onClick={() => setTool('sticky')}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16v11l-5 5H4z" />
            <path d="M20 15h-5v5" />
          </svg>
        </button>
      </div>

      <CanvasMiniMap />
      <CanvasRunMonitor />

      <div className="canvas-zoombar">
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
        <CanvasContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {picker && (
        <CanvasFilePicker
          x={picker.x}
          y={picker.y}
          root={picker.root}
          rootName={picker.rootName}
          onClose={() => setPicker(null)}
          onPick={(filePath) => {
            // 重新取 Frame：菜单开着的这会儿它可能已被 reflow 挪过位置
            const frame = useStore.getState().canvas.frames.find((f) => f.id === picker.frameId)
            if (!frame) return
            addFileNode(
              picker.frameId,
              paneForFile(filePath),
              picker.wx - frame.x - 90,
              picker.wy - frame.y - 15
            )
          }}
        />
      )}
    </div>
  )
}
