import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAX_LINE, parseConnect, parseHello, takeLine, tunnelHost } from './protocol.ts'

const ID = 'a'.repeat(32) // 合法门牌号：32 位十六进制
const PROOF = 'p'.repeat(43) // 合法凭证：43 字符 base64url

// ───────────────────────────────────────────────────────────────────
// 这台服务器不能是开放代理 —— 这一组是整个协议里最要紧的
// ───────────────────────────────────────────────────────────────────

test('**只放行 <门牌号>.eas-term.local:443，别的一律拒**', () => {
  const req = (t: string): ReturnType<typeof parseConnect> =>
    parseConnect(Buffer.from(`CONNECT ${t} HTTP/1.1\r\nHost: ${t}\r\n\r\n`))

  assert.equal(req(`${ID}.eas-term.local:443`).ok, true, '正常的要放行')

  // 下面每一条放行了，这台机器就变成一台谁都能白嫖的匿名跳板
  for (const bad of [
    'www.google.com:443',
    'www.google.com:80',
    '127.0.0.1:22', // 拿它扫本机
    '10.0.0.1:443', // 拿它扫内网
    `${ID}.eas-term.local:22`, // 门牌号对但端口不对
    `${ID}.evil.com:443`, // 后缀不对
    `${ID}.eas-term.local.evil.com:443`, // 后缀在中间
    'eas-term.local:443', // 没有门牌号
    `${'a'.repeat(31)}.eas-term.local:443`, // 门牌号短一位
    `${'a'.repeat(33)}.eas-term.local:443`, // 长一位
    `${'A'.repeat(32)}.eas-term.local:443`, // 大写不是合法十六进制
    `${'g'.repeat(32)}.eas-term.local:443`, // g 不是十六进制
    `sub.${ID}.eas-term.local:443`, // 多一层
    // **这一条专门测「后缀检查」本身。** 上面那些坏域名其实都是被
    // 「门牌号必须正好 32 位十六进制」挡掉的 —— 后缀检查一行不留也照样全绿
    //（变异测试当场照出来了）。`.attacker.co.uk` 正好 15 个字符，
    // 跟 `.eas-term.local` 一样长，于是切出来的前 32 位恰好是合法门牌号，
    // 只有后缀检查能拦住它
    `${ID}.attacker.co.uk:443`
  ]) {
    const r = req(bad)
    assert.equal(r.ok, false, `${bad} 必须被拒`)
    if (!r.ok) assert.equal(r.reason, 'not-a-tunnel', `${bad} 的拒绝理由`)
  }
})

test('不是 CONNECT 的请求也拒 —— 别拿它当普通 HTTP 代理', () => {
  for (const line of [
    'GET http://www.google.com/ HTTP/1.1',
    'POST /api HTTP/1.1',
    `CONNECT ${ID}.eas-term.local:443 HTTP/2`, // 版本不对
    `connect ${ID}.eas-term.local:443 HTTP/1.1`, // 小写
    `CONNECT  ${ID}.eas-term.local:443 HTTP/1.1` // 两个空格
  ]) {
    const r = parseConnect(Buffer.from(`${line}\r\n\r\n`))
    assert.equal(r.ok, false, `${line} 必须被拒`)
    if (!r.ok) assert.equal(r.reason, 'bad-request')
  }
})

test('头没收全时说 need-more，不误判成坏请求', () => {
  const full = `CONNECT ${ID}.eas-term.local:443 HTTP/1.1\r\nHost: x\r\n\r\n`
  // 每一个中间长度都必须是 need-more —— 判成 bad-request 的话，
  // 一次分片就能让正常的手机连不上
  for (let n = 1; n < full.length; n++) {
    const r = parseConnect(Buffer.from(full.slice(0, n)))
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'need-more', `切到第 ${n} 字节时判错了`)
  }
  assert.equal(parseConnect(Buffer.from(full)).ok, true)
})

test('头无限长要掐掉，不能一直缓冲', () => {
  const r = parseConnect(Buffer.from('CONNECT x HTTP/1.1\r\nX: ' + 'y'.repeat(9000)))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'bad-request')
})

test('**头后面的字节要原样交出来** —— 那是 TLS 握手的第一段', () => {
  const head = `CONNECT ${ID}.eas-term.local:443 HTTP/1.1\r\n\r\n`
  // 手机很可能在同一个包里就把 ClientHello 跟着发过来了。
  // 丢掉这段的话 TLS 握手会卡死，而且看起来像「网络慢」
  const hello = Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05, 1, 2, 3, 4, 5])
  const r = parseConnect(Buffer.concat([Buffer.from(head), hello]))
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.rest, hello)
})

