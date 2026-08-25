// 把一批词条示意图排成联络表截图 —— 自动校验证明不了「图长得对不对」。
//
// 定格在几个关键时刻各拍一张：文字溢出、元素重叠、条跑出画布这些，
// 只有真渲染出来才看得见。CLAUDE.md 的规矩：没亲眼看过不算完成。
//
//   node scripts/dict-svg/shoot.mjs <batch.mjs> <导出名> [时刻ms...]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(ROOT, 'node_modules/.cache/dict-svg-shots')

export async function shoot(entries, times = [1500, 3000], cols = 4) {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify(entries))
  fs.writeFileSync(path.join(OUT, 'main.cjs'), MAIN.replace('__COLS__', cols).replace('__TIMES__', JSON.stringify(times)))
  const elec = (await import('electron')).default
  await new Promise((res) => {
    const p = spawn(elec, [path.join(OUT, 'main.cjs')], { stdio: 'inherit' })
    p.on('close', res)
  })
  return times.map((t) => path.join(OUT, `t${t}.png`))
}

const MAIN = `
const { app, BrowserWindow } = require('electron')
const fs = require('fs'); const path = require('path')
const data = require('./data.json')
const COLS = __COLS__, TIMES = __TIMES__
const ids = Object.keys(data)
const W = 268, H = 168
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const rows = Math.ceil(ids.length / COLS)
  const w = new BrowserWindow({ show: false, width: COLS * W + 24, height: rows * H + 24,
    webPreferences: { offscreen: true, backgroundThrottling: false } })
  const cells = ids.map((k) => '<figure data-k="' + k + '"><div class="s">' + data[k] + '</div><figcaption>' + k + '</figcaption></figure>').join('')
  const html = '<style>body{margin:0;background:#0b0d12;padding:12px;font:11px -apple-system,sans-serif;color:#8a8f99}' +
    'main{display:grid;grid-template-columns:repeat(' + COLS + ',1fr);gap:12px}' +
    'figure{margin:0}.s{background:#11141a;border:1px solid #222836;border-radius:8px;overflow:hidden}' +
    'svg{width:100%;height:auto;display:block}figcaption{padding:4px 2px 0;color:#5b616e}</style>' +
    '<main>' + cells + '</main>'
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 600))
  for (const t of TIMES) {
    await w.webContents.executeJavaScript(
      'document.querySelectorAll("svg").forEach(s=>{s.pauseAnimations();s.setCurrentTime(' + (t / 1000) + ')})')
    await new Promise((r) => setTimeout(r, 220))
    const img = await w.webContents.capturePage()
    fs.writeFileSync(path.join(__dirname, 't' + t + '.png'), img.toPNG())
  }
  app.exit(0)
})
`

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mod = await import(pathToFileURL(path.resolve(process.argv[2])).href)
  const entries = mod[process.argv[3] ?? Object.keys(mod)[0]]
  const times = process.argv.slice(4).map(Number)
  const files = await shoot(entries, times.length ? times : [1500, 3000])
  console.log(files.join('\n'))
}
