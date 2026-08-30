// 隧道服务器。**只搬字节，不解密。**
//
// 它把两头接成一根管子：手机从公网连进来，电脑早先主动连出去挂在这里。
// 管子里跑的是**手机到电脑的一条完整 TLS** —— 加密在手机上做、解密在电脑上做，
// 这台机器两头都不是终点。它读不到内容不是因为承诺了不读，
// **是手里根本没有那把钥匙**。这条是架构红线，不是优化项。
//
//   手机 ──CONNECT──▸ ┌──────┐ ◂──出站长连接── 电脑
//                     │ 这里 │
//                     └──────┘  只负责把 A 的字节倒给 B
//
// ── 一个端口，按第一个字节分流 ──────────────────────────────────
//   0x16  TLS 握手 → 是电脑来挂隧道（**电脑那条必须走 TLS**，见下）
//   'C'   CONNECT  → 是手机来要一条流
//   其它  直接掐    → 不是我们的客户
//
// **电脑那条为什么必须 TLS**：它要发 agentKey 来证明「这条隧道是我的」。
// 明文发的话，路径上任何人都能抄走它、然后把发给你的连接劫走
//（劫走之后他伪造不出你的证书，手机会拒——但足以让你连不上你自己的电脑）。
// 手机那条不需要 TLS：它发的 CONNECT 里只有公开的门牌号。
//
// ── 为什么不做多路复用 ──────────────────────────────────────────
// 复用要自己实现分帧和流控，而流控是最容易写错、错了还表现成「偶尔卡住」
// 的那类代码。一条流一条 TCP 的话**背压是内核给的**，一行都不用写。
import crypto from 'node:crypto'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import tls from 'node:tls'

import { parseConnect, parseHello, takeLine } from './protocol.ts'

/** 一台电脑同时最多几条流。手机端有 keep-alive，正常就一两条；
 *  给到 32 已经很宽松。**必须有上限** —— 不然一个客户端能把服务器的
 *  文件描述符吃光，而受害的是所有其他用户。 */
const MAX_STREAMS_PER_AGENT = 32
/** 全服最多挂多少台电脑 */
const MAX_AGENTS = 2000
/** 手机连进来之后，等电脑把数据连接拨回来的时限。
 *  超了就告诉手机「电脑没响应」——**不是无限等**，那会攒下一堆半开连接 */
const STREAM_WAIT_MS = 10_000
/** 控制连接多久没动静就认为断了。电脑侧每 30 秒 ping 一次 */
const AGENT_IDLE_MS = 90_000

/** tunnelId 是 agentKey 的 sha256 前 16 字节。**单向** ——
 *  知道门牌号推不出密钥，所以冒名顶替这条路是堵死的。 */
const tunnelIdOf = (agentKey: string): string => crypto.createHash('sha256').update(agentKey).digest('hex').slice(0, 32)

/** 一句话回给手机，然后关掉。**三种失败要分开说** ——
 *  糊成一个「连接失败」等于什么都没说，用户的下一步完全不同：
 *  电脑没开 → 去开电脑；隧道满了 → 等一下；请求不对 → 是 app 的 bug。 */
function refuse(sock: Duplex, code: number, text: string): void {
  try {
    sock.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  } catch {
    /* 对方可能已经走了 */
  }
}

/** 一条等着被接上的流 */
interface Stream {
  phone: net.Socket
  /** CONNECT 头之后粘着的字节 —— 那是 TLS 的第一段，不能丢 */
  buffered: Buffer
  timer: NodeJS.Timeout
  /** 接上之后摘掉「先攒着」那个监听 */
  unstash?: () => void
}
interface Agent {
  control: Duplex
  streams: Map<string, Stream>
}
export interface HubOptions {
  /** 电脑那条走 TLS，所以要证书。**没有就不接受任何 agent** */
  key?: string
  cert?: string
  log?: (m: string) => void
}
export interface Hub {
  server: net.Server
  stats: () => { agents: number; streams: number }
  /** 测试用 */
  _agents: Map<string, Agent>
}

