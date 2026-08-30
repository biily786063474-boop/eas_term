// 手机发起的**写操作**请求，以及它必须经过的那道人工闸。
//
// **纯逻辑，不碰 fs / net / electron。** 这一层决定「一个写请求什么时候算数」，
// 和 pairing.ts 是同一类东西：判断错了看不出来，所以必须能单测。
//
// ── 为什么写操作要单开一套，不复用配对那套 ────────────────────────
// 配对是「这台设备以后能不能进来」，一次性、长期有效；
// 写请求是「这一次能不能干这件事」，每次都要问。两者的生命周期完全不同，
// 混用会让「配过对」被误解成「以后新建会话不用再问」——
// 而那正好取消了这道闸的全部意义。
//
// ── 三条设计 ──────────────────────────────────────────────────────
// ① **一次只允许一个待确认请求。** 手机连点五下不该在电脑上排出五个弹窗；
//    而且多个待确认请求会让人分不清自己在批哪一个。
// ② **过期比拒绝更常见，要分开表达。** 人不在电脑前时请求会一直挂着，
//    手机上必须能说清「他还没看到」和「他拒绝了」——用户的下一步完全不同。
// ③ **允许之后才产生动作。** allow() 只是把状态推到 allowed，
//    真正建节点由调用方做完再 fulfill()；失败了要能回到 failed 而不是假装成功。

/** 一个写请求最多挂多久没人理。**两分钟** —— 比配对码长（那个只要人扫一下），
 *  但也不能无限：手机上转两分钟还没结果，用户该被告知「他可能不在电脑前」。 */
export const REQ_TTL_MS = 120_000

export type ReqState = 'waiting' | 'allowed' | 'denied' | 'expired' | 'done' | 'failed'

export interface PendingRequest {
  id: string
  deviceId: string
  deviceName: string
  /** 目前只有 'newSession'。留成字符串是为了以后加写操作时这层不用动 */
  action: string
  /** 给电脑上那句提示用的人话，如「在「口播相机」里新建一个 AI 对话」 */
  title: string
  args: Record<string, unknown>
  createdAt: number
  state: ReqState
  /** done 时带回给手机的东西（比如新会话的节点 id） */
  result?: Record<string, unknown>
  /** failed 时的原因，原样给手机看 —— 「建失败了」比「超时」有用得多 */
  error?: string
}

export function expired(r: PendingRequest, now: number): boolean {
  return r.state === 'waiting' && now - r.createdAt >= REQ_TTL_MS
}

/** 读状态时顺手把过期的推到 expired。**不做定时器** ——
 *  没人问的时候它是什么状态并不重要，问的那一刻算准就够了
 *  （跟 gantt.ts 的保留期同一个思路：写入/读取时清理，不养定时器）。 */
export function settle(r: PendingRequest | null, now: number): PendingRequest | null {
  if (!r) return null
  return expired(r, now) ? { ...r, state: 'expired' } : r
}

/**
 * 手机发来一个写请求。
 *
 * **已经有一个在等的时候直接拒**（见设计 ①）。返回 reason 让手机说清楚：
 * 「电脑上还有一个请求没处理」比「失败」有用。
 */
export function open(
  cur: PendingRequest | null,
  req: Omit<PendingRequest, 'state'>,
  now: number
): { ok: true; req: PendingRequest } | { ok: false; reason: 'busy' } {
  const settled = settle(cur, now)
  if (settled && settled.state === 'waiting') return { ok: false, reason: 'busy' }
  return { ok: true, req: { ...req, state: 'waiting' } }
}

/** 人在电脑上点了允许。**只改状态，不做事** —— 真正的动作由调用方接着做。 */
export function allow(r: PendingRequest | null, now: number): PendingRequest | null {
  const s = settle(r, now)
  return s && s.state === 'waiting' ? { ...s, state: 'allowed' } : s
}

export function deny(r: PendingRequest | null, now: number): PendingRequest | null {
  const s = settle(r, now)
  return s && s.state === 'waiting' ? { ...s, state: 'denied' } : s
}

/** 动作做完了。成功给 result，失败给 error —— **失败不能装成成功**，
 *  手机上转个圈然后说「好了」而电脑上什么都没发生，是最难查的那种。 */
export function fulfill(
  r: PendingRequest | null,
  outcome: { ok: true; result?: Record<string, unknown> } | { ok: false; error: string }
): PendingRequest | null {
  if (!r || r.state !== 'allowed') return r
  return outcome.ok
    ? { ...r, state: 'done', result: outcome.result }
    : { ...r, state: 'failed', error: outcome.error }
}

/** 手机轮询时给它看的。**不回 args** —— 那是它自己发的，回去没有意义，
 *  而且请求体里可能有以后加的敏感字段，默认不外传。 */
export function publicView(
  r: PendingRequest | null,
  now: number
): { state: ReqState | 'none'; result?: Record<string, unknown>; error?: string } {
  const s = settle(r, now)
  if (!s) return { state: 'none' }
  return { state: s.state, result: s.result, error: s.error }
}
