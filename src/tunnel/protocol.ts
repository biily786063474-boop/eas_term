// 隧道的线路协议。**纯函数** —— 这层决定两件要命的事：
// 服务器会不会变成开放代理，以及别人能不能冒名顶替你的隧道。
// 两件都必须能单测，所以这里不碰 net / fs。
//
// ── 长什么样 ────────────────────────────────────────────────────
//
//   手机 ──CONNECT──▸ 隧道服务器 ◂──出站长连接── 电脑
//                          │
//                     把两头接成一根管子，**里面跑的是手机到电脑的 TLS**
//
// 服务器只搬字节：那条 TLS 在手机上加密、在电脑上解密，
// 两头都不是它。它没有钥匙，不是承诺不看，是看不懂。
//
// ── 为什么手机侧用 HTTP CONNECT ─────────────────────────────────
// 因为 iOS 的 URLSession 和 Android 的 OkHttp **原生就支持「走代理」**，
// 而且支持在代理之上做自定义信任评估。用 CONNECT 等于白拿了
// 「在一条管道里跑 TLS 并钉证书」这件事，一行原生代码都不用写。
// 自己发明一套协议的话，这块就得在两个平台上各实现一遍。
//
// ── 为什么电脑侧是「控制连接 + 按需数据连接」，不做多路复用 ──────
// 复用要自己实现分帧和流控，而流控正是最容易写错、错了还表现成
// 「偶尔卡住」的那类代码。每条流一条独立 TCP 的话，
// **背压是内核给的**，我们一行都不用写。
// 代价是每条流多一次握手 —— 手机端有 keep-alive，一个会话就那么一两次。
//
// ── 线路格式 ────────────────────────────────────────────────────
//
//   电脑 → 服务器（控制）  EAS-TUNNEL/1 agent <tunnelId> <agentProof>
//   电脑 → 服务器（数据）  EAS-TUNNEL/1 data <tunnelId> <streamId>
//   服务器 → 电脑          EAS-TUNNEL/1 ok        /  EAS-TUNNEL/1 error <原因>
//   服务器 → 电脑（控制上） open <streamId>
//   电脑 → 服务器（控制上） ping
//
// 一行一条，`\n` 结尾。行长有上限 —— 不设的话一条不换行的连接就能吃穿内存。

/** 一行最多多长。最长的一行是 agent 握手：协议名 + 32 字符门牌号 + 43 字符证明，
 *  128 已经很宽松。**必须有上限**：没有的话对方不发换行就能让我们一直缓冲。 */
export const MAX_LINE = 128

/** 门牌号：sha256 的前 16 字节转十六进制。**长度和字符集都写死** ——
 *  它会被当成 DNS 名字的一段用，也会被拿去查表，宽松一点就是注入面。 */
export const TUNNEL_ID_RE = /^[0-9a-f]{32}$/

/** 手机连的主机名后缀。CONNECT 的目标必须是 `<tunnelId>.eas-term.local`。 */
export const TUNNEL_HOST_SUFFIX = '.eas-term.local'

export type Line = { ok: true; line: string; rest: Buffer } | { ok: false; reason: 'need-more' | 'too-long' }

/** 从缓冲里切一行出来。收不全就说 need-more，让调用方继续读。 */
export function takeLine(buf: Buffer): Line {
  const i = buf.indexOf(0x0a) // \n
  if (i < 0) {
    // **还没收到换行**：要么真的没收全，要么对方根本不打算发换行。
    // 靠长度区分这两种情况 —— 超了就是后者，直接掐
    return buf.length > MAX_LINE ? { ok: false, reason: 'too-long' } : { ok: false, reason: 'need-more' }
  }
  if (i > MAX_LINE) return { ok: false, reason: 'too-long' }
  // 容忍 \r\n：手机那边可能是任何 HTTP 客户端
  const end = i > 0 && buf[i - 1] === 0x0d ? i - 1 : i
  // **必须按 UTF-8 解。** 协议行本身都是 ASCII（十六进制 id、base64url），
  // latin1 看起来也没问题 —— 但 `EAS-TUNNEL/1 error <原因>` 里的原因是
  // **给人看的中文**，latin1 会把它解成一串乱码，然后原样显示在界面上。
  // 2026-08-30 写客户端测试时当场撞到：期望「服务器满了」，
  // 拿到 'æ\x9C\x8Då\x8A¡å\x99¨æ»¡äº\x86'。
  //
  // 换成 utf8 没有副作用：rest 是 Buffer 的切片，偏移按字节算，
  // 跟怎么解码这个字符串无关。
  return { ok: true, line: buf.subarray(0, end).toString('utf8'), rest: buf.subarray(i + 1) }
}

