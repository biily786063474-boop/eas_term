#!/usr/bin/env node
// 渲染开销与内存累加的实测探针。**先量再改，不靠猜。**
//
//   node scripts/probe-perf.mjs blur     # 毛玻璃 A/B：开着 vs 全关，量帧时间
//   node scripts/probe-perf.mjs mem      # 内存累加：反复做同一件事，看基线涨不涨
//
// 连的是 verify-app 起的那个实例（--remote-debugging-port=9333）。
//
// ── 为什么要 A/B 而不是只量一次 ──────────────────────────────────────
// 「卡不卡」没有绝对阈值 —— 同一台机器上后台开着什么、屏幕多大、
// 有没有在公证，读数能差一倍。**唯一有意义的是同一时刻的对照**：
// 同一个实例、同一段操作，只切换 backdrop-filter 这一个变量。
//
// ── 为什么用 requestAnimationFrame 而不是 Performance.getMetrics ─────
// getMetrics 给的是累计值（LayoutDuration / RecalcStyleDuration），
// 它不告诉你**掉不掉帧**。用户说的「卡顿」是掉帧，不是某个计数器变大。
// rAF 间隔的分布（尤其 p95 和「超过 33ms 的帧占比」）才对得上人的感受。

const PORT = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '9333'
const MODE = process.argv[2] || 'blur'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find(
  (p) => p.type === 'page' && p.url.includes('out/renderer') && !p.url.includes('island')
)
if (!page) {
  console.error('找不到主窗口。现有：', list.map((p) => `${p.type} ${p.url.slice(0, 50)}`).join(' | '))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const send = (method, params) =>
  new Promise((resolve) => {
    const my = ++id
    const h = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        ws.removeEventListener('message', h)
        resolve(m.result)
      }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: my, method, params }))
  })
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}

// ── 一段固定的画布平移，边平移边采 rAF 间隔 ────────────────────────
// **平移是最坏情况**：背景一直在变，所有 backdrop-filter 层每帧都要重算。
// 静止时浏览器会缓存模糊结果，量不出差别 —— 那也正是「静止时不卡、一拖就卡」的原因。
const MEASURE = (ms) => `
(async () => {
  const st = window.__store?.getState?.()
  if (!st) return { error: '没有 __store（要用 verify-app 起的实例）' }
  const vp0 = { ...st.canvas.viewport }
  const frames = []
  let last = performance.now()
  let stop = false
  const tick = (t) => { frames.push(t - last); last = t; if (!stop) requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  // 匀速拖画布：每帧挪 6px，${ms}ms 里来回走
  const t0 = performance.now()
  while (performance.now() - t0 < ${ms}) {
    const k = performance.now() - t0
    st.setViewport({ x: vp0.x + Math.sin(k / 260) * 220, y: vp0.y + Math.cos(k / 300) * 140 })
    await new Promise((r) => requestAnimationFrame(r))
  }
  stop = true
  st.setViewport(vp0)
  const f = frames.slice(3).sort((a, b) => a - b)   // 头几帧是启动噪声
  if (!f.length) return { error: '一帧都没采到' }
  const at = (q) => f[Math.min(f.length - 1, Math.floor(f.length * q))]
  return {
    帧数: f.length,
    中位: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    最长: +f[f.length - 1].toFixed(1),
    掉帧率: +((f.filter((x) => x > 33).length / f.length) * 100).toFixed(1)
  }
})()`

/** 全局关掉 backdrop-filter。**用一张追加的样式表**，不改源码 —— 量完拿掉就复原 */
const KILL_BLUR = `
(() => {
  let el = document.getElementById('__noblur')
  if (!el) {
    el = document.createElement('style')
    el.id = '__noblur'
    document.head.appendChild(el)
  }
  el.textContent = '*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }'
  return true
})()`
const RESTORE_BLUR = `(() => { document.getElementById('__noblur')?.remove(); return true })()`

/** 现在屏幕上真的有几个 backdrop-filter 生效的元素 —— 规则数 ≠ 生效数 */
const COUNT_BLUR = `
(() => {
  let n = 0
  const seen = {}
  for (const el of document.querySelectorAll('*')) {
    const v = getComputedStyle(el).backdropFilter
    if (!v || v === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue           // 没渲染的不算
    if (r.bottom < 0 || r.top > innerHeight) continue   // 视口外的不算
    n++
    const k = (el.className && String(el.className).split(' ')[0]) || el.tagName
    seen[k] = (seen[k] || 0) + 1
  }
  return { 生效层数: n, 明细: seen }
})()`

async function blurAB() {
  const before = await evalJs(COUNT_BLUR)
  console.log('屏幕上真正生效的毛玻璃层：', JSON.stringify(before, null, 1))
  console.log('\n拖动画布 3 秒，量帧时间（毛玻璃**开着**）…')
  const on = await evalJs(MEASURE(3000))
  if (on.error) return console.error(on.error)
  console.log('  ', JSON.stringify(on))

  await evalJs(KILL_BLUR)
  await new Promise((r) => setTimeout(r, 600))
  console.log('\n同样的操作（毛玻璃**全关**）…')
  const off = await evalJs(MEASURE(3000))
  console.log('  ', JSON.stringify(off))
  await evalJs(RESTORE_BLUR)

  const d = (a, b, k) => `${k}: ${a[k]} → ${b[k]}  (${b[k] < a[k] ? '快了' : '慢了'} ${Math.abs(+(a[k] - b[k]).toFixed(1))})`
  console.log('\n── 对照 ──')
  for (const k of ['中位', 'p95', '最长', '掉帧率']) console.log('  ' + d(on, off, k))
  const gain = on.p95 - off.p95
  console.log(
    `\n结论：关掉毛玻璃后 p95 帧时间${gain > 0 ? '减少' : '增加'} ${Math.abs(gain).toFixed(1)}ms` +
      `（${on.p95 ? ((gain / on.p95) * 100).toFixed(0) : 0}%）`
  )
}

async function memory() {
  const M = `
  (async () => {
    const g = () => performance.memory
      ? { js: Math.round(performance.memory.usedJSHeapSize / 1048576) } : { js: -1 }
    const st = window.__store.getState()
    const vp0 = { ...st.canvas.viewport }
    const s = [g()]
    // 反复做同一件事：平移 + 缩放。**做完回到原位** —— 状态没变，
    // 内存却一路涨的话，那才是累加
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 60; i++) {
        st.setViewport({ x: vp0.x + i * 8, y: vp0.y + i * 5, scale: vp0.scale })
        await new Promise((r) => requestAnimationFrame(r))
      }
      st.setViewport(vp0)
      await new Promise((r) => setTimeout(r, 400))
      s.push(g())
    }
    return s
  })()`
  const s = await evalJs(M)
  console.log('JS 堆（MB），每轮 60 帧平移后采一次：')
  s.forEach((x, i) => console.log(`  ${i === 0 ? '基线' : '第' + i + '轮'}: ${x.js}`))
  if (s[0].js < 0) return console.log('\n这个实例没开 performance.memory，读不到 JS 堆')
  const grow = s[s.length - 1].js - s[0].js
  console.log(
    `\n五轮之后 ${grow >= 0 ? '涨了' : '降了'} ${Math.abs(grow)}MB。` +
      `\n**判据是「反复做同一件事，基线涨不涨」**，不是「跑一次涨了多少」——` +
      `\n涨一点是缓存和 GC 时机，一路线性爬才是累加。`
  )
}

if (MODE === 'blur') await blurAB()
else if (MODE === 'mem') await memory()
else console.error('用法: probe-perf.mjs blur|mem')
ws.close()
