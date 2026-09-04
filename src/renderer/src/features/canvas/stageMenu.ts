// 画布右键菜单：按右键落点（终端面板 / 文件节点 / 图形 / Frame / 空白）算出菜单项。
//
// 从 CanvasStage 里搬出来的。它够格独立是因为**数据全部从 useStore.getState() 现取**，
// 不依赖组件的任何渲染态——只有三个「要改谁的编辑态」的回调需要传进来。
// 留在 937 行的组件里时，这 70 行夹在一堆手势 effect 中间，
// 想加一个菜单项得先分清哪些变量是闭包捕获的、哪些是当场读的。
import { useStore } from '../../store'
import { liveMaximizedNode } from '../../store/canvas/selectors'
import { collectLeaves } from '../../layout'
import type { CanvasMenuItem } from '../../ui/CanvasContextMenu'
import { boardColumnsNow, statusOfFrame } from './frameStatus'
import { menuOwnerOf } from './menuOwnership'
import { insertPointInFrame } from './dropPoint'
import { CANVAS_COMPONENTS } from './components/registry'

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
  // ── 右键归谁：画布层，还是压在它上面的那一层 ───────────────────────
  //
  // **这几条判定搬去 menuOwnership.ts 了**（2026-08-30），理由是它们
  // 在这里一条测试都盖不到 —— 这个函数要 useStore 和一堆 DOM，
  // node --test 加载不了。而它的坏法是静默的：漏掉一个选择器，
  // 右键照样弹一个菜单，只是弹错了那个（用户在登录面板上右键弹出
  // 「关闭终端」就是这么来的）。抽出去之后只依赖一个 closest，拿假节点就能测。
  //
  // 最大化那条要先拿 store 算：liveMaximizedNode 而不是直接读 maximizedNode ——
  // 它指的节点可能已经被关掉了（理由见 store/canvas/selectors.ts）。
  const owner = menuOwnerOf(t, liveMaximizedNode(useStore.getState()) !== null)
  if (owner !== 'canvas') return null

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
    // 一级只放「这一条是干什么的」，具体选项收进二级。
    // **状态那一组原来是平铺的** —— 列多了（状态是用户自己建的列）
    // 一级菜单会被它撑成一长条，而「重命名 / 折叠 / 删除」这些反而被挤到看不见。
    const curName = boardColumnsNow().find((c) => c.id === cur)?.name
    items = [
      { label: '重命名', onClick: () => setEditingFrame(fid) },
      { label: frame?.collapsed ? '展开' : '折叠', onClick: () => st.toggleCollapse(fid) },
      { sep: true, label: '', onClick: () => {} },
      {
        // 跟标题栏右上角那排是同一组动作。收进右键是因为**折叠着的时候
        // 那排按钮是藏起来的**，右键成了唯一入口
        label: '新建',
        onClick: () => {},
        sub: [
          { label: 'AI 对话', onClick: () => void st.addAgentNode(fid) },
          { label: '终端', onClick: () => void st.addTerminalNode(fid) },
          { label: '浏览器', onClick: () => st.addBrowserNode(fid) },
          { sep: true, label: '', onClick: () => {} },
          // 组件**从注册表来，不另抄一份清单** —— 注册表的契约是
          // 「新增组件只改 registry.tsx 一个文件」，抄一份这里必然漏掉新组件。
          ...CANVAS_COMPONENTS.map((c) => {
            const blocked = !!c.needsProject && !frame?.projectId
            return {
              label: c.name,
              // 需要项目却没绑：**置灰并说明为什么**，而不是让它点了没反应
              // （抽屉那条路是"拖进去被静默拒绝"，那个坏法这里不要重复）
              disabled: blocked,
              ...(blocked ? { hint: '需绑定项目' } : {}),
              onClick: () => {
                // 状态在点的那一刻现取：菜单开着的时候画布还能被滚动/缩放
                const now = useStore.getState()
                const f = now.canvas.frames.find((x) => x.id === fid)
                const r = viewportEl?.getBoundingClientRect()
                if (!f || !r) return
                const { px, py } = insertPointInFrame(
                  { x: e.clientX, y: e.clientY },
                  r,
                  now.canvas.viewport,
                  f,
                  c.defaultSize.w
                )
                now.addComponentNode(fid, c.id, px, py, c.defaultSize.w, c.defaultSize.h)
              }
            }
          })
        ]
      },
      {
        label: '设置项目状态',
        // **当前状态显示在一级** —— 不然要展开才知道现在是什么，
        // 而「现在是什么」恰恰是打开这个菜单最常想知道的事
        hint: curName ?? '未分类',
        onClick: () => {},
        sub: [
          // 和标题栏色点是同一组状态、同一套文案。右键这条是给「已经在右键菜单里」的人用的，
          // 不指望他为了改状态先关掉菜单再去点那个 9px 的圆点。
          ...boardColumnsNow().map((c) => ({
            label: c.name,
            // 读的是**项目**状态，不是 frame.status —— 后者是旧结构，启动时已经迁走了
            hint: cur === c.id ? '当前' : undefined,
            onClick: () => st.setFrameStatus(fid, cur === c.id ? null : c.id)
          })),
          { sep: true, label: '', onClick: () => {} },
          { label: '未分类', disabled: !cur, onClick: () => st.setFrameStatus(fid, null) }
        ]
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
