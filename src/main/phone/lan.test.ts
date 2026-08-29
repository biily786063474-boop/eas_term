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
