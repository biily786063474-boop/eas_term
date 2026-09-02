import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createOmpLoginParser } from './loginParse.ts'

/** 把一段输出喂进去，收所有事件 */
const run = (...chunks: string[]): ReturnType<ReturnType<typeof createOmpLoginParser>['push']> => {
  const p = createOmpLoginParser()
  const out: ReturnType<typeof p.push> = []
  for (const c of chunks) out.push(...p.push(c))
  return out
}

// ── 浏览器 OAuth（订阅登录的主路）─────────────────────────────────────────

test('**认出「打开这个网址」那一段** —— 网址在提示语的下一行', () => {
  // 上游 `auth-broker-cli.ts` 的 onAuth 先写一行提示语，再单独写一行完整 URL。
  // 只匹配提示语拿不到网址，只匹配 http 又会把日志里别的网址误当成登录地址。
  const evs = run('\nOpen this URL in your browser:\nhttps://auth.example.com/x?y=1\n\n')
  assert.deepEqual(evs, [{ k: 'url', url: 'https://auth.example.com/x?y=1' }])
})

test('本机快捷入口单独一行，跟在正式网址后面 —— 两个都要留住', () => {
  // 正式 URL 在 SSH 场景下才通用，本机快捷入口点起来更省事，界面上两个都该给。
  const evs = run(
    'Open this URL in your browser:\nhttps://auth.example.com/x\nLocal shortcut (this machine only): http://127.0.0.1:1455/launch\n'
  )
  assert.deepEqual(evs, [
    { k: 'url', url: 'https://auth.example.com/x', launchUrl: 'http://127.0.0.1:1455/launch' }
  ])
})

test('网址分两次到达（管道会在任意字节处切断）也要拼得回来', () => {
  const evs = run('Open this URL in your browser:\nhttps://auth.exa', 'mple.com/x\n')
  assert.deepEqual(evs, [{ k: 'url', url: 'https://auth.example.com/x' }])
})

// ── 要用户动手的那一步 ────────────────────────────────────────────────────

test('**贴码提示没有换行** —— 它是 readline 的问句，靠行尾的冒号认', () => {
  // `promptLine` 用 readline.question 写出去，**不带换行**。
  // 按行切的解析器会一直等那个换行，于是界面永远不知道该让用户输东西 ——
  // 用户看着一个不动的窗口，而 omp 正在等他。
  const evs = run('Paste the authorization code (or full redirect URL): ')
  assert.deepEqual(evs, [{ k: 'prompt', message: 'Paste the authorization code (or full redirect URL):' }])
})

test('同一句提示不重复报（输出可能被分成几块到达）', () => {
  const p = createOmpLoginParser()
  const a = p.push('Paste the authorization code: ')
  const b = p.push('') // 又一次 data 事件，内容没变
  assert.equal(a.length, 1)
  assert.deepEqual(b, [])
})

test('填 API key 那类 provider 的提问同样认得出（不是只认「贴码」）', () => {
  // 那 70 家里有的走浏览器 OAuth、有的就是引导你贴 key。**分类不该由我们猜** ——
  // omp 问什么，界面就照着问什么。
  const evs = run('Enter your API key: ')
  assert.deepEqual(evs, [{ k: 'prompt', message: 'Enter your API key:' }])
})

test('普通进度行不要被当成提问', () => {
  const evs = run('Waiting for browser callback on port 1455\n')
  assert.deepEqual(evs, [{ k: 'progress', text: 'Waiting for browser callback on port 1455' }])
})

// ── 结束 ──────────────────────────────────────────────────────────────────

test('**认出成功** —— 上游最后写的是「Credentials saved to <路径>」', () => {
  const evs = run('\nCredentials saved to /tmp/h/omp/agent/agent.db\n')
  assert.deepEqual(evs.at(-1), { k: 'done' })
})

test('提示语本身不当进度行往外报（那是给下一行网址做铺垫的）', () => {
  const evs = run('Open this URL in your browser:\nhttps://a.example.com\n')
  assert.equal(evs.filter((e) => e.k === 'progress').length, 0)
})

test('空行一律忽略', () => {
  assert.deepEqual(run('\n\n\n'), [])
})
