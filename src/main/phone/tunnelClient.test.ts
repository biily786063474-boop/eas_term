// 隧道客户端的**失败路径**。
//
// 正常路径已经被 src/tunnel/hub.test.ts 端到端覆盖了。这份专测失败：
// 断线重连、被服务器拒、关掉之后收不收干净。
//
// **为什么这些必须测**：它们平常一次都不跑，只在出事时跑 ——
// 而「出事时才跑的代码」写错了，你是在出事的时候才知道。
// 退避尤其要紧：写错了就是几千台电脑一起每秒重试，
// 把刚上线的隧道服务器打垮，而且是它最脆弱的时候。
import assert from 'node:assert/strict'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'
import tls from 'node:tls'

import { createIdentity } from './identity.ts'
import { startTunnel, type TunnelHandle, type TunnelState } from './tunnelClient.ts'

const cleanup: (() => void)[] = []
after(() => {
  for (const f of cleanup) f()
})

/** 一个我说了算的假隧道服务器。记录每次连接的时刻，回什么由 reply 决定。 */
async function fakeHub(reply: (sock: tls.TLSSocket, n: number) => void): Promise<{
  port: number
  /** 每次有人连上来的时刻（毫秒） */
  hits: number[]
  close: () => void
}> {
  const id = createIdentity('fake-hub', Date.now())
  const hits: number[] = []
  const srv = tls.createServer({ key: id.key, cert: id.cert }, (sock) => {
    hits.push(Date.now())
    sock.on('error', () => sock.destroy())
    // **必须把收到的数据读掉。** 不读的话 socket 一直停在暂停态、
    // 缓冲里压着客户端发来的握手行，于是对端关闭时 FIN 处理不到、
    // `close` 永远不触发 —— 表现成「stop() 没把连接收掉」的**假失败**。
    // 真实的 hub 当然是读的，所以这是测试脚手架的问题，不是代码的问题。
    sock.resume()
    reply(sock, hits.length)
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as AddressInfo).port
  const close = (): void => {
    srv.close()
  }
  cleanup.push(close)
  return { port, hits, close }
}

function connect(
  port: number,
  extra: Partial<Parameters<typeof startTunnel>[0]> = {}
): { tunnel: TunnelHandle; log: { s: TunnelState; d?: string }[] } {
  const log: { s: TunnelState; d?: string }[] = []
  const tunnel = startTunnel({
    host: '127.0.0.1',
    port,
    agentKey: 'k'.repeat(43),
    tunnelId: 'a'.repeat(32),
    localHost: '127.0.0.1',
    localPort: 1,
    insecure: true,
    backoff: [40, 80, 160],
    onState: (s, d) => log.push({ s, d }),
    ...extra
  })
  cleanup.push(() => tunnel.stop())
  return { tunnel, log }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, msg: string, ms = 4000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(msg)
    await wait(10)
  }
}

test('挂上去 → online', async () => {
  const hub = await fakeHub((s) => s.write('EAS-TUNNEL/1 ok\n'))
  const { tunnel } = connect(hub.port)
  await until(() => tunnel.state() === 'online', '没挂上')
  tunnel.stop()
})

test('**被拒时把服务器的原话带出来** —— 不糊成一句「连不上」', async () => {
  // 「凭证对不上」和「服务器满了」用户的下一步完全不同
  const hub = await fakeHub((s) => s.write('EAS-TUNNEL/1 error 服务器满了\n'))
  const { tunnel, log } = connect(hub.port)
  await until(() => tunnel.state() === 'error', '没进 error 状态')
  const err = log.find((e) => e.s === 'error')
  assert.equal(err?.d, '服务器满了', '要带出原话，不是「连不上」')
  tunnel.stop()
})

