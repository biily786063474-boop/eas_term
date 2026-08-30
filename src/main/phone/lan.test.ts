import assert from 'node:assert/strict'
import { test } from 'node:test'

import { lanCandidates, pickLan } from './lan.ts'

const v4 = (address: string, internal = false): { family: string; internal: boolean; address: string } => ({
  family: 'IPv4',
  internal,
  address
})

test('**本机实况：WireGuard 不能压过 Wi-Fi** —— 2026-08-28 真机撞到的那个 bug', () => {
  // utun0 在 Object.entries 里排在 en0 前面，朴素的「取第一个非回环」会挑中它，
  // 于是二维码给的是隧道地址，同一个 Wi-Fi 下的手机连不上
  const ifaces = {
    lo0: [v4('127.0.0.1', true)],
    utun0: [v4('10.9.0.4')],
    utun6: [v4('198.18.0.1')],
    en0: [v4('192.168.31.126')]
  }
  assert.equal(pickLan(ifaces), '192.168.31.126')
})

test('虚拟网卡整类排除，不是靠地址段猜', () => {
  const ifaces = {
    docker0: [v4('172.17.0.1')],
    vboxnet0: [v4('192.168.56.1')],
    'br-abc123': [v4('172.18.0.1')],
    awdl0: [v4('169.254.1.2')],
    en0: [v4('10.0.0.5')]
  }
  // docker0 的 172.17 和 vboxnet0 的 192.168.56 论地址段都比 10.0.0.5 优先，
  // 但它们是虚拟网卡，一开始就不该进候选
  assert.deepEqual(lanCandidates(ifaces), [{ name: 'en0', address: '10.0.0.5' }])
})

test('地址段排序：192.168 > 172.16-31 > 10 > 其它', () => {
  const ifaces = {
    a: [v4('100.64.0.1')],
    b: [v4('10.1.1.1')],
    c: [v4('172.20.0.1')],
    d: [v4('192.168.1.5')]
  }
  assert.deepEqual(
    lanCandidates(ifaces).map((c) => c.address),
    ['192.168.1.5', '172.20.0.1', '10.1.1.1', '100.64.0.1']
  )
})

test('172 只认 16-31 那一段（172.15 和 172.32 不是私有地址）', () => {
  const ifaces = { a: [v4('172.15.0.1')], b: [v4('172.16.0.1')], c: [v4('172.32.0.1')] }
  assert.equal(lanCandidates(ifaces)[0].address, '172.16.0.1')
})

test('回环、IPv6、169.254 自分配地址都不算', () => {
  const ifaces = {
    lo0: [v4('127.0.0.1', true)],
    en0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }, v4('169.254.9.9')],
    en1: [v4('192.168.0.2')]
  }
  assert.deepEqual(lanCandidates(ifaces), [{ name: 'en1', address: '192.168.0.2' }])
})

test('family 是数字 4 的 Node 版本也认', () => {
  const ifaces = { en0: [{ family: 4 as unknown as string, internal: false, address: '192.168.1.9' }] }
  assert.equal(pickLan(ifaces), '192.168.1.9')
})

test('一个都没有（没连网）→ null，不抛', () => {
  assert.equal(pickLan({ lo0: [v4('127.0.0.1', true)] }), null)
  assert.equal(pickLan({}), null)
})

test('同一档里保持系统顺序，不抖动', () => {
  const ifaces = { en0: [v4('192.168.1.2')], en1: [v4('192.168.1.3')] }
  assert.deepEqual(lanCandidates(ifaces).map((c) => c.address), ['192.168.1.2', '192.168.1.3'])
})

test('候选带网卡名 —— 自动挑错时用户得能认出该换哪个', () => {
  const r = lanCandidates({ en0: [v4('192.168.1.2')], en5: [v4('10.0.0.9')] })
  assert.deepEqual(r, [
    { name: 'en0', address: '192.168.1.2' },
    { name: 'en5', address: '10.0.0.9' }
  ])
})

