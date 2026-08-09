// 终端输入框右键插入的待办清单：这个 hook 管「存在哪个 key 下面」和增删改查，
// TerminalTodoPanel 只管画。
//
// **key 怎么选是这个功能唯一不好办的地方。** ptyId/leafId 每次开终端都是新的一个——
// 哪怕只是重启一下软件，画布上「看起来还是那个终端」的节点，背后的 pty 早已经是
// 全新进程、全新 leafId（见 store/canvasSlice.ts 的 materializeCanvas：重启后
// 画布终端节点的 leafId 被剥掉重开，唯一没变的是节点自己的 id）。
// 所以「跟终端走」在实现上其实是「跟画布节点走」——两者在座位上是一回事，
// 只有画布节点的 id 真正扛得住重启。
//
// 没上画布的纯分屏终端没有这个锚点，只能退化成 `leaf:<leafId>` 这种当次会话内
// 有效的 key——重启后自然找不回来。这不是本功能没做好，是纯分屏终端本来就不会在
// 重启后还存在（分屏的 tabs 列表本身就不落盘，只有画布场景落盘）：没有终端可看，
// 也就没有「清单去哪了」这个问题。
//
// **key 必须是响应式的，不能只在挂载那一刻算一次。** PaneLayer 为了让终端跨视图
// （分屏/画布/看板）共享同一个实例，用 leafId 当 React key，终端组件整个会话
// 期间只挂载一次、从不重挂载（见 PaneLayer.tsx 顶部注释）。如果只在 mount 时
// 用 useStore.getState() 拍一次快照：
//   1) 「先在分屏里插入待办，后来才把这个终端拖上/切到画布」——画布节点是那之后
//      才建的，mount 那一刻查，只会查到分屏兜底的 leaf key，往后画布节点有了 id
//      也追不上去，清单从此和真正的终端身份脱节。
//   2) 重启时 materializeCanvas 先建 tab（这一刻 leafId 全新、还没绑到任何节点上），
//      隔一拍才把 leafId 写回节点——中间这一拍如果被 React 当成一次独立渲染，
//      也会先解析到错误的兜底 key。
// 所以这里订阅 store（而不是拍快照），key 变了就重新解析；
// 且发现「旧 key 有数据、新 key 还没有」时，原样搬过去而不是各查各的——
// 否则用户已经打进去的条目会凭空「消失」（其实只是换了个没人再读的 key）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { uid } from '../../store/shared'
import type { TodoItem } from '../../../../shared/types'

export interface TerminalTodos {
  items: TodoItem[]
  /** 是否存在一份清单（哪怕是空的）。区分「没插入过」和「插入了但清空了」 */
  exists: boolean
  /** 磁盘读回来之前是 false——避免挂载瞬间先闪一下「没有清单」 */
  loaded: boolean
  expanded: boolean
  setExpanded: (v: boolean) => void
  /** 右键菜单点「插入待办清单」：没有就新建一份空的，有就只展开面板，不重置内容 */
  ensure: () => void
  addItem: (text: string) => void
  toggleItem: (id: string) => void
  editItem: (id: string, text: string) => void
  removeItem: (id: string) => void
  /** 删掉整份清单——不是清空条目，key 本身从存储里消失 */
  removeList: () => void
}

export function useTerminalTodos(leafId: string): TerminalTodos {
  // 响应式解析 key：这个 leaf 有没有被某个画布节点引用，引用了就用节点 id，
  // 没有就退化成会话内的 leaf key。订阅的是 store，节点是之后才绑上的也能追上。
  const nodeId = useStore((s) => {
    for (const f of s.canvas.frames) {
      const n = f.nodes.find((nd) => nd.leafId === leafId)
      if (n) return n.id
    }
    return null
  })
  const key = nodeId ?? `leaf:${leafId}`

  const [items, setItems] = useState<TodoItem[]>([])
  const [exists, setExists] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // 增删改回调要用「此刻生效」的 key 落盘，但不想为此把 key 塞进每个 useCallback
  // 的依赖数组（那样 key 一变所有回调全部重建）。用 ref 兜底同步，每次渲染都写。
  const keyRef = useRef(key)
  keyRef.current = key
  // 上一次生效的 key——key 变化时判断「是不是同一个清单换了个身份」，用于搬家
  const prevKeyRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void (async () => {
      const prevKey = prevKeyRef.current
      prevKeyRef.current = key
      let data = await window.api.todos.get(key)
      // key 换了（比如这个终端后来才被拖上画布，key 从 leaf:xx 换成了节点 id）：
      // 新 key 下还没数据、旧 key 下有 → 这是同一份清单换了个身份证，原样搬过去，
      // 不能让用户已经打进去的条目凭空消失（旧 key 从此没人会再读，等于丢了）
      if (prevKey && prevKey !== key && data === null) {
        const old = await window.api.todos.get(prevKey)
        if (old !== null) {
          await window.api.todos.save(key, old)
          await window.api.todos.remove(prevKey)
          data = old
        }
      }
      if (cancelled) return
      if (data) {
        setItems(data)
        setExists(true)
        // 展开/收起状态只在**真正第一次挂载**时定默认值（有内容就收起，省地方）。
        // key 换了但 prevKey 不是 null——说明这是画布节点绑定引发的搬家（同一份清单
        // 换了个身份证，见上面的搬家逻辑），不是用户翻开了一份新清单，不该替用户
        // 把刚展开看着的面板收起来。
        if (prevKey === null) setExpanded(false)
      } else {
        setItems([])
        setExists(false)
      }
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [key])

  const ensure = useCallback(() => {
    setExists((was) => {
      if (!was) void window.api.todos.save(keyRef.current, [])
      return true
    })
    setExpanded(true)
  }, [])

  const addItem = useCallback((text: string) => {
    const t = text.trim()
    if (!t) return
    setItems((cur) => {
      const next = [...cur, { id: uid('todo'), text: t, done: false }]
      void window.api.todos.save(keyRef.current, next)
      return next
    })
  }, [])

  const toggleItem = useCallback((id: string) => {
    setItems((cur) => {
      const next = cur.map((it) => (it.id === id ? { ...it, done: !it.done } : it))
      void window.api.todos.save(keyRef.current, next)
      return next
    })
  }, [])

  const editItem = useCallback((id: string, text: string) => {
    setItems((cur) => {
      const next = cur.map((it) => (it.id === id ? { ...it, text } : it))
      void window.api.todos.save(keyRef.current, next)
      return next
    })
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems((cur) => {
      const next = cur.filter((it) => it.id !== id)
      void window.api.todos.save(keyRef.current, next)
      return next
    })
  }, [])

  const removeList = useCallback(() => {
    setExists(false)
    setItems([])
    setExpanded(false)
    void window.api.todos.remove(keyRef.current)
  }, [])

  return {
    items,
    exists,
    loaded,
    expanded,
    setExpanded,
    ensure,
    addItem,
    toggleItem,
    editItem,
    removeItem,
    removeList
  }
}
