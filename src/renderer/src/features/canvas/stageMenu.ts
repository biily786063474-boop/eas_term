// 画布右键菜单：按右键落点（终端面板 / 文件节点 / 图形 / Frame / 空白）算出菜单项。
//
// 从 CanvasStage 里搬出来的。它够格独立是因为**数据全部从 useStore.getState() 现取**，
// 不依赖组件的任何渲染态——只有三个「要改谁的编辑态」的回调需要传进来。
// 留在 937 行的组件里时，这 70 行夹在一堆手势 effect 中间，
// 想加一个菜单项得先分清哪些变量是闭包捕获的、哪些是当场读的。
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import type { CanvasMenuItem } from './CanvasContextMenu'
import { FRAME_STATUS_LIST, statusOfFrame } from './frameStatus'

export interface StageMenuDeps {
  /** 便签进入编辑态 */
  setEditingSticky: (id: string) => void
  /** Frame 标题进入改名态 */
  setEditingFrame: (id: string) => void
  /** 算「新建便签」落点的世界坐标要用它 */
  viewportEl: HTMLElement | null
}

/** 返回 null = 右键落在画布之外，不该弹我们的菜单 */
export function stageMenuItems(e: MouseEvent, deps: StageMenuDeps): CanvasMenuItem[] | null {
  const t = e.target as HTMLElement
  if (!t.closest('.canvas-viewport') && !t.closest('.pane-layer')) return null
  const { setEditingSticky, setEditingFrame, viewportEl } = deps
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
  } else if (nodeEl?.dataset.nodeId) {
    // 有 data-node-id 但没有 data-frame-id → 自由节点（知识库拖出来的，不属于任何 Frame）
    const nid = nodeEl.dataset.nodeId
    items = [
      { label: '复制', kbd: '⌘D', onClick: () => st.duplicateFreeNode(nid) },
      { label: '删除节点', danger: true, onClick: () => st.removeFreeNode(nid) }
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
    const cur = statusOfFrame(st.canvas.frames, st.projects, fid)
    items = [
      { label: '重命名', onClick: () => setEditingFrame(fid) },
      { label: frame?.collapsed ? '展开' : '折叠', onClick: () => st.toggleCollapse(fid) },
      { sep: true, label: '', onClick: () => {} },
      // 和标题栏色点是同一组状态、同一套文案。右键这条是给「已经在右键菜单里」的人用的，
      // 不指望他为了改状态先关掉菜单再去点那个 9px 的圆点。
      ...FRAME_STATUS_LIST.map((s) => ({
        label: s.label,
        // 读的是**项目**状态，不是 frame.status —— 后者是旧结构，启动时已经迁走了
        hint: cur === s.key ? '当前' : undefined,
        onClick: () => st.setFrameStatus(fid, cur === s.key ? null : s.key)
      })),
      {
        label: '未分类',
        disabled: !cur,
        onClick: () => st.setFrameStatus(fid, null)
      },
      { sep: true, label: '', onClick: () => {} },
      { label: '删除 Frame', danger: true, onClick: () => st.removeFrame(fid) }
    ]
  } else {
    const r = viewportEl?.getBoundingClientRect()
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
  return items
}
