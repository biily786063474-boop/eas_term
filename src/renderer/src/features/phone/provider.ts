// 接主进程的问询，从 store 取数、交给 collect.ts 算，回给主进程。
//
// **这一层不做任何判断。** 挑什么给手机看全在 collect.ts（有 17 个单测），
// 谁能进来全在 main/phone/pairing.ts（有 18 个）。这里只是搬运 ——
// 有判断的地方必须能单测，这条是整个手机端功能的分层依据。
//
// **第 7 道锁「密钥永不出机器」在这里是结构性的**：本文件只调 collect 的三个
// 函数，它们的返回类型里没有任何密钥字段；secrets.json / keychain / MCP token
// 这条路上一次都不会被读到。不是「记得别传」，是根本没有能传的东西。
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { collectFiles, collectProjects, collectSessions, resolveFile } from './collect'

/** leafId → 那个终端/对话所在标签页的标题。跟甘特图 titleByLeaf 同一个信源
 *  （tab.title 是 shell OSC 写的，agent 干活时会同步写入当前任务）。 */
function titleByLeaf(): Map<string, string> {
  const m = new Map<string, string>()
  for (const tab of useStore.getState().tabs) {
    for (const leaf of collectLeaves(tab.root)) {
      if (leaf.pane.kind === 'terminal' || leaf.pane.kind === 'agent') m.set(leaf.id, tab.title)
    }
  }
  return m
}

function answer(action: string, args: Record<string, unknown>): unknown {
  const s = useStore.getState()
  const frames = s.canvas.frames
  const projectId = typeof args.projectId === 'string' ? args.projectId : ''

  switch (action) {
    case 'projects':
      return collectProjects(frames, s.projects, s.runningPtys, s.attentionPtys)
    case 'sessions':
      return collectSessions(frames, projectId, titleByLeaf(), s.runningPtys, s.attentionPtys)
    case 'files':
      return collectFiles(frames, projectId)
    // 'resolve' 不是手机能请求的动作（白名单里没有它）——
    // 它是 server.ts 读文件时内部问的一步，手机给的是 nodeId，路径它永远拿不到
    case 'resolve':
      return resolveFile(frames, projectId, typeof args.nodeId === 'string' ? args.nodeId : '')
    default:
      return null
  }
}

let bound = false

/** 挂上监听。App 挂载时调一次；重复调用是空操作（HMR 下会重入）。 */
export function bindPhoneProvider(): void {
  if (bound) return
  bound = true
  window.api.phone.onQuery(({ id, action, args }) => {
    let data: unknown = null
    try {
      data = answer(action, args ?? {})
    } catch (e) {
      // 抛到主进程那边只会变成一个超时（它在等 reply），
      // 那样用户看到「电脑正忙」而真实原因埋在这里。宁可回 null + 打日志。
      console.error('[phone] provider 出错', action, e)
    }
    window.api.phone.reply(id, data)
  })
}