test('**断线要按退避表重连，不是每秒硬敲**', async () => {
  // 每次连上就立刻掐断，看它重连的间隔
  const hub = await fakeHub((s) => s.destroy())
  const { tunnel } = connect(hub.port)
  await until(() => hub.hits.length >= 4, `只连了 ${hub.hits.length} 次`, 3000)
  tunnel.stop()

  // **判据只能是单向的。** 第一版比的是「后一段间隔要比前一段久」——
  // 机器一忙，某一段被拖长就会把顺序颠倒，测试偶发变红（全量跑时抖过一次）。
  // 定时器只会晚触发、不会早触发，所以「总耗时至少是退避表之和」这个下界
  // **负载只会让它更成立**。
  const table = [40, 80, 160]
  const total = hub.hits[3] - hub.hits[0]
  const sum = table[0] + table[1] + table[2] // 280
  assert.ok(total >= sum * 0.9, `三次重连总共才 ${total}ms，退避表之和是 ${sum}ms —— 没在退避`)
  // 对照：如果是固定按第一档重连，三次只要 120ms。差得足够远，不会误判
  assert.ok(total > table[0] * 3 * 1.5, `总共 ${total}ms，接近固定间隔重连的样子`)
})

test('**连上之后退避清零** —— 不能因为半小时前断过一次就一直等 60 秒', async () => {
  // 假 hub：连上 → 回 ok → 停 HOLD 毫秒 → 掐断。
  // **HOLD 要算进间隔里** —— 第一版忘了减它，把 30+40=70ms 的正常结果
  // 当成了「没清零」，差点去改一段本来是对的代码
  const HOLD = 30
  // **退避表故意拉开距离**：清零了是 20ms，没清零是 500ms。
  // 中间隔着 480ms 的余量，机器再忙也不会误判 ——
  // 这条的判据是个上界，而上界天生受负载影响，只能靠拉开差距来稳住
  const BIG = [20, 500, 500]
  let n = 0
  const hub = await fakeHub((s) => {
    n++
    if (n % 2 === 1) s.write('EAS-TUNNEL/1 ok\n')
    setTimeout(() => s.destroy(), HOLD)
  })
  const { tunnel, log } = connect(hub.port, { backoff: BIG })
  await until(() => hub.hits.length >= 4, `只连了 ${hub.hits.length} 次`, 6000)
  tunnel.stop()

  // 前提：它中间真的上线过。没上线过的话「清零」根本无从谈起，
  // 这条测试就会因为别的原因变绿
  assert.ok(
    log.some((e) => e.s === 'online'),
    '从没进过 online —— 这条测的前提不成立'
  )

  // **要量对地方。** 第一版量的是 hits[0]→hits[1]，可那时 attempt 本来就是 0，
  // 清不清零都一样 —— 把「清零」整行注释掉，测试照样全绿（变异测试照出来的）。
  //
  // 连接序号（0 开始）：
  //   hits[0]  第 1 条，回 ok → online → attempt 清零 → 等 BIG[0]=20，attempt→1
  //   hits[1]  第 2 条，不回 ok        → 等 BIG[1]=500，attempt→2
  //   hits[2]  第 3 条，回 ok → online → **清零** → 等 BIG[0]=20
  //   hits[3]  第 4 条
  // 所以要量的是 hits[2]→hits[3]：清零了是 HOLD+20，没清零是 HOLD+500。
  const g = hub.hits[3] - hub.hits[2]
  assert.ok(
    g < HOLD + 250,
    `失败两次之后又连上过，下一次重连却等了 ${g}ms（HOLD=${HOLD}）—— 退避没清零，` +
      `照这样断一整天之后每次都要等满 60 秒`
  )
})

test('**服务器压根不在时也要退避**，不能空转把 CPU 烧掉', async () => {
  // 起一个端口再关掉 —— 连过去就是 ECONNREFUSED
  const dead = net.createServer()
  await new Promise<void>((r) => dead.listen(0, '127.0.0.1', () => r()))
  const port = (dead.address() as AddressInfo).port
  await new Promise<void>((r) => dead.close(() => r()))

  let states = 0
  const { tunnel } = connect(port, { onState: () => states++ })
  await wait(500)
  tunnel.stop()
  // 退避表 [40,80,160] → 500ms 里最多几次。没退避的话会是几百上千次
  assert.ok(states < 40, `500ms 里状态变了 ${states} 次 —— 在空转`)
})

