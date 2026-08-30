// **样本全部是 2026-08-29 本机真跑出来的**，不是照文档编的。
// 上游改措辞时，这份测试是第一个红的地方。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  looksSucceeded,
  parseClaudeStatus,
  parseCodexStatus,
  parseLoginOutput,
  parseStatus
} from './parse.ts'

// ── 真样本 ────────────────────────────────────────────────────
const CLAUDE_STATUS_IN = `{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "/Users/biily/.claude/projects",
  "email": "biily786063474@gmail.com",
  "orgId": "dd824bab-cc29-4890-a8dd-d3107b4b1b65"
}`

const CODEX_LOGIN_DEVICE = `Welcome to Codex [v[90m0.147.0[0m]
[90mOpenAI's command-line coding agent[0m

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   [94mhttps://auth.openai.com/codex/device[0m

2. Enter this one-time code [90m(expires in 15 minutes)[0m
   [94mKC89-BN60L[0m
`

const CLAUDE_LOGIN = `Opening browser to sign in…
If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&state=f_2iBR8p
Paste code here if prompted > `

// ── 登录状态 ──────────────────────────────────────────────────
test('claude：真样本解析出已登录、方式和账号', () => {
  const r = parseClaudeStatus(CLAUDE_STATUS_IN)
  assert.equal(r?.loggedIn, true)
  assert.equal(r?.method, 'claude.ai')
  assert.equal(r?.account, 'biily786063474@gmail.com')
})

test('claude：loggedIn 为 false 就是没登录', () => {
  assert.equal(parseClaudeStatus('{"loggedIn": false}')?.loggedIn, false)
})

test('claude：JSON 前面有别的行（更新提示之类）也能解析', () => {
  const r = parseClaudeStatus('A new version is available\n{"loggedIn": true}')
  assert.equal(r?.loggedIn, true)
})

test('**claude：解析不出来返回 null，不是「未登录」**', () => {
  // 两者处置完全不同：未登录要引导登录；解析不出来说明跟上游脱节了，
  // 那时候把人推去重新登录只会让他白走一趟
  assert.equal(parseClaudeStatus(''), null)
  assert.equal(parseClaudeStatus('command not found'), null)
  assert.equal(parseClaudeStatus('{"foo":1}'), null, '没有 loggedIn 字段就是读不懂')
  assert.equal(parseClaudeStatus('{坏掉的 json'), null)
})

test('codex：真样本「Logged in using ChatGPT」', () => {
  const r = parseCodexStatus('Logged in using ChatGPT')
  assert.equal(r?.loggedIn, true)
  assert.equal(r?.method, 'ChatGPT')
})

test('codex：真样本「Not logged in」', () => {
  assert.equal(parseCodexStatus('Not logged in')?.loggedIn, false)
})

test('**codex：退出码不可信，只能看文本** —— 未登录时它也返回 0', () => {
  // 这条是最容易写错的地方：拿 code===0 当「已登录」，
  // 会让所有未登录的人都被判成已登录，然后卡在「输入就掉线」
  assert.equal(parseCodexStatus('Not logged in')?.loggedIn, false)
})

test('codex：措辞对不上就返回 null，**不做「没说没登录就算登录」的推断**', () => {
  assert.equal(parseCodexStatus('Some other message'), null)
  assert.equal(parseCodexStatus(''), null)
})

test('codex：带 ANSI 色彩也能认', () => {
  assert.equal(parseCodexStatus('[32mLogged in using ChatGPT[0m')?.loggedIn, true)
})

test('parseStatus 按 cli 分发', () => {
  assert.equal(parseStatus('claude', CLAUDE_STATUS_IN)?.loggedIn, true)
  assert.equal(parseStatus('codex', 'Not logged in')?.loggedIn, false)
})

// ── 登录流程 ──────────────────────────────────────────────────
test('codex 设备码流程：真样本里抓出链接和一次性码', () => {
  const r = parseLoginOutput('codex', CODEX_LOGIN_DEVICE)
  assert.equal(r.url, 'https://auth.openai.com/codex/device')
  assert.equal(r.code, 'KC89-BN60L')
  assert.equal(r.needsCode, undefined, 'codex 不需要我们喂码，是用户去网站输')
})

test('**设备码只在「one-time code」之后找** —— 否则 URL 里的随机串会撞上', () => {
  const fake = `1. Open https://auth.openai.com/x?state=ABCD-EFGHI\n（没有那句话）`
  assert.equal(parseLoginOutput('codex', fake).code, undefined)
})

test('claude 登录：抓出 URL，并认出它在等我们喂码', () => {
  const r = parseLoginOutput('claude', CLAUDE_LOGIN)
  assert.ok(r.url?.startsWith('https://claude.com/cai/oauth/authorize'))
  assert.equal(r.needsCode, true)
  assert.equal(r.code, undefined, 'claude 不给设备码')
})

test('URL 还没出现时不瞎猜', () => {
  assert.deepEqual(parseLoginOutput('claude', 'Opening browser to sign in…'), {})
  assert.deepEqual(parseLoginOutput('codex', 'Welcome to Codex'), {})
})

test('**分片到达也能拼出完整 URL** —— 累积解析而不是逐行', () => {
  // chunk 边界劈开一条 URL 是常态，逐行判会拿到半截
  let sofar = "If the browser did not open, visit: https://claude.com/cai/oauth/aut"
  assert.equal(parseLoginOutput('claude', sofar).url, 'https://claude.com/cai/oauth/aut')
  sofar += 'horize?code=true\nPaste code here if prompted > '
  const r = parseLoginOutput('claude', sofar)
  assert.equal(r.url, 'https://claude.com/cai/oauth/authorize?code=true')
  assert.equal(r.needsCode, true)
})

test('URL 末尾的中英文括号不会被吞进去', () => {
  assert.equal(
    parseLoginOutput('codex', '打开 https://a.example/x（然后回来）').url,
    'https://a.example/x'
  )
})

// ── 成功判定 ──────────────────────────────────────────────────
test('looksSucceeded 只是提前给个提示，**真正的判据是再查一次 status**', () => {
  assert.equal(looksSucceeded('codex', 'Successfully logged in'), true)
  assert.equal(looksSucceeded('claude', 'Logged in as foo@bar.com'), true)
  assert.equal(looksSucceeded('codex', 'Waiting for authorization…'), false)
})
