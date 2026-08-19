// 关掉一个节点时，底层进程要不要跟着停。
//
// 抽成纯函数是因为这条判断有两个方向都会出事，而两个方向的代价都不小：
//   · 该杀不杀 → CLI 进程无人看管地继续跑，真花 token（spec §A.5 明确要求杀）
//   · 不该杀杀了 → 你想看一眼团队里某个 agent，关掉窗口就把它干掉了
//
// 不引 electron/store，node --test 直接跑。

export interface ClosablePane {
  kind: string
  sessionId?: string
  /** 谁开的。缺省 = 用户自己开的；'team' = 团队派生 */
  owner?: 'team'
}

/**
 * 关节点时要不要停掉底层 CLI 会话。
 *
 * **团队派生的会话不停** —— 对它们，关节点的意思是「这块屏幕我不看了」，
 * 不是「我不要它了」。它还在替你干活，由团队面板负责停。
 *
 * 这个例外成立的前提是**面板里每一行都能停**：只标记不给出口，就是制造一个
 * 没有任何 UI 能管的后台进程（15 分钟空闲回收对活跃会话无效，
 * 见 main/agentChat/session.ts 里 killAgentChatSessionsForWebContents 上方那段）。
 */
export function shouldStopSessionOnClose(pane: ClosablePane): boolean {
  if (pane.kind !== 'agent') return false
  // 没有 sessionId = 会话从没建立起来，天然没东西可停
  if (!pane.sessionId) return false
  return pane.owner !== 'team'
}