// ───────────────────────────────────────────────────────────────────
// 2026-08-30 补：Windows 上名字这条路走不通，改用 MAC 判据
//
// **这几条测试刻意用「名字表里没有」的适配器名。** 第一版不是这样写的：
// 我顺手把 vmware / hyper-v / tailscale 加进了名字表，于是测试里那些虚拟网卡
// 全被名字挡掉，MAC 判据一次都没跑到 —— 测试是绿的，但绿的理由是假的。
// 变异测试（把 OUI 判据整条删掉）照样全绿，才把这件事照出来。
// ───────────────────────────────────────────────────────────────────

/** 带 MAC 的记录。上面那个 v4() 不带 mac —— 保留它是有意的：
 *  「没给 mac」必须等于「不知道，别据此排除」，不能等于「是虚拟网卡」。 */
const m4 = (address: string, mac: string): { family: string; internal: boolean; address: string; mac: string } => ({
  family: 'IPv4',
  internal: false,
  address,
  mac
})

test('**名字认不出来的虚拟网卡，靠 MAC 认** —— Windows 的主要指望', () => {
  // 下面这些名字**一个都不匹配 VIRTUAL 正则**（开头分别是 Parallels / 本地 /
  // XenServer），只有 OUI 露馅。中文系统里更是随便本地化。
  const win = {
    'Parallels Virtual NIC': [m4('192.168.150.1', '00:1c:42:00:00:01')],
    '本地连接* 12': [m4('192.168.222.1', '00:15:5d:aa:bb:cc')],
    'XenServer PV Network Device': [m4('172.20.128.1', '00:16:3e:11:22:33')],
    无线网络连接: [m4('192.168.31.126', '9c:fc:e8:44:55:66')]
  }
  assert.deepEqual(lanCandidates(win), [{ name: '无线网络连接', address: '192.168.31.126' }])
})

test('全零 MAC = 点对点隧道，排除（名字伪装成真网卡也没用）', () => {
  const ifaces = {
    // 名字是 Windows 上再普通不过的一个，只有 MAC 说明它是隧道
    'Local Area Connection': [m4('10.9.0.4', '00:00:00:00:00:00')],
    Ethernet: [m4('192.168.1.20', 'a4:83:e7:00:11:22')]
  }
  assert.deepEqual(lanCandidates(ifaces), [{ name: 'Ethernet', address: '192.168.1.20' }])
})

test('**别用本地管理位判虚拟网卡** —— macOS 会随机化 Wi-Fi 的 MAC', () => {
  // 本机 en0 实测就是 0e:e5:68:0a:7a:3e：首字节 0x0e 的第 2 位（本地管理位）是 1。
  // 按那条规则判，用户自己的 Wi-Fi 会被排掉，而代码看着完全合理。
  // 这条测试就是钉死「不许加那条规则」。
  const mac = { en0: [m4('192.168.31.126', '0e:e5:68:0a:7a:3e')] }
  assert.equal(pickLan(mac), '192.168.31.126')
})

test('名字表仍然管用（macOS 那半），两条判据是并联不是替代', () => {
  const mac = {
    utun0: [v4('10.9.0.4')], // 没给 mac，只能靠名字
    en0: [v4('192.168.31.126')]
  }
  assert.equal(pickLan(mac), '192.168.31.126')
})

test('没给 mac 的记录照常进候选 —— 「不知道」不等于「是虚拟网卡」', () => {
  // 上面所有老测试都不带 mac，它们必须继续过
  assert.equal(pickLan({ en0: [v4('192.168.1.9')] }), '192.168.1.9')
})

// ⚠️ 这张 OUI 表**不完整，也补不完**：OpenVPN 的 TAP 适配器、Cisco AnyConnect
// 的虚拟网卡都有各自的 OUI，不在表上。真正的兜底不是这张表，而是
// 「把全部候选交给手机，让它自己试」—— 只有手机知道它能路由到哪个。
