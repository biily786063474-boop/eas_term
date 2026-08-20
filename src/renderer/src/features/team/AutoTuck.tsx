// 自动收起干完活的 agent 会话窗口。
//
// 用户的话：「子进程在结束一段时间不用等情况下会话面板就关掉」。
// **只收窗口，不动会话** —— hideAgentSession 摘的是画布节点，
// leaf、聊天记录、resumeId 全留着，从团队面板点一下还能再打开。
//
// 为什么是常驻组件而不是写在 TeamPanel 里：那个面板是**画布上的一个组件节点**
// （registry.tsx 里的 'team'），用户不一定往画布上放过它，放了也可能在别的 Frame。
// 逻辑写在它里面的话，「没把面板摆出来就不会自动收」——
// 而恰恰是没在盯着面板的时候，最需要它替你收拾。
//
// **绝不收中断的会话。** canAutoTuck 挡着这一条：网络一抖被打断的 agent
// 活没干完，把它的窗口收起来等于把没做完的活从眼前藏走，比不收更糟
// （这正是 2026-08-20 那条反馈的另一半）。

import { useEffect } from 'react'
import { useStore } from '../../store'
import { canAutoTuck } from './agentAge'
import { deliveredOf } from '../../../../shared/teamFindings'
import { collectLeaves } from '../../layout'

/** 结束多久之后收起来。
 *
 *  3 分钟：短了会在人正读着输出的时候把窗口抽走（最恼人的失败模式），
 *  长了画布上就一直挂着一排死掉的会话框，违背「默认不出会话框」的初衷。 */
export const TUCK_AFTER_MS = 3 * 60 * 1000

/** 多久查一次。判据本身是分钟级的，没必要查得勤 —— 这是个常驻定时器，
 *  频率直接乘在后台功耗上（切后台被 Chromium 降速的实测见 memory）。 */
const SWEEP_MS = 30 * 1000

export function TeamAutoTuckHost(): null {
  useEffect(() => {
    let stopped = false

    const sweep = async (): Promise<void> => {
      const list = await window.api.agentChat.listSessions().catch(() => [])
      if (stopped) return
      const st = useStore.getState()
      const now = Date.now()

      // 只管团队 agent。用户自己开的对话窗口是他自己摆在那儿的，
      // 软件没有资格替他收走。
      const done = list.filter(
        (r) =>
          r.owner === 'team' &&
          canAutoTuck(r.alive, r.ended) &&
          now - r.lastActiveAt >= TUCK_AFTER_MS
      )
      if (!done.length) return

      // 交没交活要按项目一次问清（IPC 是按项目 + 角色列表来的）。
      // 隔离的 agent cwd 指向工作树，得先归位到它所属的项目。
      const byProject = new Map<string, string[]>()
      for (const r of done) {
        const proj = st.projects.find(
          (p) => p.path && (r.cwd === p.path || r.cwd.startsWith(`${p.path}/`))
        )
        if (!proj?.path || !r.role) continue
        const arr = byProject.get(proj.path) ?? []
        arr.push(r.role)
        byProject.set(proj.path, arr)
      }
      const bytesByRole = new Map<string, number | null>()
      for (const [path, roles] of byProject) {
        const got = await window.api.agentChat.teamFindings(path, roles).catch(() => ({}))
        if (stopped) return
        for (const [role, bytes] of Object.entries(got)) bytesByRole.set(role, bytes)
      }

      for (const r of done) {
        // 正在最大化看着的那个不收 —— 人就在读它
        if (st.maximizedNode && isNodeOf(r.id, st.maximizedNode.nodeId)) continue
        const bytes = r.role ? bytesByRole.get(r.role) : undefined
        // 拿不到交活判定（没角色名 / 读文件失败）时按 undefined 走，只看结束方式。
        // **宁可少收**：漏收一个只是画布上多一个窗口，收错一个是把活藏起来。
        const delivered = bytes === undefined ? undefined : deliveredOf(bytes)
        if (!canAutoTuck(r.alive, r.ended, delivered)) continue
        useStore.getState().hideAgentSession(r.id)
      }
    }

    const isNodeOf = (sessionId: string, nodeId: string): boolean => {
      const st = useStore.getState()
      for (const f of st.canvas.frames) {
        const n = f.nodes.find((x) => x.id === nodeId)
        if (!n?.leafId) continue
        for (const t of st.tabs) {
          const leaf = collectLeaves(t.root).find((l) => l.id === n.leafId)
          if (leaf?.pane.kind === 'agent' && leaf.pane.sessionId === sessionId) return true
        }
      }
      return false
    }

    const timer = setInterval(() => void sweep(), SWEEP_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  return null
}
