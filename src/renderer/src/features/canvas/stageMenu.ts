// 画布右键菜单：按右键落点（终端面板 / 文件节点 / 图形 / Frame / 空白）算出菜单项。
//
// 从 CanvasStage 里搬出来的。它够格独立是因为**数据全部从 useStore.getState() 现取**，
// 不依赖组件的任何渲染态——只有三个「要改谁的编辑态」的回调需要传进来。
// 留在 937 行的组件里时，这 70 行夹在一堆手势 effect 中间，
// 想加一个菜单项得先分清哪些变量是闭包捕获的、哪些是当场读的。
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import type { CanvasMenuItem } from './CanvasContextMenu'
import { boardColumnsNow, statusOfFrame } from './frameStatus'

/** 「关闭终端」这一项。只有直接右键终端时才给 —— 理由见下面 shapeEl 分支的注释。 */
function closeTerminalItem(leafId: string): CanvasMenuItem {
  return {
    label: '关闭终端',
    danger: true,
    onClick: () => {
      const st = useStore.getState()
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
      if (fid && nid) st.removeNode(fid, nid)
      const tab = st.tabs.find((tb) => collectLeaves(tb.root).some((l) => l.id === leafId))
      if (tab) st.closeLeaf(tab.id, leafId)
    }
  }
}

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
  // 标记层（.canvas-shape-layer）是 .canvas-viewport / .pane-layer 的**兄弟**，
  // 不在它俩里面。少了第三条的话，右键落在任何一个标记上都会在入口被判成
  // 「落在画布之外」→ 走 Electron 默认系统菜单，图形分支（编辑 / 删除）整体不可达；
  // 标记盖住终端时，那块区域连「关闭终端」也一起没了。
  if (!t.closest('.canvas-viewport') && !t.closest('.pane-layer') && !t.closest('.canvas-shape-layer'))
    return null
  // 终端输入框有自己的右键菜单（待办清单）。不排除的话，画布模式下在输入框上右键
  // 会命中下面 `.pane[data-leaf-id]` 那一分支，弹出「关闭终端」——和输入框自己弹出的
  // 菜单在同一个坐标叠两份出来，用户点到的到底是哪个全看谁的 DOM 更靠后，纯随缘。
  if (t.closest('.term-input')) return null
  // 便签编辑态的 <textarea> 同理：那里要的是系统的复制/粘贴菜单，不是「新建便签」
  if (t.closest('.cshape.editing')) return null
  const { setEditingSticky, setEditingFrame, viewportEl } = deps
  const st = useStore.getState()
  const paneEl = t.closest('.pane[data-leaf-id]') as HTMLElement | null
  const nodeEl = t.closest('.cfile-node[data-node-id]') as HTMLElement | null
  const shapeEl = t.closest('.cshape[data-sid]') as HTMLElement | null
  const boardEl = t.closest('.ctodo-board[data-tid]') as HTMLElement | null
  const frameEl = t.closest('.cframe') as HTMLElement | null
  let items: CanvasMenuItem[]
  if (paneEl?.dataset.leafId) {
    items = [closeTerminalItem(paneEl.dataset.leafId)]
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
    // 这里**只给标记自己的项**。曾经试过「底下要是终端就把『关闭终端』也带上」，
    // 理由是标记罩住的那块区域右键全归标记、用户得先挪开标记才够得着那个终端。
    // 但那样等于「右键 A 却能删掉 B」——菜单里所有 danger 项的动作对象都是你刚右键的那个东西，
    // 只有它例外；而标记的设计初衷就是盖住底下的东西，用户很可能根本不知道便签下面压着终端。
    // 何况 closeLeaf 不走 closeLeafSafely 那层「终端还在跑」的确认，秒关且无提示。
    // 够不着那个终端时，挪开标记或点终端没被盖住的部分即可，代价远小于误触。
    items = [
      ...(shape?.type === 'sticky' ? [{ label: '编辑', onClick: () => setEditingSticky(sid) }] : []),
      { label: '删除', danger: true, onClick: () => st.removeShape(sid) }
    ]
  } else if (boardEl?.dataset.tid) {
    // 待办清单模块自己的右键项。同 shapeEl 分支的取舍：右键落在待办清单上只给它自己的操作，
    // 不管底下压没压着终端——道理见上面 shapeEl 分支那段注释。
    const tid = boardEl.dataset.tid
    items = [{ label: '删除待办清单', danger: true, onClick: () => st.removeTodoBoard(tid) }]
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
      ...boardColumnsNow().map((c) => ({
        label: c.name,
        // 读的是**项目**状态，不是 frame.status —— 后者是旧结构，启动时已经迁走了
        hint: cur === c.id ? '当前' : undefined,
        onClick: () => st.setFrameStatus(fid, cur === c.id ? null : c.id)
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
        label: '新建批注',
        onClick: () => st.addShape({ type: 'sticky', x: wx, y: wy, w: 190, h: 96, text: '双击编辑…' })
      },
      {
        label: '新建待办清单',
        onClick: () => st.addTodoBoard(wx, wy)
      }
    ]
  }
  return items
}
