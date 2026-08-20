#!/usr/bin/env node
// 往 verify-app 起的那个实例里跑一段 JS，打印结果。
//   node scripts/eval-in-app.mjs "document.querySelectorAll('.fp-row').length"
//   node scripts/eval-in-app.mjs --file probe.js
//
// **选 target 要连名字带条件一起判**：/json/list 里不止主窗口 —— 灵动岛是另一个 page，
// 画布上每个网页节点是一个 webview。只排除 island 会连到网页节点上，
// 于是所有 querySelectorAll 都返回 0，看起来像 React 崩了。选不中就直接退出，别默默继续。

import fs from 'node:fs'

const port = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '9333'
const expr = process.argv.includes('--file')
  ? fs.readFileSync(process.argv[process.argv.indexOf('--file') + 1], 'utf8')
  : process.argv[2]
if (!expr) { console.error('用法: node scripts/eval-in-app.mjs "<js>"'); process.exit(1) }

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((p) => p.type === 'page' && p.url.includes('out/renderer') && !p.url.includes('island'))
if (!page) {
  console.error('找不到主窗口 target。现有：', list.map((p) => `${p.type} ${p.url.slice(0, 60)}`).join(' | '))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
const res = await new Promise((resolve) => {
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) resolve(m.result) }
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }))
})
ws.close()
if (res.exceptionDetails) {
  console.error('JS 抛错:', res.exceptionDetails.text, res.exceptionDetails.exception?.description?.slice(0, 300))
  process.exit(1)
}
const v = res.result.value
console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1))
