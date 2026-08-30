// 隧道的端到端测试：**本地把三方全跑起来**，一个字节一个字节地走完整条链路。
//
//   假手机 ──CONNECT──▸ hub ◂──TLS 出站── tunnelClient ──▸ 本机 HTTPS 服务
//                       └── 只搬字节 ──┘
//
// 这里面最要紧的一条是：**手机到本机那条 TLS 是端到端的**，
// hub 在中间只倒字节。测试里通过「手机侧拿到的证书指纹 == 本机证书的指纹」
// 来证明这件事 —— 如果 hub 在中间把 TLS 解开又重新加密（那就破了架构红线），
// 手机拿到的会是 hub 的证书，指纹对不上。
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'
import tls from 'node:tls'

import { createIdentity, pinOf } from '../main/phone/identity.ts'
import { startTunnel, type TunnelHandle } from '../main/phone/tunnelClient.ts'
import { createHub } from './hub.ts'

const tunnelIdOf = (k: string): string => crypto.createHash('sha256').update(k).digest('hex').slice(0, 32)

/** 起一整套：本机 HTTPS 服务 + hub + 隧道客户端。返回拆解函数。 */
/** 起过的东西一律登记在这儿。**即使 bringUp 中途炸了也要能收干净** ——
 *  收不干净的话事件循环一直活着，一次失败会变成「测试挂死」而不是「测试失败」，
 *  而挂死比失败难查得多（第一次跑这个测试就是这样，卡了两轮才定位）。 */
const opened: { close: (cb: () => void) => void }[] = []
const stoppable: { stop: () => void }[] = []

async function bringUp(): Promise<{
  hubPort: number
  tunnelId: string
  agentKey: string
  localPin: string
  tunnel: TunnelHandle
  hub: ReturnType<typeof createHub>
  tearDown: () => Promise<void>
}> {
  // ① 本机那个 HTTPS 服务（真实场景里是 phone/server.ts 的 secure 口）
  const localId = createIdentity('local', Date.now())
  const local = https.createServer({ key: localId.key, cert: localId.cert }, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    // **回一段够长、含多字节字符的内容**：管子把字节弄坏（截断、丢分片、
    // 按字符而不是字节切）的话，这里就对不上了
    res.end('本机说：' + req.url + '｜' + '中文测试🈳'.repeat(2000))
  })
  opened.push(local)
  await new Promise<void>((r) => local.listen(0, '127.0.0.1', () => r()))
  const localPort = (local.address() as AddressInfo).port

  // ② hub。自签证书 —— 生产环境这里是公共 CA 签的真证书
  const hubId = createIdentity('hub', Date.now())
  const hub = createHub({ key: hubId.key, cert: hubId.cert })
  opened.push(hub.server)
  await new Promise<void>((r) => hub.server.listen(0, '127.0.0.1', () => r()))
  const hubPort = (hub.server.address() as AddressInfo).port

  // ③ 隧道客户端
  const agentKey = crypto.randomBytes(32).toString('base64url')
  const tunnelId = tunnelIdOf(agentKey)
  const tunnel = startTunnel({
    host: '127.0.0.1',
    port: hubPort,
    agentKey,
    tunnelId,
    localHost: '127.0.0.1',
    localPort,
    insecure: true, // 测试里 hub 用的是自签证书
    onState: () => {}
  })
  stoppable.push(tunnel)
  await waitFor(() => tunnel.state() === 'online', '隧道没能挂上去')

  return {
    hubPort,
    tunnelId,
    agentKey,
    localPin: localId.pin,
    tunnel,
    hub,
    tearDown: async () => {
      for (const t of stoppable) t.stop()
      for (const o of opened) await new Promise<void>((r) => o.close(() => r()))
    }
  }
}

