// 手机端的配对与设备表。**纯逻辑，不碰 fs / net / electron** ——
// 这一层决定「谁能进来」，是整条链路上最不能出错也最该被单测的地方。
// 落盘和网络在别处，各管各的。
//
// 设计取舍写在这里，别散在调用处：
//
// ① **配对码一次性、60 秒过期。** 不做成长期有效的「连接密码」——那种东西
//    会被截图、会被抄进笔记、会在换手机时被复用。一次性意味着泄漏的窗口
//    只有那 60 秒，而且用掉即失效。
//
// ② **扫到码不等于配上。** claim() 只把请求变成「待确认」，
//    真正生效要人在电脑上点 approve()。二维码被隔着肩膀拍到也没用 ——
//    他还得能碰到你的电脑。
//
// ③ **每台设备一条独立凭证**，可单独吊销。手机丢了点一下就断，
//    不影响别的设备，也不用换整套密钥。
//
// ④ **只存 token 的哈希。** 明文 token 在签发那一刻返回一次，之后系统里
//    不存在 —— 设备表被读走也拿不到能用的凭证。

/** 配对码活多久。短到泄漏窗口可忽略，长到够走完「打开手机 → 扫码」。 */
export const PAIR_TTL_MS = 60_000

export interface PendingPair {
  /** 配对码本身（显示在二维码里） */
  code: string
  createdAt: number
  /** 扫码方自报的名字，如 "iPhone 15"。**不可信**，只用于电脑上那句提示 */
  deviceName?: string
  /** 已经被扫、正在等电脑上点确认 */
  claimed: boolean
}

export interface Device {
  id: string
  name: string
  /** token 的哈希。**明文只在签发那一刻返回一次，之后系统里不存在** */
  tokenHash: string
  pairedAt: number
  lastSeenAt: number
}

export interface PhoneState {
  /** 功能总开关。关着时服务器根本不监听 */
  enabled: boolean
  devices: Device[]
  /** 当前展示的配对码；null = 没在配对 */
  pending: PendingPair | null
}

export const emptyState = (): PhoneState => ({ enabled: false, devices: [], pending: null })

/** 配对码过期了吗 */
export function pairExpired(p: PendingPair, now: number): boolean {
  return now - p.createdAt >= PAIR_TTL_MS
}

/**
 * 手机扫了码，来认领。**只把它变成「待确认」，不发凭证。**
 *
 * 三种拒绝理由必须分开返回 —— 手机上要显示不同的话：
 * · no-pending  电脑上压根没在配对（用户可能还没打开那个开关）
 * · bad-code    码不对（扫了张旧的、或者别人的）
 * · expired     超过 60 秒了，让电脑上刷新一张
 */
export function claim(
  s: PhoneState,
  code: string,
  deviceName: string | undefined,
  now: number
): { ok: true; state: PhoneState } | { ok: false; reason: 'no-pending' | 'bad-code' | 'expired' } {
  const p = s.pending
  if (!p) return { ok: false, reason: 'no-pending' }
  // **先判码对不对，再判过期。** 反过来的话，拿一张刚生成的码扫错了对象
  // 会被告知「过期」，用户只会一直重刷那张根本没问题的码。
  if (p.code !== code) return { ok: false, reason: 'bad-code' }
  if (pairExpired(p, now)) return { ok: false, reason: 'expired' }
  return { ok: true, state: { ...s, pending: { ...p, claimed: true, deviceName } } }
}

/** 手机自报的名字**不可信**：去掉控制字符 + 截断，免得它把电脑上那行提示写花，
 *  或者塞个换行伪造出第二行文案。 */
function safeName(raw: string | undefined): string {
  const s = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24)
  return s || '手机'
}

/**
 * 人在电脑上点了「允许」。这一刻才真正产生一台设备。
 *
 * 调用方负责生成 id / token / tokenHash（那要用 crypto，本模块保持纯）。
 * 这里只管状态迁移，以及**必须已经被 claim 过**这条前置 ——
 * 没人扫码时电脑上不该出现「允许」按钮，真出现了也不能放行。
 */
export function approve(
  s: PhoneState,
  device: { id: string; tokenHash: string },
  now: number
): { ok: true; state: PhoneState; device: Device } | { ok: false; reason: 'no-claim' | 'expired' } {
  const p = s.pending
  if (!p || !p.claimed) return { ok: false, reason: 'no-claim' }
  if (pairExpired(p, now)) return { ok: false, reason: 'expired' }
  const d: Device = {
    id: device.id,
    name: safeName(p.deviceName),
    tokenHash: device.tokenHash,
    pairedAt: now,
    lastSeenAt: now
  }
  return { ok: true, state: { ...s, pending: null, devices: [...s.devices, d] }, device: d }
}

/** 电脑上点「拒绝」，或者配对码作废 */
export function cancelPair(s: PhoneState): PhoneState {
  return { ...s, pending: null }
}

/** 踢掉一台设备。手机丢了就点这个。 */
export function revoke(s: PhoneState, deviceId: string): PhoneState {
  return { ...s, devices: s.devices.filter((d) => d.id !== deviceId) }
}

/** 认一台设备。**比对哈希，不比对明文** —— 明文 token 系统里根本没存。 */
export function findDevice(s: PhoneState, tokenHash: string): Device | null {
  return s.devices.find((d) => d.tokenHash === tokenHash) ?? null
}

/** 记一次访问时间。设备表上「最后一次访问」那一列靠它。 */
export function touch(s: PhoneState, deviceId: string, now: number): PhoneState {
  return {
    ...s,
    devices: s.devices.map((d) => (d.id === deviceId ? { ...d, lastSeenAt: now } : d))
  }
}

/** 关掉总开关。**顺带清掉待确认的配对** —— 关了又开时不该还留着一张旧码。
 *  已配对的设备**不清**：关开关是「先别用」，不是「重新来过」。 */
export function setEnabled(s: PhoneState, enabled: boolean): PhoneState {
  return { ...s, enabled, pending: enabled ? s.pending : null }
}

/** 白名单：手机能请求的动作。不在这张表上的一律拒，不进任何业务逻辑。 */
export const ACTIONS = ['projects', 'sessions', 'files', 'file', 'newSession', 'send'] as const
export type PhoneAction = (typeof ACTIONS)[number]

/** 写操作 —— 这几个会**改变电脑上的状态**，每一次都要留痕（见 audit.ts）。
 *
 *  **不再要求逐次人工确认**（2026-08-29 拆掉）：那道闸假设你能碰到电脑，
 *  而这个功能就是为够不着电脑时用的 —— 详见 server.ts 里 newSession 那段。 */
export const WRITE_ACTIONS: readonly string[] = ['newSession', 'send']

/** 这个动作现在放不放行。**在电脑端判，不在手机端判** —— 手机是不可信客户端，
 *  它界面上没有的功能，协议层面也必须没有。
 *
 *  readOnly = 只读档：所有写操作一律拒，即使协议上认得这个名字 ——
 *  藏起手机上的按钮不算白名单。 */
export function isAllowed(action: string, readOnly: boolean): action is PhoneAction {
  if (!(ACTIONS as readonly string[]).includes(action)) return false
  return readOnly ? !WRITE_ACTIONS.includes(action) : true
}
