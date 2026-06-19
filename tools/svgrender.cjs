// 用 Electron(Chromium)把 SVG 无头渲染成精确像素的 PNG —— 渐变/圆角/高光/字形全保真。
// 用法: electron tools/svgrender.cjs <svgFile> <width> <height> <outPng> [bgColor]
const { app, BrowserWindow } = require('electron')
const fs = require('fs')

const [svgFile, wS, hS, outFile, bg] = process.argv.slice(2)
const W = parseInt(wS, 10)
const H = parseInt(hS, 10)
const svg = fs.readFileSync(svgFile, 'utf8')
const html = `<!doctype html><html><head><meta charset="utf8"><style>
  html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:${bg || 'transparent'};}
  svg{display:block;width:${W}px;height:${H}px;}
</style></head><body>${svg}</body></html>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  if (app.dock) app.dock.hide()
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    transparent: !bg,
    backgroundColor: bg || '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: false }
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage()
  const out = img.resize({ width: W, height: H, quality: 'best' })
  fs.writeFileSync(outFile, out.toPNG())
  console.log(`rendered ${outFile} ${W}x${H}`)
  app.quit()
})