async function waitFor(cond: () => boolean, msg: string, ms = 5000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(msg)
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** 扮演手机：CONNECT 上去，然后在那条管子里跟本机做 TLS。 */
function asPhone(
  hubPort: number,
  target: string
): Promise<{ status: string; tls?: tls.TLSSocket; pin?: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port: hubPort }, () => {
      sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
    })
    let head = Buffer.alloc(0)
    const onData = (c: Buffer): void => {
      head = Buffer.concat([head, c])
      const i = head.indexOf('\r\n\r\n')
      if (i < 0) return
      sock.off('data', onData)
      const status = head.subarray(0, head.indexOf('\r\n')).toString()
      if (!status.startsWith('HTTP/1.1 200')) {
        sock.destroy()
        return resolve({ status })
      }
      // 通了 → 在这条管子里做 TLS。**不校验证书链，自己比对指纹**（app 的做法）
      const t = tls.connect({ socket: sock, rejectUnauthorized: false }, () => {
        const peer = t.getPeerX509Certificate()
        resolve({ status, tls: t, pin: peer ? pinOf(peer.publicKey) : undefined })
      })
      t.on('error', reject)
    }
    sock.on('data', onData)
    sock.on('error', reject)
  })
}

let env: Awaited<ReturnType<typeof bringUp>> | null = null
after(async () => {
  // **不走 env.tearDown** —— env 可能因为 bringUp 中途失败而是 null，
  // 而那时候恰恰有东西开着没关
  for (const t of stoppable) t.stop()
  for (const o of opened) await new Promise<void>((r) => o.close(() => r()))
})

test('**整条链路走通**：手机 → 隧道 → 电脑 → 拿到回复', async () => {
  env = await bringUp()
  const r = await asPhone(env.hubPort, `${env.tunnelId}.eas-term.local:443`)
  assert.match(r.status, /^HTTP\/1\.1 200/, '隧道没接通')
  assert.ok(r.tls)

  // 在那条 TLS 里发一个真的 HTTP 请求
  const body = await new Promise<string>((resolve, reject) => {
    const req = http.request(
      { createConnection: () => r.tls as unknown as net.Socket, path: encodeURI('/你好'), host: 'x' },
      (res) => {
        let s = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (s += c))
        res.on('end', () => resolve(s))
      }
    )
    req.on('error', reject)
    req.end()
  })
  const 期望 = '本机说：/%E4%BD%A0%E5%A5%BD｜' + '中文测试🈳'.repeat(2000)
  assert.equal(body.length, 期望.length, '长度对不上 = 管子把字节丢了或截了')
  assert.equal(body, 期望, '内容对不上 = 管子把字节弄坏了')
  r.tls?.destroy()
})

test('**TLS 是端到端的：手机拿到的是本机的证书，不是 hub 的**', async () => {
  const e = env ?? (env = await bringUp())
  const r = await asPhone(e.hubPort, `${e.tunnelId}.eas-term.local:443`)
  assert.equal(
    r.pin,
    e.localPin,
    'hub 要是在中间解开又重新加密，这里拿到的就是 hub 的证书 —— 那就破了架构红线'
  )
  r.tls?.destroy()
})

test('电脑没挂上来 → 502，而不是超时或者含糊的失败', async () => {
  const e = env ?? (env = await bringUp())
  const r = await asPhone(e.hubPort, `${'0'.repeat(32)}.eas-term.local:443`)
  // 「电脑没开」和「隧道挂了」用户的下一步完全不同，必须分得清
  assert.match(r.status, /^HTTP\/1\.1 502/)
})

test('**不是开放代理**：连别的地方一律 403', async () => {
  const e = env ?? (env = await bringUp())
  for (const t of ['www.google.com:443', '127.0.0.1:22', `${e.tunnelId}.eas-term.local:22`]) {
    const r = await asPhone(e.hubPort, t)
    assert.match(r.status, /^HTTP\/1\.1 403/, `${t} 必须被拒`)
  }
})