test('**stop 之后不再重连** —— 关了就是关了', async () => {
  const hub = await fakeHub((s) => s.destroy())
  const { tunnel } = connect(hub.port)
  await until(() => hub.hits.length >= 2, '没开始重连')
  const n = hub.hits.length
  tunnel.stop()
  assert.equal(tunnel.state(), 'off')
  await wait(400) // 远超退避表最长的 160ms
  assert.equal(hub.hits.length, n, `stop 之后又连了 ${hub.hits.length - n} 次`)
})

test('**stop 要把正在跑的流也收掉** —— 不然关了隧道外面还连得进来', async () => {
  // **本机那一侧必须是通的。** 第一版把 localPort 给了 1（连不通），
  // 于是本机连接一失败 kill() 就把这条流收了 —— 轮不到 stop() 出手，
  // 把 stop 里收流那行整个删掉测试照样全绿（变异测试照出来的）。
  // 要测 stop，这条流得**真的活到那时候**。
  const localConns: net.Socket[] = []
  const localSrv = net.createServer((s) => {
    localConns.push(s)
    s.resume()
  })
  await new Promise<void>((r) => localSrv.listen(0, '127.0.0.1', () => r()))
  const localPort = (localSrv.address() as AddressInfo).port
  cleanup.push(() => {
    localSrv.close()
  })

  const opened: tls.TLSSocket[] = []
  const hub = await fakeHub((s, n) => {
    opened.push(s)
    s.write('EAS-TUNNEL/1 ok\n')
    // 第一条是控制连接，挂上之后叫它开一条流
    if (n === 1) setTimeout(() => s.write(`open ${'b'.repeat(32)}\n`), 30)
  })
  const { tunnel } = connect(hub.port, { localPort })
  await until(() => opened.length >= 2, '数据连接没拨出来', 3000)
  await until(() => localConns.length >= 1, '没接到本机服务上', 3000)
  // 这时候两头都是活的 —— 也就是「外面正连着你电脑」的状态
  assert.ok(!opened[1].destroyed, '前提：数据连接此刻应该是活的')

  tunnel.stop()
  await until(() => opened.every((s) => s.destroyed), 'stop 之后隧道那头还活着 —— 外面还连得进来')
  await until(() => localConns.every((s) => s.destroyed), 'stop 之后本机那头还活着')
})

test('不认识的行**忽略而不是掉线** —— 以后服务器加指令，老客户端不该因此断', async () => {
  const hub = await fakeHub((s) => {
    s.write('EAS-TUNNEL/1 ok\n')
    setTimeout(() => s.write('some-future-command x y z\n'), 30)
  })
  const { tunnel } = connect(hub.port)
  await until(() => tunnel.state() === 'online', '没挂上')
  await wait(150)
  assert.equal(tunnel.state(), 'online', '收到不认识的指令就掉线了')
  assert.equal(hub.hits.length, 1, '掉线重连了')
  tunnel.stop()
})

test('**服务器发一条不换行的超长垃圾 → 掐掉**，不能一直缓冲', async () => {
  const hub = await fakeHub((s) => {
    s.write('EAS-TUNNEL/1 ok\n')
    setTimeout(() => s.write('x'.repeat(5000)), 30)
  })
  const { tunnel } = connect(hub.port)
  await until(() => tunnel.state() === 'online', '没挂上')
  // 超长行会让客户端 destroy 这条连接 → 走重连
  await until(() => hub.hits.length >= 2, '超长行没被掐掉，客户端在无限缓冲', 3000)
  tunnel.stop()
})
