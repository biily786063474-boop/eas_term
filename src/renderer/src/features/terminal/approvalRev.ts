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

/** 点击那一刻按终端**现屏**重解析一次。rev 只在「转圈→空闲」时盖新的；CLI 不转圈、原地把 A 换成 B 时
 *  store 里仍是 A —— 只有现屏能说出真相。由挂载着的 TerminalView 登记读屏函数。 */
const liveReaders = new Map<string, () => ApprovalInfo | null>()

export function registerLiveApproval(ptyId: string, read: () => ApprovalInfo | null): () => void {
  liveReaders.set(ptyId, read)
  return () => {
    if (liveReaders.get(ptyId) === read) liveReaders.delete(ptyId)
  }
}

/** 现屏比对不看空白：终端改宽度（拖窗口、分屏、缩放）后 CLI 重画，长命令换行点变了，
 *  'rm -rf bui' + 'ld' 和 'rm -rf build' 是同一条审批，不能因此把合法点击挡掉 */
const looseFingerprint = (a: ApprovalInfo): string =>
  JSON.stringify([a.question, a.body, a.dangerous, a.options.map((o) => [o.index, o.label])]).replace(/\s+/g, '')

export type LiveApproval =
  | { state: 'unknown' } // 没有挂载的终端可读：沿用 rev 判断
  | { state: 'same' }
  | { state: 'changed'; live: ApprovalInfo | null } // 换题了 / 框没了 / 首次只解析到半个框

export function liveApproval(ptyId: string, ap: ApprovalInfo): LiveApproval {
  const read = liveReaders.get(ptyId)
  if (!read) return { state: 'unknown' }
  let live: ApprovalInfo | null
  try {
    live = read()
  } catch {
    return { state: 'changed', live: null }
  }
  return live && looseFingerprint(live) === looseFingerprint(ap) ? { state: 'same' } : { state: 'changed', live }
}
