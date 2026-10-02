import type { IslandAction } from '../../../../shared/types'
import type { ApprovalInfo } from './approvalParse'

/** 一条审批请求的身份。灵动岛上点的是「当时看到的那一条」，写回终端前要核对它还是不是那一条——
 *  否则 CLI 换成下一个请求（选项序号照样是 1/2/3），旧点击会原样批准新请求。
 *
 *  · 同一个提示被反复解析出来（每次输出都会重扫）→ 内容不变就沿用原 rev，按钮不会因为重扫失效；
 *  · 旧请求被清掉后同一段文字再问一次 → prev 为空，发新 rev：那是另一次授权，不能继承。 */
let seq = 0

const fingerprint = (a: ApprovalInfo): string =>
  JSON.stringify([a.question, a.body, a.dangerous, a.options.map((o) => [o.index, o.label])])

export function stampApprovalRev(prev: ApprovalInfo | undefined, next: ApprovalInfo): ApprovalInfo {
  if (prev?.rev && fingerprint(prev) === fingerprint(next)) return { ...next, rev: prev.rev }
  return { ...next, rev: `${Date.now().toString(36)}-${++seq}` }
}

/** 灵动岛回传的 approve 是否仍对得上当前这条审批。动作是跨进程来的，每一项都要现查。 */
export function islandApprovalMatches(ap: ApprovalInfo | undefined, a: IslandAction): boolean {
  if (!ap || ap.dangerous || !ap.rev || a.rev !== ap.rev) return false
  return typeof a.choice === 'number' && ap.options.some((o) => o.index === a.choice)
}