test('**凭证跟门牌号对不上就注册不上** —— 别人抢不走你的隧道', async () => {
  const e = env ?? (env = await bringUp())
  const before = e.hub.stats().agents
  const reply = await new Promise<string>((resolve) => {
    const s = tls.connect({ host: '127.0.0.1', port: e.hubPort, rejectUnauthorized: false }, () => {
      // 拿着**别人的门牌号**和**自己随便造的密钥**来注册
      s.write(`EAS-TUNNEL/1 agent ${e.tunnelId} ${'x'.repeat(43)}\n`)
    })
    let out = ''
    s.on('data', (c) => {
      out += String(c)
      if (out.includes('\n')) {
        resolve(out.trim())
        s.destroy()
      }
    })
    s.on('error', () => resolve('(断开)'))
  })
  assert.match(reply, /error/, '必须被拒')
  assert.equal(e.hub.stats().agents, before, '在线数不能变 —— 真正的那台不能被顶掉')
  // 真正的那台还在，链路照常
  const r = await asPhone(e.hubPort, `${e.tunnelId}.eas-term.local:443`)
  assert.match(r.status, /^HTTP\/1\.1 200/, '正主必须还在')
  r.tls?.destroy()
})

test('拿着正确的密钥重连 → 顶掉旧的那条，不是被拒', async () => {
  const e = env ?? (env = await bringUp())
  // 常见情形：电脑掉线重连，而服务器还没发现那条死连接。
  // 拒绝新连接会让电脑在旧连接超时之前一直连不上（最长 90 秒）
  const ok = await new Promise<boolean>((resolve) => {
    const s = tls.connect({ host: '127.0.0.1', port: e.hubPort, rejectUnauthorized: false }, () => {
      s.write(`EAS-TUNNEL/1 agent ${e.tunnelId} ${e.agentKey}\n`)
    })
    let out = ''
    s.on('data', (c) => {
      out += String(c)
      if (out.includes('\n')) {
        resolve(out.startsWith('EAS-TUNNEL/1 ok'))
        s.destroy()
      }
    })
    s.on('error', () => resolve(false))
  })
  assert.equal(ok, true, '正确的密钥重连必须放行')
  assert.equal(e.hub.stats().agents, 1, '顶替之后仍然只有一台，不是两台')
})

test('乱发东西的连接直接掐掉，不回任何内容', async () => {
  const e = env ?? (env = await bringUp())
  const closed = await new Promise<boolean>((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: e.hubPort }, () => s.write('HELLO?\r\n\r\n'))
    let got = ''
    s.on('data', (c) => (got += String(c)))
    // 回一句话等于确认这里有服务 —— 不回
    s.on('close', () => resolve(got === ''))
    s.on('error', () => resolve(true))
  })
  assert.equal(closed, true, '不该回任何东西')
})

// ───────────────────────────────────────────────────────────────────
// 粘包：**字节紧跟在握手后面一起到达**
//
// 上面那些测试里，手机是规规矩矩「发完 CONNECT 等 200 再说下一句」的，
// 于是「握手行后面粘着的字节」那两段代码**一次都没被跑到** ——
// 变异测试（把两处转发整行删掉）照样全绿，才把这件事照出来。
//
// 而真实世界里粘包是常态：客户端可能一次 write 两段，TCP 也可能把
// 两次 write 合进一个段。丢掉粘着的那段字节，症状是「TLS 握手卡住」，
// 看起来像网络慢 —— 最难查的那一类。
// ───────────────────────────────────────────────────────────────────

/** 一套裸的 hub + 裸 TCP 本机服务，专门看字节有没有被吞。
 *  本机侧用裸 TCP 而不是 HTTPS：这里要看的是字节，TLS 只会挡住视线。 */
async function rawSetup(): Promise<{ hubPort: number; tunnelId: string; agentKey: string }> {
  const echo = net.createServer((s) => {
    s.on('data', (c) => s.write(Buffer.concat([Buffer.from('回声:'), c])))
  })
  opened.push(echo)
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()))
  const localPort = (echo.address() as AddressInfo).port

  const hubId = createIdentity('hub2', Date.now())
  const hub = createHub({ key: hubId.key, cert: hubId.cert })
  opened.push(hub.server)
  await new Promise<void>((r) => hub.server.listen(0, '127.0.0.1', () => r()))
  const hubPort = (hub.server.address() as AddressInfo).port

  const agentKey = crypto.randomBytes(32).toString('base64url')
  const tunnelId = tunnelIdOf(agentKey)
  const tunnel = startTunnel({
    host: '127.0.0.1',
    port: hubPort,
    agentKey,
    tunnelId,
    localHost: '127.0.0.1',
    localPort,
    insecure: true,
    onState: () => {}
  })
  stoppable.push(tunnel)
  await waitFor(() => tunnel.state() === 'online', '裸测的隧道没挂上')
  return { hubPort, tunnelId, agentKey }
}

