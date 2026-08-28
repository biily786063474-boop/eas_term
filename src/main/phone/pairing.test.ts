import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  approve,
  cancelPair,
  claim,
  emptyState,
  findDevice,
  isAllowed,
  PAIR_TTL_MS,
  pairExpired,
  revoke,
  setEnabled,
  touch,
  type PhoneState
} from './pairing.ts'

const NOW = 1_000_000
const withPending = (over: Partial<PhoneState['pending'] & object> = {}): PhoneState => ({
  ...emptyState(),
  enabled: true,
  pending: { code: 'ABC123', createdAt: NOW, claimed: false, ...over }
})

// ── 配对码 ─────────────────────────────────────────────────────
test('码对、没过期 → 变成待确认，但**还没有设备**', () => {
  const r = claim(withPending(), 'ABC123', 'iPhone', NOW + 1000)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.state.pending?.claimed, true)
  assert.equal(r.state.devices.length, 0, '扫到码不等于配上')
})

test('码不对 → bad-code（**不是 expired**）', () => {
  // 这条是有意的：拿一张刚生成的码扫错了对象，被告知「过期」的话
  // 用户只会一直重刷那张根本没问题的码
  const r = claim(withPending(), '错的', 'iPhone', NOW + 1000)
  assert.deepEqual(r, { ok: false, reason: 'bad-code' })
})

test('码对但超了 60 秒 → expired', () => {
  const r = claim(withPending(), 'ABC123', 'iPhone', NOW + PAIR_TTL_MS)
  assert.deepEqual(r, { ok: false, reason: 'expired' })
})

test('差 1 毫秒还没过期', () => {
  assert.equal(claim(withPending(), 'ABC123', 'iPhone', NOW + PAIR_TTL_MS - 1).ok, true)
})

test('电脑上压根没在配对 → no-pending', () => {
  const r = claim(emptyState(), 'ABC123', 'iPhone', NOW)
  assert.deepEqual(r, { ok: false, reason: 'no-pending' })
})

test('pairExpired 的边界就是 >=', () => {
  const p = { code: 'x', createdAt: NOW, claimed: false }
  assert.equal(pairExpired(p, NOW + PAIR_TTL_MS - 1), false)
  assert.equal(pairExpired(p, NOW + PAIR_TTL_MS), true)
})

// ── 确认 ───────────────────────────────────────────────────────
test('**没被 claim 过不能 approve** —— 二维码被拍到也没用', () => {
  const r = approve(withPending(), { id: 'd1', tokenHash: 'h1' }, NOW)
  assert.deepEqual(r, { ok: false, reason: 'no-claim' })
})

test('claim 之后 approve → 产生一台设备，pending 清掉', () => {
  const c = claim(withPending(), 'ABC123', 'iPhone 15', NOW)
  assert.equal(c.ok, true)
  if (!c.ok) return
  const r = approve(c.state, { id: 'd1', tokenHash: 'h1' }, NOW)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.state.devices.length, 1)
  assert.equal(r.state.pending, null)
  assert.equal(r.device.name, 'iPhone 15')
})

test('claim 之后拖过 60 秒再 approve 也不行', () => {
  const c = claim(withPending(), 'ABC123', 'iPhone', NOW)
  assert.equal(c.ok, true)
  if (!c.ok) return
  const r = approve(c.state, { id: 'd1', tokenHash: 'h1' }, NOW + PAIR_TTL_MS)
  assert.deepEqual(r, { ok: false, reason: 'expired' })
})

test('设备名不可信：控制字符被剥掉、超长被截断、空的退回「手机」', () => {
  const nasty = 'iPhone' + String.fromCharCode(10) + '已授权 root' + String.fromCharCode(0)
  const c = claim(withPending(), 'ABC123', nasty, NOW)
  assert.equal(c.ok, true)
  if (!c.ok) return
  const r = approve(c.state, { id: 'd1', tokenHash: 'h1' }, NOW)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.device.name.includes(String.fromCharCode(10)), false, '换行能伪造出第二行提示')
  assert.equal(r.device.name.includes(String.fromCharCode(0)), false)
  assert.ok(r.device.name.length <= 24)

  const c2 = claim(withPending(), 'ABC123', '   ', NOW)
  if (!c2.ok) return
  const r2 = approve(c2.state, { id: 'd2', tokenHash: 'h2' }, NOW)
  if (!r2.ok) return
  assert.equal(r2.device.name, '手机')
})

test('cancelPair 清掉待确认，不动已配对的设备', () => {
  const c = claim(withPending(), 'ABC123', 'A', NOW)
  if (!c.ok) return
  const a = approve(c.state, { id: 'd1', tokenHash: 'h1' }, NOW)
  if (!a.ok) return
  const s = cancelPair({ ...a.state, pending: { code: 'X', createdAt: NOW, claimed: false } })
  assert.equal(s.pending, null)
  assert.equal(s.devices.length, 1)
})

// ── 设备表 ─────────────────────────────────────────────────────
test('按哈希认设备；明文对不上', () => {
  const s: PhoneState = { ...emptyState(), devices: [
    { id: 'd1', name: 'A', tokenHash: 'HASH', pairedAt: 0, lastSeenAt: 0 }
  ] }
  assert.equal(findDevice(s, 'HASH')?.id, 'd1')
  assert.equal(findDevice(s, '明文token'), null)
})

test('吊销只踢那一台', () => {
  const s: PhoneState = { ...emptyState(), devices: [
    { id: 'd1', name: 'A', tokenHash: 'h1', pairedAt: 0, lastSeenAt: 0 },
    { id: 'd2', name: 'B', tokenHash: 'h2', pairedAt: 0, lastSeenAt: 0 }
  ] }
  assert.deepEqual(revoke(s, 'd1').devices.map((d) => d.id), ['d2'])
})

test('touch 只改那一台的 lastSeenAt', () => {
  const s: PhoneState = { ...emptyState(), devices: [
    { id: 'd1', name: 'A', tokenHash: 'h1', pairedAt: 0, lastSeenAt: 0 },
    { id: 'd2', name: 'B', tokenHash: 'h2', pairedAt: 0, lastSeenAt: 0 }
  ] }
  const r = touch(s, 'd1', NOW)
  assert.equal(r.devices[0].lastSeenAt, NOW)
  assert.equal(r.devices[1].lastSeenAt, 0)
})

// ── 总开关 ─────────────────────────────────────────────────────
test('关开关清掉待确认的配对，但**不清已配对的设备**', () => {
  const s: PhoneState = {
    enabled: true,
    devices: [{ id: 'd1', name: 'A', tokenHash: 'h1', pairedAt: 0, lastSeenAt: 0 }],
    pending: { code: 'X', createdAt: NOW, claimed: false }
  }
  const off = setEnabled(s, false)
  assert.equal(off.enabled, false)
  assert.equal(off.pending, null, '关了又开不该还留着旧码')
  assert.equal(off.devices.length, 1, '关开关是「先别用」，不是「重新来过」')
})

// ── 白名单 ─────────────────────────────────────────────────────
test('白名单之外的动作一律拒', () => {
  for (const bad of ['exec', 'write', 'shell', '', 'FILE', 'projects2', '__proto__'])
    assert.equal(isAllowed(bad, true), false, bad)
})

test('只读档：三个读动作放行，**send 被拒**', () => {
  for (const ok of ['projects', 'sessions', 'files', 'file'])
    assert.equal(isAllowed(ok, true), true, ok)
  assert.equal(isAllowed('send', true), false, '藏起按钮不算白名单，协议层面也要拒')
})

test('放开写之后 send 才通', () => {
  assert.equal(isAllowed('send', false), true)
})
