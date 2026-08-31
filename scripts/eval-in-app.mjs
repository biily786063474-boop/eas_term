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
// **按 title 认主窗口，别按 url。**
// 灵动岛和主窗口现在是同一个 url（都是 out/renderer，路由在渲染层内部分），
// `!url.includes('island')` 对两个都成立 —— 于是 find 拿到的是列表里排在前面的那个，
// 而那个顺序不稳定。2026-08-31 实测抓到过一次连上灵动岛：window.__store 是 undefined，
// 脚本报的是「读不到属性」而不是「连错窗口」，一时看不出来。
// 验证脚本连错窗口，会让这一整轮验证结论全部作废，比不验证更糟。
const page = list.find((p) => p.type === 'page' && p.title === 'Eas-Term')
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