test('**CONNECT 后面粘着的字节不能丢** —— 那是 TLS 握手的第一段', async () => {
  const e = await rawSetup()
  const got = await new Promise<string>((resolve, reject) => {
    const s = net.connect({ host: '127.0.0.1', port: e.hubPort }, () => {
      // **一次 write 把两段一起发出去** —— 真实客户端和 TCP 合包都会造成这个
      s.write(`CONNECT ${e.tunnelId}.eas-term.local:443 HTTP/1.1\r\n\r\n粘在后面的字节`)
    })
    let out = ''
    s.setEncoding('utf8')
    s.on('data', (c) => {
      out += c
      if (out.includes('回声:')) {
        resolve(out)
        s.destroy()
      }
    })
    s.on('error', reject)
    setTimeout(() => reject(new Error('超时：粘着的那段字节多半被吞了')), 8000)
  })
  assert.match(got, /^HTTP\/1\.1 200/)
  assert.match(got, /回声:粘在后面的字节/, '粘在 CONNECT 后面的字节必须原样送到本机')
})

test('**电脑侧握手行后面粘着的字节也不能丢**（反方向）', async () => {
  // **这条只测 hub，不掺我们自己的客户端** —— 我们的客户端不会粘包，
  // 但 hub 这段代码声称能处理，声称了就得测。
  // （第一版写歪了：我另起了一条同门牌号的控制连接，它把旧的顶掉了，
  //   于是流给了新连上来的那个手机，而我在断言旧的那个 socket。）
  const hubId = createIdentity('hub3', Date.now())
  const hub = createHub({ key: hubId.key, cert: hubId.cert })
  opened.push(hub.server)
  await new Promise<void>((r) => hub.server.listen(0, '127.0.0.1', () => r()))
  const port = (hub.server.address() as AddressInfo).port

  const agentKey = crypto.randomBytes(32).toString('base64url')
  const tunnelId = tunnelIdOf(agentKey)

  // 手工扮演电脑：挂上控制连接
  const ctl = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
    ctl.write(`EAS-TUNNEL/1 agent ${tunnelId} ${agentKey}\n`)
  })
  stoppable.push({ stop: () => ctl.destroy() })
  ctl.setEncoding('utf8')
  let ctlOut = ''
  const openId = new Promise<string>((resolve, reject) => {
    ctl.on('data', (c) => {
      ctlOut += c
      const m = /open ([0-9a-f]{32})/.exec(ctlOut)
      if (m) resolve(m[1])
    })
    ctl.on('error', reject)
    setTimeout(() => reject(new Error('没等到 open')), 8000)
  })
  await waitFor(() => ctlOut.includes('EAS-TUNNEL/1 ok'), '控制连接没挂上')

  // 手机连进来
  const phone = net.connect({ host: '127.0.0.1', port })
  stoppable.push({ stop: () => phone.destroy() })
  await new Promise<void>((r) => phone.on('connect', () => r()))
  phone.setEncoding('utf8')
  let phoneOut = ''
  phone.on('data', (c) => (phoneOut += c))
  phone.write(`CONNECT ${tunnelId}.eas-term.local:443 HTTP/1.1\r\n\r\n`)

  const sid = await openId
  // **一次 write**：握手行 + 紧跟着的正文
  const data = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
    data.write(`EAS-TUNNEL/1 data ${tunnelId} ${sid}\n电脑先说一句`)
  })
  stoppable.push({ stop: () => data.destroy() })

  await waitFor(() => phoneOut.includes('电脑先说一句'), '粘在电脑握手行后面的字节被吞了', 8000)
  assert.match(phoneOut, /^HTTP\/1\.1 200/)
  assert.match(phoneOut, /电脑先说一句/)
})
