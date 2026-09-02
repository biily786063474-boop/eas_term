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

// ── 2026-09-02：拿真机字节回填的两条 ───────────────────────────────────────
//
// 下面这段是**真的**从 `omp auth-broker login minimax-code-cn` 抓下来的
// （隔离配置目录，喂一把假 key）。用真字节写测试的理由：这一路上每一条
// 「界面卡住 / 界面倒日志」的 bug，都是因为我们对它的输出形状猜错了。

test('**失败时它往 stderr 倒一整段 Bun 堆栈** —— 那些行一句都不许当成「进度」显示', () => {
  const p = createOmpLoginParser()
  const real =
    '42710 |   return new Es(r, t.status, { headers: t.headers, code: o });\n' +
    '                 ^\n' +
    'ProviderHttpError: MiniMax Token Plan (China) API key validation failed (401): {"type":"error"}\n' +
    '  status: 401,\n' +
    ' headers: Headers {\n' +
    '      at dNt (/$bunfs/root/omp-darwin-arm64:42710:10)\n' +
    '      at k3 (/$bunfs/root/omp-darwin-arm64:42737:18)\n'
  const progress = p.push(real).filter((e) => e.k === 'progress')
  for (const e of progress) {
    assert.ok(!/^\d+ \|/.test(e.text), `源码回显漏出去了：${e.text}`)
    assert.ok(!/^at \S+ \(/.test(e.text), `堆栈帧漏出去了：${e.text}`)
    assert.ok(!e.text.startsWith('^'), `插入符漏出去了：${e.text}`)
    assert.ok(e.text.length <= 120, `一行 ${e.text.length} 字，那是日志不是进度：${e.text.slice(0, 60)}…`)
  }
})

test('**正常的进度句照旧透传** —— 别把过滤做成「什么都不显示」', () => {
  const p = createOmpLoginParser()
  const out = p.push('Validating API key...\n')
  assert.deepEqual(out, [{ k: 'progress', text: 'Validating API key...' }])
})

test('**进程结束时残留的半行要交出来**：最后一句不带换行就等于登录成功被丢掉', () => {
  // 「Credentials saved to …」是唯一的成功判据。它要是没带换行就留在缓冲里，
  // 我们会把一次成功的登录报成失败，而用户明明看到了那句话。
  const p = createOmpLoginParser()
  assert.deepEqual(p.push('Credentials saved to /tmp/agent.db'), [], '没换行时先不急着判')
  assert.deepEqual(p.end(), [{ k: 'done' }], 'end() 要把残留的那半行结算掉')
})

test('end() 之后再 end() 不会重复报', () => {
  const p = createOmpLoginParser()
  p.push('Credentials saved to /tmp/agent.db')
  p.end()
  assert.deepEqual(p.end(), [])
})
