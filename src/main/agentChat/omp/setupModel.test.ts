import { test } from 'node:test'
import assert from 'node:assert/strict'

import { authFailureInTail, nextStepOf, OMP_PROVIDERS, providerById } from './setupModel.ts'

// ── 下一步该让用户做什么 ──────────────────────────────────────────────────
//
// 这是引导面板的**唯一**判据来源。写成纯函数是因为它有六七个分支，
// 而每个分支都对应「用户此刻要做的一件不同的事」—— 合并任意两条都会把人引错方向。

const base = {
  installed: true,
  vault: { available: true, configured: true, locked: false, foreign: false },
  provider: undefined as string | undefined,
  keyInVault: false,
  model: undefined as string | undefined
}

test('二进制不在 → blocked，且**不是**「去配 provider」', () => {
  // 包坏了跟没配好是两件事：前者用户什么也做不了，后者他能自己解决。
  assert.equal(nextStepOf({ ...base, installed: false }).k, 'blocked')
})

test('系统加密不可用 / 柜子是别人的 → blocked（面板只显示一句话，没有出口）', () => {
  assert.equal(nextStepOf({ ...base, vault: { ...base.vault, available: false } }).k, 'blocked')
  assert.equal(nextStepOf({ ...base, vault: { ...base.vault, foreign: true } }).k, 'blocked')
})

test('柜子还没建 → 先建柜', () => {
  assert.equal(nextStepOf({ ...base, vault: { ...base.vault, configured: false } }).k, 'vault-setup')
})

test('柜子锁着 → 先解锁（**排在选 provider 之前**）', () => {
  // 反过来的话，用户填完 key 点保存才被打回，白填一遍。
  assert.equal(nextStepOf({ ...base, vault: { ...base.vault, locked: true } }).k, 'vault-unlock')
})

test('柜子好了但没选 provider → 选 provider', () => {
  assert.equal(nextStepOf(base).k, 'provider')
})

test('选了 provider、key 不在柜里 → 填 key', () => {
  assert.equal(nextStepOf({ ...base, provider: 'zai' }).k, 'key')
})

test('key 在柜里但没选模型 → 选模型', () => {
  assert.equal(nextStepOf({ ...base, provider: 'zai', keyInVault: true }).k, 'model')
})

test('全齐 → ready', () => {
  assert.equal(nextStepOf({ ...base, provider: 'zai', keyInVault: true, model: 'zai/glm' }).k, 'ready')
})

test('**中途锁柜要能打回来** —— 柜子 15 分钟不动会自动锁', () => {
  // 用户去找 key 找了一刻钟回来，面板不能还停在「填 key」，
  // 否则他填完点保存才撞上「柜子锁着」。
  const s = nextStepOf({ ...base, provider: 'zai', keyInVault: true, model: 'm', vault: { ...base.vault, locked: true } })
  assert.equal(s.k, 'vault-unlock')
})

// ── 冒烟失败是哪一类 ──────────────────────────────────────────────────────

test('**401 / invalid api key 认成 auth** —— 那是「key 不对」，要把人打回填 key 那步', () => {
  for (const line of [
    '{"jsonrpc":"2.0","id":1,"error":{"message":"401 Unauthorized"}}',
    'Error: invalid api key',
    'authentication_error: bad token',
    'HTTP 401'
  ]) {
    assert.equal(authFailureInTail([line]), 'auth', line)
  }
})

test('别的错误认成 unknown（原话给用户看，别硬套成 key 不对）', () => {
  assert.equal(authFailureInTail(['ECONNREFUSED 127.0.0.1:443']), 'unknown')
  assert.equal(authFailureInTail([]), 'unknown')
})

test('**不复用 cliAuth 那套判据** —— 它对 ACP 的行零命中', () => {
  // `unauthedInLine` 先用 `"type":"error|turn.failed|result"` 预过滤，
  // 而 ACP 的 JSON-RPC 行没有 type 字段，所以那条路对 omp 恒不命中。
  // 这里直接对错误原文做匹配，所以**没有 type 字段也要认得出来**。
  assert.equal(authFailureInTail(['{"error":{"code":-32000,"message":"Incorrect API key provided"}}']), 'auth')
})

// ── 服务商表 ──────────────────────────────────────────────────────────────

test('每个服务商都有取 key 的地址 —— 没有的话用户不知道去哪弄', () => {
  for (const p of OMP_PROVIDERS) assert.ok(p.keyUrl.startsWith('https://'), p.id)
})

test('服务商 id 只允许小写字母数字和横线 —— 它会被拼进环境变量名与文件路径', () => {
  for (const p of OMP_PROVIDERS) assert.match(p.id, /^[a-z0-9-]+$/)
})

test('id 不重复，且查得到', () => {
  const ids = OMP_PROVIDERS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(providerById(ids[0])?.id, ids[0])
  assert.equal(providerById('没有这个'), undefined)
})
