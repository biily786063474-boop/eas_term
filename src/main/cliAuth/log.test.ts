// 日志的测试只测一件事：**凭证不能落盘**。
// 其余（写文件、轮转）跟 session.ts 的 logSession 同一套，那边已经在跑。
// redact 单独成文件就是为了这份测试能跑 —— log.ts 引了 electron，import 不进来。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { redact } from './redact.ts'

test('OAuth 的 code / state 被抹掉', () => {
  const u = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=f_2iBR8piWrinn4kM&code_challenge=F8OucYcv'
  const r = redact(u)
  assert.ok(!r.includes('f_2iBR8piWrinn4kM'), 'state 不能留')
  assert.ok(!r.includes('F8OucYcv'), 'code_challenge 不能留')
  assert.ok(r.includes('client_id=abc'), 'client_id 不是凭证，留着有助于排障')
  assert.ok(r.includes('claude.com'), '域名要留 —— 排障时要知道去的是哪家')
})

test('设备码被抹掉', () => {
  assert.equal(redact('Enter this one-time code KC89-BN60L'), 'Enter this one-time code <设备码>')
})

test('token / key 后面的长串被抹掉', () => {
  assert.ok(!redact('token: sk-ant-abcdefghijklmnop').includes('abcdefghijklmnop'))
  assert.ok(!redact('OPENAI_API_KEY=sk-proj-0123456789abcdef').includes('0123456789abcdef'))
})

test('**普通日志不受影响** —— 抹得太狠会把排障信息也抹没', () => {
  const m = '起 claude auth status（cwd=/Users/x/proj）退出码 0'
  assert.equal(redact(m), m)
  assert.equal(redact('装 codex：npm i -g @openai/codex'), '装 codex：npm i -g @openai/codex')
})

test('短横线连接的普通词不会被当成设备码', () => {
  // `--device-auth` 这种不该被抹
  assert.ok(redact('codex login --device-auth').includes('--device-auth'))
})