export type Hello =
  | { kind: 'agent'; tunnelId: string; proof: string }
  | { kind: 'data'; tunnelId: string; streamId: string }
  | { kind: 'bad'; reason: string }

/** 解析电脑发来的握手行。**只认这两种，其它一律 bad** —— 白名单不是黑名单。 */
export function parseHello(line: string): Hello {
  const p = line.split(' ')
  if (p[0] !== 'EAS-TUNNEL/1') return { kind: 'bad', reason: '不是这个协议' }
  if (p[1] === 'agent') {
    if (!TUNNEL_ID_RE.test(p[2] ?? '')) return { kind: 'bad', reason: '门牌号格式不对' }
    // 证明是 base64url，长度固定 —— 松了就等于给暴力猜留门
    if (!/^[A-Za-z0-9_-]{43}$/.test(p[3] ?? '')) return { kind: 'bad', reason: '缺少或格式不对的凭证' }
    return { kind: 'agent', tunnelId: p[2], proof: p[3] }
  }
  if (p[1] === 'data') {
    if (!TUNNEL_ID_RE.test(p[2] ?? '')) return { kind: 'bad', reason: '门牌号格式不对' }
    if (!/^[0-9a-f]{32}$/.test(p[3] ?? '')) return { kind: 'bad', reason: '流水号格式不对' }
    return { kind: 'data', tunnelId: p[2], streamId: p[3] }
  }
  return { kind: 'bad', reason: '不认识的角色' }
}

export type Connect =
  | { ok: true; tunnelId: string; rest: Buffer }
  | { ok: false; reason: 'need-more' | 'bad-request' | 'not-a-tunnel' }

/**
 * 解析手机发来的 HTTP CONNECT。
 *
 * **目标必须是 `<32位十六进制>.eas-term.local:443`，别的一律拒。**
 * 这一条就是「这台服务器不是开放代理」的全部实现 —— 放宽成
 * 「任意 host:port」的话，它立刻变成一台谁都能白嫖的匿名跳板，
 * 而滥用的后果（IP 被拉黑、被追责）落在运营方身上。
 */
export function parseConnect(buf: Buffer): Connect {
  // 请求头以空行结束。**先找完整的头再解析** —— 半个头解析出来的东西不能信
  // **取先出现的那个终止符，不是优先 CRLF。** 混着换行的请求里
  // `\n\n` 可能出现在 `\r\n\r\n` 之前 —— 那时候头其实已经结束了，
  // 挑后面那个会把正文的头几个字节当成头吞掉
  const crlf = buf.indexOf('\r\n\r\n')
  const lf = buf.indexOf('\n\n')
  const ends = [crlf >= 0 ? crlf + 4 : -1, lf >= 0 ? lf + 2 : -1].filter((v) => v >= 0)
  const hdrEnd = ends.length ? Math.min(...ends) : -1
  if (hdrEnd < 0) {
    // 头也有上限：8KB 还没收到空行就是不正常的东西
    return buf.length > 8192 ? { ok: false, reason: 'bad-request' } : { ok: false, reason: 'need-more' }
  }
  const first = buf.subarray(0, hdrEnd).toString('latin1').split(/\r?\n/)[0]
  const m = /^CONNECT ([^ ]+) HTTP\/1\.[01]$/.exec(first)
  if (!m) return { ok: false, reason: 'bad-request' }

  const target = m[1]
  // 端口只认 443。允许任意端口等于允许拿它扫内网
  if (!target.endsWith(':443')) return { ok: false, reason: 'not-a-tunnel' }
  const host = target.slice(0, -4)
  if (!host.endsWith(TUNNEL_HOST_SUFFIX)) return { ok: false, reason: 'not-a-tunnel' }
  const id = host.slice(0, -TUNNEL_HOST_SUFFIX.length)
  if (!TUNNEL_ID_RE.test(id)) return { ok: false, reason: 'not-a-tunnel' }

  return { ok: true, tunnelId: id, rest: buf.subarray(hdrEnd) }
}

/** 手机应该连的主机名 */
export const tunnelHost = (tunnelId: string): string => `${tunnelId}${TUNNEL_HOST_SUFFIX}`
