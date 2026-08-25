// 在 electron 的 chromium 里定格实测 SMIL 到底动没动。由 verify.mjs 拉起。
//
//   electron probe.cjs <data.json 路径>
//
// **判据是逐条动画看它自己动的那个属性变没变**，不是看宿主元素的整体快照。
// 按快照判有一串盲区 —— 只改高度、stroke-dashoffset、滤镜的 stdDeviation
// 都不在快照里，全会被误判成死动画（手风琴、路径描边、运动模糊各栽过一次）。
const { app, BrowserWindow } = require('electron')
const data = require(process.argv[2])

app.disableHardwareAcceleration()

const PROBE = () => {
  const camel = (n) => n.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

  /** 读一个元素上「某个属性此刻的动画后取值」。
   *  n 可能是 null —— <animateMotion> 就没有 attributeName。 */
  const read = (h, n) => {
    if (!n) return null
    // ① SVG DOM 的 animVal 才是动画后的值。
    //    getAttribute() 拿到的是基值，对 SMIL 完全无感 —— 别再往判据里塞它。
    for (const k of [n, camel(n), n + 'X', camel(n) + 'X']) {
      const p = h[k]
      if (p && p.animVal !== undefined) {
        const a = p.animVal
        if (typeof a === 'number' || typeof a === 'string') return String(a)
        if (a && a.value !== undefined) return String(a.value)
        if (a && a.numberOfItems !== undefined) {
          return Array.from({ length: a.numberOfItems }, (_, i) => a.getItem(i).value).join(',')
        }
      }
    }
    // ② 表现属性走计算样式（opacity / fill / stroke-dashoffset / d …）
    const cs = getComputedStyle(h)[camel(n)]
    return cs !== undefined && cs !== '' ? String(cs) : null
  }

  /** 宿主整体快照，给 read() 读不到的情况兜底（如 animateTransform）。 */
  const shot = (h) => {
    const cs = getComputedStyle(h)
    let bb = { x: 0, y: 0, width: 0, height: 0 }
    try { bb = h.getBBox() } catch { /* 不可见元素没有 bbox，当零处理 */ }
    // **屏幕坐标是最后一道兜底。** <animateMotion> 产生的是「附加变换」，
    // 既不进 transform 属性也不进计算样式，getBBox() 又是局部坐标 ——
    // 三条路全看不见它，只有 getBoundingClientRect 躲不掉。
    const cr = h.getBoundingClientRect()
    return [cs.opacity, cs.fill, cs.transform, cs.strokeDashoffset, h.getAttribute('transform') || '',
      Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height),
      Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)].join('|')
  }

  const out = []
  for (const box of document.querySelectorAll('[data-k]')) {
    const svg = box.querySelector('svg')
    if (!svg) { out.push({ id: box.dataset.k, n: 1, tags: '没有 svg' }); continue }
    svg.pauseAnimations()
    const anims = Array.from(svg.querySelectorAll('animate,animateTransform,animateMotion'))

    // **采样点取自动画自己的 keyTimes**，不是均匀撒点：文字乱码那类字符只亮 120ms，
    // 4 秒均匀采 24 点根本落不进那个窗口，会把真动画误判成死的。
    const ts = new Set()
    for (let i = 0; i <= 16; i++) ts.add(i * 4 / 16)
    for (const a of anims) {
      const ds = a.getAttribute('dur') || '4000ms'
      const dur = parseFloat(ds) / (ds.includes('ms') ? 1000 : 1)
      for (const k of (a.getAttribute('keyTimes') || '').split(';')) {
        const t = parseFloat(k) * dur
        if (t >= 0 && t <= 4) { ts.add(Math.max(0, t - 0.008)); ts.add(Math.min(4, t + 0.008)) }
      }
    }

    const moved = new Set(), prev = new Map()
    for (const tt of Array.from(ts).sort((x, y) => x - y)) {
      svg.setCurrentTime(tt)
      for (const a of anims) {
        const h = a.parentElement
        const key = read(h, a.getAttribute('attributeName')) + '~' + shot(h)
        if (prev.has(a) && prev.get(a) !== key) moved.add(a)
        prev.set(a, key)
      }
    }
    const d = anims.filter((a) => !moved.has(a))
    if (d.length) {
      out.push({
        id: box.dataset.k,
        n: d.length,
        tags: Array.from(new Set(d.map((a) => a.parentElement.tagName + '.' + a.getAttribute('attributeName')))).join(', ')
      })
    }
  }
  return out
}

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 900, height: 600, webPreferences: { offscreen: true } })
  const html = '<body style="margin:0">' +
    Object.entries(data).map(([k, v]) => '<div data-k="' + k + '">' + v + '</div>').join('') + '</body>'
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  let dead
  try {
    dead = await w.webContents.executeJavaScript('(' + PROBE.toString() + ')()')
  } catch (e) {
    // **探针出错必须退出。** 早先没有这层，animateMotion 没有 attributeName
    // 导致探针抛错，app.exit(0) 走不到，electron 就一直挂着 ——
    // 调用方只看到「超时」，完全不知道发生了什么。
    console.log('@@ERR' + JSON.stringify(String(e && e.message || e)))
    app.exit(2)
    return
  }
  console.log('@@' + JSON.stringify(dead))
  app.exit(0)
})
