// 样本全部来自 2026-08-30 的真实复现（空配置目录跑两个 CLI），
// 不是照文档编的。fixture 在 agentChat/__fixtures__/{codex,claude}-unauthed.jsonl。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { AUTH_BEARING_TYPES, unauthedInLine, unauthedReason } from './detect.ts'

const fixture = (name: string): Record<string, unknown>[] =>
  fs
    .readFileSync(path.join(import.meta.dirname, '..', 'agentChat', '__fixtures__', name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)

// ── 真样本整体过一遍 ──────────────────────────────────────────────
test('codex 未登录的真样本里认得出来', () => {
  const hits = fixture('codex-unauthed.jsonl').map(unauthedReason).filter(Boolean)
  assert.ok(hits.length >= 2, `应该命中 error 和 turn.failed，实际 ${hits.length}`)
  assert.match(String(hits[0]), /401/)
})

test('**claude 未登录的真样本：subtype 写着 success，但它确实是没登录**', () => {
  const evs = fixture('claude-unauthed.jsonl')
  const result = evs.find((e) => e.type === 'result')
  assert.ok(result, 'fixture 里应该有 result 事件')
  // 这三个字段的组合是这条 bug 最反直觉的地方，钉死它
  assert.equal(result.subtype, 'success', '上游确实这么写的 —— 拿 subtype 判成败会漏掉')
  assert.equal(result.is_error, true, '**真正可信的是这个**')
  assert.equal(unauthedReason(result), 'Not logged in · Please run /login')
})

// ── 只看错误通道 ──────────────────────────────────────────────────
test('**模型正文里提到 401 不算掉线** —— 否则聊这个话题的人会被弹去登录', () => {
  assert.equal(
    unauthedReason({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '401 Unauthorized 的意思是没通过认证' }] }
    }),
    null
  )
  // 用户自己发的也一样
  assert.equal(unauthedReason({ type: 'user', message: { content: '我收到 401 Unauthorized' } }), null)
})

test('claude：is_error 为假时不认 —— 模型正常回答里复述了那句话也不算', () => {
  assert.equal(
    unauthedReason({ type: 'result', subtype: 'success', is_error: false, result: '你需要先 Not logged in 才会…' }),
    null
  )
})

// ── 正常事件不误伤 ────────────────────────────────────────────────
test('正常事件一律返回 null', () => {
  for (const e of [
    { type: 'thread.started', thread_id: 'x' },
    { type: 'turn.started' },
    { type: 'system', subtype: 'init' },
    { type: 'result', subtype: 'success', is_error: false, result: '写完了' },
    { type: 'error', message: 'ENOENT: no such file or directory' },
    { type: 'turn.failed', error: { message: '磁盘满了' } },
    null,
    'not an object',
    42
  ]) {
    assert.equal(unauthedReason(e), null, JSON.stringify(e))
  }
})

test('**光有 401 没有 unauthorized 不算** —— 错误通道里也可能透出别人的状态码', () => {
  assert.equal(unauthedReason({ type: 'error', message: '服务返回 401' }), null)
  assert.equal(unauthedReason({ type: 'error', message: 'HTTP 401 Unauthorized' }), 'HTTP 401 Unauthorized')
})

// ── 其它说法 ──────────────────────────────────────────────────────
test('别的常见掉线说法也认', () => {
  const yes = [
    'Invalid API key · Please run /login',
    'authentication_error: invalid x-api-key',
    'OAuth token has expired',
    'Your credentials are invalid'
  ]
  for (const m of yes) assert.ok(unauthedReason({ type: 'error', message: m }), m)
})

test('两个词隔得太远不算 —— 避免整段长错误里凑巧同时出现', () => {
  const far = '401 ' + 'x'.repeat(200) + ' unauthorized'
  assert.equal(unauthedReason({ type: 'error', message: far }), null)
})

// ── 行版入口与前置过滤 ────────────────────────────────────────────
// unauthedInLine 为了不在热路径上做第二次 JSON.parse，先按事件类型过一道廉价过滤。
// **漏掉一个类型，对应那条判定就静默失效** —— 没有任何报错，只是从此再也认不出
// 那种掉线。下面两条测试盯着这件事。
test('**判定认的每个事件类型，前置过滤都得放行**（漏一个 = 那条判定静默死掉）', () => {
  // 拿一条一定会命中的文本，套在每个类型上单独验 ——
  // 这样删掉 AUTH_BEARING_TYPES 里任何一项都会立刻变红。
  // （上一版按关键词并集做过滤，测不出这个：样本里通常还有别的词兜住）
  const shapes: Record<string, Record<string, unknown>> = {
    error: { type: 'error', message: '401 Unauthorized' },
    'turn.failed': { type: 'turn.failed', error: { message: '401 Unauthorized' } },
    result: { type: 'result', is_error: true, result: 'Not logged in' }
  }
  for (const t of AUTH_BEARING_TYPES) {
    const o = shapes[t]
    assert.ok(o, `AUTH_BEARING_TYPES 里的 ${t} 在这条测试里没有对应样本，补一个`)
    assert.ok(unauthedReason(o), `${t}：对象版就没认出来`)
    assert.ok(unauthedInLine(JSON.stringify(o)), `**前置过滤把 ${t} 挡掉了**`)
  }
  // 反过来：高频的增量行必须在解析前就被挡住（这是这道过滤存在的理由）
  assert.equal(unauthedInLine('{"type":"stream_event","delta":"401 Unauthorized"}'), null)
})

test('前置过滤容忍 `"type" : "error"` 这种带空格的写法', () => {
  assert.ok(unauthedInLine('{"type" : "error", "message":"401 Unauthorized"}'))
})

test('对象版认得出的，行版一条都不能漏', () => {
  const positives: Record<string, unknown>[] = [
    ...fixture('codex-unauthed.jsonl'),
    ...fixture('claude-unauthed.jsonl'),
    { type: 'error', message: 'HTTP 401 Unauthorized' },
    { type: 'error', message: 'Invalid API key · Please run /login' },
    { type: 'error', message: 'authentication_error: invalid x-api-key' },
    { type: 'error', message: 'OAuth token has expired' },
    { type: 'error', message: 'Your credentials are invalid' },
    { type: 'error', message: 'request was unauthenticated' },
    { type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } },
    { type: 'result', is_error: true, result: 'Not logged in · Please run /login' }
  ]
  let checked = 0
  for (const o of positives) {
    if (!unauthedReason(o)) continue // fixture 里混着正常事件，跳过
    checked += 1
    assert.ok(
      unauthedInLine(JSON.stringify(o)),
      `前置扫描漏了这条（对象版认得出来，行版认不出）：${JSON.stringify(o).slice(0, 120)}`
    )
  }
  assert.ok(checked >= 8, `正样本太少，这条测试没意义（只检查了 ${checked} 条）`)
})

test('行版：解析不了的行不会抛', () => {
  assert.equal(unauthedInLine('{半截 401 unauthorized'), null)
  assert.equal(unauthedInLine(''), null)
  assert.equal(unauthedInLine('普通日志行'), null)
})
