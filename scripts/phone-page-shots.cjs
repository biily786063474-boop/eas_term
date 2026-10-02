// 扮演手机浏览器打开真实手机页（390×844），截 md 文档页与 AI 对话页，并回报 DOM 里真实生成的元素。
// 由 scripts/verify-phone-api.mjs 用 Electron 拉起：electron scripts/phone-page-shots.cjs
// 环境变量：PHONE_BASE / PHONE_TOKEN / PHONE_PROJ / PHONE_SID / PHONE_OUT
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const { PHONE_BASE: base, PHONE_TOKEN: token, PHONE_PROJ: proj, PHONE_SID: sid, PHONE_OUT: out } = process.env
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const report = {}
  const w = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { offscreen: true } })
  const errors = []
  w.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) errors.push(msg) })
  const js = (s) => w.webContents.executeJavaScript(s)
  const shot = async (name) => fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG())
  try {
    await w.loadURL(base + '/')
    await js(`localStorage.setItem('eas.phone.token', ${JSON.stringify(token)})`)
    await w.loadURL(base + '/')
    await sleep(1200)
    // 页面脚本整段在 IIFE 里、不留全局（见页面注释），所以像真人一样点：底部导航 → 项目卡 → 文件 / 会话
    const click = (sel, text) => js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!e)return false;e.click();return true})()`)
    const wait = async (cond) => { for (let i = 0; i < 40; i++) { if (await js(cond)) return true; await sleep(250) } return false }
    await click('#nav button', '项目'); await wait(`[...document.querySelectorAll('.card')].some(x=>x.textContent.includes('手机回归'))`)
    await click('.card', '手机回归'); await sleep(800)
    // 文档页
    await click('#nav button', '文件'); await wait(`[...document.querySelectorAll('.card')].some(x=>x.textContent.includes('notes.md'))`)
    await click('.card', 'notes.md'); await wait(`!!document.querySelector('.doc.md')`)
    report.doc = await js(`(()=>{const d=document.querySelector('.doc.md');if(!d)return null;return {h1:d.querySelectorAll('h1').length,li:d.querySelectorAll('li').length,pre:d.querySelectorAll('pre').length,code:d.querySelectorAll('code').length,strong:d.querySelectorAll('strong').length,script:document.querySelectorAll('#body script').length,scriptAsText:d.textContent.includes('<script>alert(1)</script>')}})()`)
    await shot('phone-doc.png')
    // 对话页：逐个点「对话」卡片，找到含 Markdown 回复（有 h2）的那个
    for (let k = 0; k < 4 && !(report.chat && report.chat.h2); k++) {
      await click('#nav button', '会话'); await wait(`document.querySelectorAll('.card .chip').length>0`)
      const opened = await js(`(()=>{const cs=[...document.querySelectorAll('.card')].filter(c=>[...c.querySelectorAll('.chip')].some(x=>x.textContent==='对话'));const c=cs[${k}];if(!c)return false;c.click();return true})()`)
      if (!opened) break
      await wait(`document.querySelectorAll('.bub').length>0`); await sleep(800)
      report.chat = await js(`(()=>{const b=[...document.querySelectorAll('.bub.ai.md')];const last=b[b.length-1];if(!last)return null;return {aiBubbles:b.length,h2:last.querySelectorAll('h2').length,li:last.querySelectorAll('li').length,pre:last.querySelectorAll('pre').length,userPlain:[...document.querySelectorAll('.bub.me')].every(x=>!x.classList.contains('md'))}})()`)
    }
    await js(`document.scrollingElement.scrollTop=document.scrollingElement.scrollHeight`)
    await sleep(300)
    await shot('phone-chat.png')
  } catch (e) {
    report.error = String(e && e.stack || e)
  }
  report.consoleErrors = errors
  fs.writeFileSync(path.join(out, 'phone-page.json'), JSON.stringify(report, null, 2))
  app.quit()
})
