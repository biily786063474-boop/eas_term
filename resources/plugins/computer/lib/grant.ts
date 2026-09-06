// **授权窗口**的状态机。纯函数（时钟注入），必须有测试。
//
// 设计稿 §三 决定 3：能点击的那档必须有一个会过期的授权，**没有永久授权这个选项**。
// 理由在 §二 A5：一次开了忘掉是这个功能最危险的形态 —— 三天后模型顺手点了什么，
// 没人能把它和「那天我点过一次允许」联系起来。
//
// 授权是**全局单例**（一个插件进程），不按会话分：多个 agent 共用同一把钥匙，
// 面板上永远只显示一个倒计时，用户不用去猜「我到底授权了谁」。

/** 允许的时长档位（分钟）。**没有「永不过期」** */
export const GRANT_MINUTES = [5, 10, 30] as const
export type GrantMinutes = (typeof GRANT_MINUTES)[number]

export interface Grant {
  /** 谁授的：用户在哪块面板上点的（panelSession），只用于日志 */
  by: string
  grantedAt: number
  expiresAt: number
}

export type GrantState =
  | { active: true; remainingMs: number; expiresAt: number; by: string }
  | { active: false; reason: 'never' | 'expired' | 'revoked' }

export function grantFor(minutes: number, now: number, by: string): Grant | null {
  const m = GRANT_MINUTES.find((x) => x === minutes)
  if (!m) return null
  return { by, grantedAt: now, expiresAt: now + m * 60_000 }
}

/** 当前状态。`revoked` 与 `never` 分开：面板上要能说清是「没授过」还是「刚被收回」。 */
export function stateOf(g: Grant | null, now: number, revoked = false): GrantState {
  if (revoked) return { active: false, reason: 'revoked' }
  if (!g) return { active: false, reason: 'never' }
  const left = g.expiresAt - now
  if (left <= 0) return { active: false, reason: 'expired' }
  return { active: true, remainingMs: left, expiresAt: g.expiresAt, by: g.by }
}

/** 拒绝时给用户/模型看的一句话。**要说怎么办**，不能只说不行（「失败要说人话」）。 */
export function denyMessage(s: GrantState): string {
  if (s.active) return ''
  const how = '在画布上那块「电脑操作」面板里点一下「允许操作」，选个时长。'
  if (s.reason === 'expired') return `操作授权已经到期。${how}`
  if (s.reason === 'revoked') return `操作授权刚被收回。${how}`
  return `还没有授权操作这台电脑（截图不受影响）。${how}`
}

/** 倒计时文案：给面板用。到期显示「已到期」而不是负数 */
export function remainingText(s: GrantState): string {
  if (!s.active) return '未授权'
  const sec = Math.ceil(s.remainingMs / 1000)
  const m = Math.floor(sec / 60)
  const ss = String(sec % 60).padStart(2, '0')
  return `${m}:${ss}`
}
