// 电脑侧的隧道客户端。**主动往外连**，所以不用开端口、不用动路由器、
// 不用有公网 IP，CGNAT（手机热点、部分宽带）下也能用。
//
//   这里 ──TLS 出站──▸ 隧道服务器 ◂──CONNECT── 手机
//
// 两种连接：
// · **控制连接**（一条，长期挂着）：注册门牌号，然后等服务器说「有手机要连你」
// · **数据连接**（按需，一次一条）：每来一个手机连接就新拨一条，接到本机 HTTPS 口上
//
// 不做多路复用的理由见 src/tunnel/protocol.ts：复用要自己写流控，
// 而一条流一条 TCP 的话背压是内核给的。
//
// ── 这条链路上我们**不**做的事 ────────────────────────────────────
// 数据连接建立之后就是纯字节对倒 —— 手机到本机 HTTPS 口的那条 TLS
// 在这里**不解开也解不开**（它的两端是手机和本机的 https 服务器，
// 这个模块只是中间的一段管子）。隧道服务器同理。
import net from 'node:net'
import tls from 'node:tls'

import { takeLine } from '../../tunnel/protocol.ts'

/** 控制连接上多久 ping 一次。服务器那边 90 秒没动静就当断了。 */
const PING_MS = 30_000
/** 重连退避：第一次 1 秒，翻倍到 60 秒封顶。
 *  **必须退避** —— 隧道服务器挂了的时候，几千台电脑一起每秒重试
 *  会让它永远起不来。 */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000, 60_000]

export type TunnelState = 'off' | 'connecting' | 'online' | 'error'

export interface TunnelOptions {
  /** 隧道服务器 */
  host: string
  port: number
  /** **秘密**，用来证明这条隧道归我。只在这条 TLS 里发，绝不进二维码 */
  agentKey: string
  tunnelId: string
  /** 本机 HTTPS 口 —— 手机的字节最终倒进这里 */
  localHost: string
  localPort: number
  onState: (s: TunnelState, detail?: string) => void
  /** **只给测试用**：接受自签的隧道服务器证书。
   *  生产环境隧道服务器有公共 CA 签的真证书，正常校验就行 */
  insecure?: boolean
}

export interface TunnelHandle {
  stop: () => void
  state: () => TunnelState
}