test('LF-only 的请求也认（不能假设对方一定发 CRLF）', () => {
  const r = parseConnect(Buffer.from(`CONNECT ${ID}.eas-term.local:443 HTTP/1.1\nHost: x\n\nAB`))
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.rest.toString(), 'AB')
})

test('混着换行时取**先出现**的终止符，别把正文吞进头', () => {
  // 头以 \n\n 结束，正文里恰好有 \r\n\r\n。挑后面那个会吞掉正文前 6 字节
  const r = parseConnect(Buffer.from(`CONNECT ${ID}.eas-term.local:443 HTTP/1.1\n\nAB\r\n\r\nCD`))
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.rest.toString(), 'AB\r\n\r\nCD')
})

// ───────────────────────────────────────────────────────────────────
// 电脑侧的握手：白名单，不是黑名单
// ───────────────────────────────────────────────────────────────────

test('agent / data 两种握手，格式全对才认', () => {
  assert.deepEqual(parseHello(`EAS-TUNNEL/1 agent ${ID} ${PROOF}`), {
    kind: 'agent',
    tunnelId: ID,
    proof: PROOF
  })
  const SID = 'b'.repeat(32)
  assert.deepEqual(parseHello(`EAS-TUNNEL/1 data ${ID} ${SID}`), {
    kind: 'data',
    tunnelId: ID,
    streamId: SID
  })
})

test('握手行任何一处不对都是 bad —— 不认识的角色一律拒', () => {
  for (const line of [
    '',
    'GET / HTTP/1.1',
    'EAS-TUNNEL/2 agent ' + ID + ' ' + PROOF, // 版本不对
    'EAS-TUNNEL/1 admin ' + ID + ' ' + PROOF, // 不认识的角色
    'EAS-TUNNEL/1 agent', // 缺参数
    'EAS-TUNNEL/1 agent ' + ID, // 缺凭证
    'EAS-TUNNEL/1 agent ' + 'a'.repeat(31) + ' ' + PROOF, // 门牌号短
    'EAS-TUNNEL/1 agent ' + ID + ' short', // 凭证短
    'EAS-TUNNEL/1 agent ' + ID + ' ' + 'p'.repeat(44), // 凭证长
    'EAS-TUNNEL/1 data ' + ID + ' nothex' // 流水号不是十六进制
  ]) {
    assert.equal(parseHello(line).kind, 'bad', `${JSON.stringify(line)} 必须被拒`)
  }
})

test('**data 握手必须带凭证之外的流水号，且流水号要够长** —— 不然能被抢流', () => {
  // 流水号猜得到的话，第三方可以抢在电脑之前接上那条流。
  // 32 位十六进制 = 128 位，猜不到
  const r = parseHello(`EAS-TUNNEL/1 data ${ID} ${'0'.repeat(32)}`)
  assert.equal(r.kind, 'data')
  assert.equal(parseHello(`EAS-TUNNEL/1 data ${ID} ${'0'.repeat(16)}`).kind, 'bad', '短流水号要拒')
})

// ───────────────────────────────────────────────────────────────────
// 切行：没有上限的话一条不发换行的连接就能吃穿内存
// ───────────────────────────────────────────────────────────────────

test('切行：收全了给行和剩下的字节', () => {
  const r = takeLine(Buffer.from('hello\nworld'))
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.line, 'hello')
    assert.equal(r.rest.toString(), 'world')
  }
})

test('切行：\\r\\n 也认', () => {
  const r = takeLine(Buffer.from('hello\r\nrest'))
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.line, 'hello')
})

test('切行：没换行且没超长 → need-more', () => {
  const r = takeLine(Buffer.from('hel'))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'need-more')
})

test('**切行：不发换行的连接要被掐掉**，不能一直缓冲', () => {
  const r = takeLine(Buffer.from('x'.repeat(MAX_LINE + 1)))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'too-long')
  // 超长的行即使最后换行了也拒
  const r2 = takeLine(Buffer.from('x'.repeat(MAX_LINE + 1) + '\n'))
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.equal(r2.reason, 'too-long')
})

test('手机该连的主机名', () => {
  assert.equal(tunnelHost(ID), `${ID}.eas-term.local`)
})