export function createHub({ key, cert, log = (): void => {} }: HubOptions = {}): Hub {
  const agents = new Map<string, Agent>()

  function dropAgent(id: string, why: string): void {
    const a = agents.get(id)
    if (!a) return
    agents.delete(id)
    for (const s of a.streams.values()) {
      clearTimeout(s.timer)
      refuse(s.phone, 502, 'Computer Gone')
    }
    try {
      a.control.destroy()
    } catch {
      /* 已经断了 */
    }
    log(`agent ${id.slice(0, 8)} 下线：${why}（在线 ${agents.size}）`)
  }

  // ── 电脑那一侧（TLS 之内）────────────────────────────────────
  function handleAgentSide(sock: Duplex): void {
    let buf: Buffer = Buffer.alloc(0)
    let role: 'agent' | 'data' | null = null // 握手完之前是 null

    ;(sock as net.Socket).setTimeout(AGENT_IDLE_MS)
    sock.on('timeout', () => sock.destroy())

    sock.on('data', (chunk: Buffer) => {
      if (role === 'data') return // 已经交给 pipe 了，不该再走这里
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        const r = takeLine(buf)
        if (!r.ok) {
          if (r.reason === 'too-long') sock.destroy()
          return
        }
        buf = Buffer.from(r.rest)
        if (role === 'agent') {
          // 挂上之后控制连接上只允许 ping。**别的一律掐** ——
          // 一条已鉴权的连接不代表之后想说什么都行
          if (r.line !== 'ping') return sock.destroy()
          continue
        }
        const h = parseHello(r.line)
        if (h.kind === 'bad') {
          sock.end(`EAS-TUNNEL/1 error ${h.reason}\n`)
          return
        }
        if (h.kind === 'agent') {
          // **验证：sha256(agentKey) 必须等于它声称的门牌号。**
          // 这一条就是「别人不能冒名顶替你的隧道」的全部实现
          if (tunnelIdOf(h.proof) !== h.tunnelId) {
            sock.end('EAS-TUNNEL/1 error 凭证跟门牌号对不上\n')
            return
          }
          if (agents.size >= MAX_AGENTS && !agents.has(h.tunnelId)) {
            sock.end('EAS-TUNNEL/1 error 服务器满了\n')
            return
          }
          // **同一个门牌号重复注册 → 新的顶掉旧的。**
          // 常见情形是电脑掉线重连、而服务器还没发现那条死连接。
          // 拒绝新的会让电脑在旧连接超时之前一直连不上（最长 90 秒）
          if (agents.has(h.tunnelId)) dropAgent(h.tunnelId, '被新连接顶替')
          role = 'agent'
          const entry = { control: sock, streams: new Map() }
          agents.set(h.tunnelId, entry)
          sock.write('EAS-TUNNEL/1 ok\n')
          log(`agent ${h.tunnelId.slice(0, 8)} 上线（在线 ${agents.size}）`)
          sock.on('close', () => {
            if (agents.get(h.tunnelId) === entry) dropAgent(h.tunnelId, '连接关闭')
          })
          continue
        }
        // h.kind === 'data'：电脑来接一条流
        const a = agents.get(h.tunnelId)
        const st = a?.streams.get(h.streamId)
        if (!a || !st) {
          // 流水号不对/已超时。**不说明是哪一种** —— 区分了等于告诉
          // 探测方「这个流水号曾经存在」
          sock.end('EAS-TUNNEL/1 error 没有这条流\n')
          return
        }
        a.streams.delete(h.streamId)
        clearTimeout(st.timer)
        st.unstash?.()
        role = 'data'
        sock.write('EAS-TUNNEL/1 ok\n')
        // 告诉手机通了，然后两边直接对倒
        st.phone.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        // **握手行之后可能还粘着字节**，要原样转过去，不然那段就丢了
        if (buf.length) st.phone.write(buf)
        if (st.buffered.length) sock.write(st.buffered)
        ;(sock as net.Socket).setTimeout(0) // 交给 pipe 之后不再按控制连接的空闲时限算
        pipeBoth(sock, st.phone)
        return
      }
    })
    sock.on('error', () => sock.destroy())
  }

  // ── 手机那一侧 ──────────────────────────────────────────────
  function handlePhoneSide(sock: net.Socket, firstChunk: Buffer): void {
    let buf = firstChunk
    let done = false
    const onData = (chunk: Buffer): void => {
      if (done) return
      buf = Buffer.concat([buf, chunk])
      step()
    }
    const step = (): void => {
      const r = parseConnect(buf)
      if (!r.ok) {
        if (r.reason === 'need-more') return
        done = true
        sock.off('data', onData)
        // **「不是隧道」跟「请求坏了」分开回** —— 前者多半是有人拿它
        // 当开放代理试水，后者是客户端 bug
        return refuse(sock, r.reason === 'not-a-tunnel' ? 403 : 400, 'Forbidden')
      }
      done = true
      sock.off('data', onData)
      const a = agents.get(r.tunnelId)
      if (!a) return refuse(sock, 502, 'Computer Offline')
      if (a.streams.size >= MAX_STREAMS_PER_AGENT) return refuse(sock, 429, 'Too Many Streams')

      // 流水号 128 位随机、一次性。**猜不到**：猜得到的话第三方
      // 可以抢在电脑之前接上这条流
      const streamId = crypto.randomBytes(16).toString('hex')
      const st: Stream = {
        phone: sock,
        // CONNECT 头后面粘着的字节就是 TLS 的第一段，**必须留着**
        buffered: r.rest,
        timer: setTimeout(() => {
          a.streams.delete(streamId)
          refuse(sock, 504, 'Computer Not Responding')
        }, STREAM_WAIT_MS)
      }
      a.streams.set(streamId, st)
      sock.on('close', () => {
        if (a.streams.get(streamId) === st) {
          clearTimeout(st.timer)
          a.streams.delete(streamId)
        }
      })
      // 手机后续发来的字节先攒着 —— 电脑那条还没拨回来。
      // **接上之后要把这个监听摘掉**，否则它会跟 pipe 并行地一直往
      // 一个再也不会被读的 Buffer 里堆字节（一条长连接下来就是泄漏）
      const stash = (c: Buffer): void => {
        st.buffered = Buffer.concat([st.buffered, c])
      }
      st.unstash = () => sock.off('data', stash)
      sock.on('data', stash)
      try {
        a.control.write(`open ${streamId}\n`)
      } catch {
        clearTimeout(st.timer)
        a.streams.delete(streamId)
        refuse(sock, 502, 'Computer Gone')
      }
    }
    sock.on('data', onData)
    sock.on('error', () => sock.destroy())
    step()
  }

  /** 两条 socket 对倒。**一头断了另一头也断** —— 留着半条的话
   *  手机会一直等一个永远不来的回复。 */
  function pipeBoth(a: Duplex, b: Duplex): void {
    a.pipe(b)
    b.pipe(a)
    const kill = (): void => {
      a.destroy()
      b.destroy()
    }
    a.on('error', kill)
    b.on('error', kill)
    a.on('close', kill)
    b.on('close', kill)
  }

  const server = net.createServer((sock) => {
    sock.setNoDelay(true)
    sock.once('readable', () => {
      const head = sock.read(1)
      if (!head) return sock.destroy()
      sock.unshift(head)
      if (head[0] === 0x16) {
        // TLS → 电脑来挂隧道
        if (!key || !cert) return sock.destroy()
        const t = new tls.TLSSocket(sock, { isServer: true, key, cert })
        t.on('error', () => t.destroy())
        handleAgentSide(t)
      } else if (head[0] === 0x43 /* 'C' */) {
        handlePhoneSide(sock, Buffer.alloc(0))
      } else {
        // 不是我们的客户。**不回任何东西** —— 回一句话等于确认这里有服务
        sock.destroy()
      }
    })
    sock.on('error', () => sock.destroy())
  })

  return {
    server,
    /** 运维指标。**只有数量，没有内容** —— 你不该有能力回答
     *  「某某用户昨天在干什么」，而这不靠自律，是手里没有那些数据 */
    stats: () => ({ agents: agents.size, streams: [...agents.values()].reduce((n, a) => n + a.streams.size, 0) }),
    _agents: agents
  }
}