export function startTunnel(opt: TunnelOptions): TunnelHandle {
  let control: tls.TLSSocket | null = null
  let stopped = false
  let attempt = 0
  let state: TunnelState = 'connecting'
  let pingTimer: NodeJS.Timeout | null = null
  let retryTimer: NodeJS.Timeout | null = null
  /** 正在跑的数据连接。stop() 时要一起收掉，否则关了隧道手机还能连一会儿 */
  const streams = new Set<net.Socket | tls.TLSSocket>()

  const setState = (s: TunnelState, detail?: string): void => {
    if (state === s) return
    state = s
    opt.onState(s, detail)
  }

  const dial = (): tls.TLSSocket =>
    tls.connect({
      host: opt.host,
      port: opt.port,
      // 隧道服务器是公网服务，用真证书。**这里正常校验** ——
      // 钉死那套是给「手机 → 本机」那条 TLS 用的，两条不要混
      rejectUnauthorized: !opt.insecure,
      // **host 是 IP 时不能设 servername** —— Node 会当场抛
      // `Setting the TLS ServerName to an IP address is not permitted`。
      // 生产环境这里是域名所以撞不到，但本地用 127.0.0.1 一测就炸
      ...(net.isIP(opt.host) ? {} : { servername: opt.host })
    })

  /** 服务器说「有手机要连你」→ 新拨一条数据连接，接到本机 HTTPS 口上 */
  function openStream(streamId: string): void {
    if (stopped) return
    let up: tls.TLSSocket
    try {
      up = dial()
    } catch {
      return // 拨不出去就是这条流没了，控制连接不受影响
    }
    streams.add(up)
    let acked = false
    let buf: Buffer = Buffer.alloc(0)

    const cleanup = (): void => {
      streams.delete(up)
      up.destroy()
    }
    up.on('error', cleanup)
    up.on('close', () => streams.delete(up))

    up.on('secureConnect', () => {
      up.write(`EAS-TUNNEL/1 data ${opt.tunnelId} ${streamId}\n`)
    })
    up.on('data', (chunk: Buffer) => {
      if (acked) return // 已经交给 pipe 了
      buf = Buffer.concat([buf, chunk])
      const r = takeLine(buf)
      if (!r.ok) {
        if (r.reason === 'too-long') cleanup()
        return
      }
      if (r.line !== 'EAS-TUNNEL/1 ok') {
        console.log('[tunnel] 开流被拒：' + r.line)
        return cleanup()
      }
      acked = true
      const rest = Buffer.from(r.rest)
      // **立刻暂停。** 本机那条是异步连的，而在它连上之前 up 上还会来字节 ——
      // 不暂停的话这段数据会掉进「已 acked 所以直接 return」的空档里被吃掉。
      //
      // 这个 bug 一开始没被测出来：测试里手机规规矩矩等 200 才发下一句，
      // 于是这个窗口是空的。补了「粘包」测试之后当场炸出来。
      // 暂停之后这些字节留在流的内部缓冲里，pipe 一接上就会补发。
      up.pause()

      // 接到本机那个 HTTPS 口。**从这里往下就是纯字节** ——
      // 手机到本机的 TLS 在这条管子里跑，我们看不到也不需要看到
      const local = net.connect({ host: opt.localHost, port: opt.localPort })
      streams.add(local)
      const kill = (): void => {
        streams.delete(local)
        streams.delete(up)
        local.destroy()
        up.destroy()
      }
      local.on('error', kill)
      local.on('close', kill)
      up.on('close', kill)
      local.on('connect', () => {
        // **握手行之后粘着的字节要先倒过去** —— 那是手机 TLS 的第一段，
        // 丢了的话握手会一直卡着，而症状看起来像「网络慢」
        if (rest.length) local.write(rest)
        up.pipe(local)
        local.pipe(up)
      })
    })
  }

  function connect(): void {
    if (stopped) return
    setState('connecting')
    // **绝不同步抛给调用方。** 拨号失败（配置不对、参数非法）是这个模块
    // 自己的状态，不是调用方的异常 —— 抛出去的话一个配置错误就能崩掉
    // 整个手机功能的开关
    let sock: tls.TLSSocket
    try {
      sock = dial()
    } catch (e) {
      setState('error', e instanceof Error ? e.message : String(e))
      const wait = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]
      retryTimer = setTimeout(connect, wait)
      return
    }
    control = sock
    let ready = false
    let buf: Buffer = Buffer.alloc(0)

    sock.on('secureConnect', () => {
      sock.write(`EAS-TUNNEL/1 agent ${opt.tunnelId} ${opt.agentKey}\n`)
    })

    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        const r = takeLine(buf)
        if (!r.ok) {
          if (r.reason === 'too-long') sock.destroy()
          return
        }
        buf = Buffer.from(r.rest)
        if (!ready) {
          if (r.line !== 'EAS-TUNNEL/1 ok') {
            // **把服务器的原话带出去。** 「凭证对不上」和「服务器满了」
            // 用户的下一步完全不同，糊成「连不上」等于什么都没说
            setState('error', r.line.replace(/^EAS-TUNNEL\/1 error /, ''))
            sock.destroy()
            return
          }
          ready = true
          attempt = 0 // 连上了就把退避清零
          setState('online')
          pingTimer = setInterval(() => {
            try {
              sock.write('ping\n')
            } catch {
              sock.destroy()
            }
          }, PING_MS)
          continue
        }
        const m = /^open ([0-9a-f]{32})$/.exec(r.line)
        if (m) openStream(m[1])
        // 不认识的行**忽略而不是断开**：以后服务器加了新指令，
        // 老客户端不该因此掉线
      }
    })

    const onGone = (): void => {
      if (pingTimer) {
        clearInterval(pingTimer)
        pingTimer = null
      }
      if (stopped || control !== sock) return
      control = null
      // error 状态是「有明确原因」，不要被普通断线覆盖掉
      if (state !== 'error') setState('connecting')
      const wait = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]
      retryTimer = setTimeout(connect, wait)
    }
    sock.on('error', () => sock.destroy())
    sock.on('close', onGone)
  }

  connect()

  return {
    stop: (): void => {
      stopped = true
      if (pingTimer) clearInterval(pingTimer)
      if (retryTimer) clearTimeout(retryTimer)
      control?.destroy()
      control = null
      // **正在跑的流也要收掉** —— 不收的话「关了隧道」之后
      // 已经建立的连接还能继续用，那等于没关
      for (const s of streams) s.destroy()
      streams.clear()
      setState('off')
    },
    state: () => state
  }
}
