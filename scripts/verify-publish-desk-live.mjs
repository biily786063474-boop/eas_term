// 隔离实例：发布台面板已经在 Frame 里开着，数据被「绕过宿主」写进来时，面板要自己出现内容。
// 2026-10-02 用户：「已经在 frame 中打开的面板在生成之后也应该出现内容」。实际发生的是：没接好发布台的会话里，
// AI 自己起了一个 server.mjs 往数据文件里写批次 —— 宿主不知道，已开的面板一直是空的。
// 这里原样复现那条路（独立进程 + 同一个 EAS_PLUGIN_DATA），不经宿主、不连模型、不碰真实数据。
// 用法：先 electron-vite build。结果与截图到 docs/verification/publish-desk-live/（EAS_VERIFY_OUTPUT 可改）。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import assert from 'node:assert/strict'
const root = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-desk-live-')), profile = path.join(temp, 'p'), home = path.join(temp, 'h'), proj = path.join(temp, 'proj')
const out = path.join(root, process.env.EAS_VERIFY_OUTPUT ?? 'docs/verification/publish-desk-live'); for (const d of [profile, home, proj, out]) fs.mkdirSync(d, { recursive: true })
const LANG = process.env.EAS_VERIFY_LANG === 'en' ? 'en' : 'zh'
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: LANG }))
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'p', name: 'demo', path: proj, addedAt: 1 }]))
const env = { ...process.env, HOME: home, EAS_VERIFY: '1' }; for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || /TOKEN|SECRET|API_KEY|PASSWORD/.test(k)) delete env[k]
const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [root, '--remote-debugging-port=0', '--use-mock-keychain', '--user-data-dir=' + profile], { env, stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(f, label, n = 300) { for (let i = 0; i < n; i++) { const v = await f(); if (v) return v; await wait(100) } throw Error('timeout: ' + label) }
async function connect(url) { const ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r)); let id = 0; const P = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); P.get(m.id)?.(m); P.delete(m.id) }; const send = (method, params = {}) => new Promise((r) => { const k = ++id; P.set(k, r); ws.send(JSON.stringify({ id: k, method, params })) }); return { send, ev: async (x, contextId) => { const m = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }); if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description ?? 'eval failed'); return m.result?.result?.value } } }

/** 和 AI 当时一样：自己起插件的 server.mjs，经 stdio 调 desk_*，写同一个数据目录 */
function deskCall(calls) {
  const dataDir = path.join(profile, 'plugin-data', 'publish-desk')
  const child = spawn(process.execPath, [path.join(root, 'resources/plugins/publish-desk/server.mjs')], { env: { ...process.env, EAS_PLUGIN_DATA: dataDir }, stdio: ['pipe', 'pipe', 'inherit'] })
  let buf = '', id = 0; const pending = new Map()
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id !== undefined) pending.get(m.id)?.(m) } catch {} } })
  const req = (method, params) => new Promise((r) => { const k = ++id; pending.set(k, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n') })
  return (async () => {
    await req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'outside-host', version: '1' } })
    const res = []
    for (const [name, args] of calls) res.push((await req('tools/call', { name, arguments: args })).result?.structuredContent)
    child.kill()
    return res
  })()
}

const result = { lang: LANG }
try {
  const dp = await until(() => { try { return +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] } catch { return 0 } }, 'devtools port')
  const page = await connect((await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term') } catch { return null } }, 'main page')).webSocketDebuggerUrl)
  await until(() => page.ev('!!window.__store&&!!window.api?.plugins'), 'store'); await wait(1500)
  for (let i = 0; i < 30; i++) { if (await page.ev("(()=>{const b=document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()")) break; await wait(100) }
  const pluginId = await until(() => page.ev("window.api.plugins.list().then(l=>l.find(p=>p.name==='publish-desk'&&p.enabled!==false)?.id)"), 'publish-desk plugin')
  await page.ev(`(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('p',40,40);const f=window.__store.getState().canvas.frames.at(-1);s.addComponentNode(f.id,'plugin-panel',16,50,560,700,{pluginId:${JSON.stringify(pluginId)},panelId:'main'});s.setViewport({x:0,y:0,scale:1});return true})()`)
  // 面板 iframe 是独立进程（eas-plugin:// 源），在 DevTools 里是单独的 target，直接连它
  const panelTarget = await until(async () => (await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json()).find((x) => x.url.startsWith('eas-plugin://')), 'publish-desk panel target')
  const panel = await connect(panelTarget.webSocketDebuggerUrl)
  await until(() => panel.ev("!!document.getElementById('status')"), 'panel document')
  const read = () => panel.ev("({status:document.getElementById('status')?.textContent||'',batch:document.getElementById('batch')?.selectedOptions?.[0]?.textContent||'',cards:document.querySelectorAll('section.card').length})")
  await until(async () => (await read()).status, 'panel first render')
  result.before = await read()
  assert.equal(result.before.cards, 0, '一开始没有批次')

  // ① 绕过宿主写入第一个批次：面板必须自己出现内容
  await deskCall([['desk_add_batch', { title: '外部写入 · 第一批', platforms: ['xiaohongshu', 'douyin', 'bilibili'], cards: [{ platform: 'xiaohongshu', title: '第一批标题', body: '第一批正文' }] }]])
  const t0 = Date.now()
  await until(async () => (await read()).batch.includes('第一批'), 'panel shows first batch without reopening', 80)
  result.afterFirst = { ...(await read()), ms: Date.now() - t0 }
  assert.ok(result.afterFirst.cards > 0, '第一批的卡片出现了')

  // ② 面板正停在第一批时，又在外面生成了第二批：面板要切到新的
  await deskCall([['desk_add_batch', { title: '外部写入 · 第二批', platforms: ['zhihu'], cards: [{ platform: 'zhihu', title: '第二批标题', body: '第二批正文' }] }]])
  await until(async () => (await read()).batch.includes('第二批'), 'panel switches to the new batch', 80)
  result.afterSecond = await read()

  // ③ 改已有批次的卡片：面板跟着变（停在第二批上，看到新正文）
  const batchId = (await deskCall([['desk_list', {}]]))[0].batches[0].batchId
  await deskCall([['desk_update_card', { batchId, platform: 'zhihu', body: '第二批正文 · 改过' }]])
  await until(() => panel.ev("document.body.innerText.includes('第二批正文 · 改过')"), 'panel shows edited card', 80)
  result.afterEdit = true
  fs.writeFileSync(path.join(out, `panel-${LANG}.png`), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
  // 版式截图（SHOWCASE=1）：一份像样的批次 —— 多平台、一张已发布、一张有违禁词提示、几张空卡 —— 暗 / 亮 / 最大化各一张
  if (process.env.SHOWCASE) {
    const [b] = await deskCall([['desk_add_batch', { title: 'Eas-Term 0.4.123 更新宣发', note: '主推：对话图片可缩放、插件卡片不溢出。', cards: [
      { platform: 'xiaohongshu', title: '终端里也能看清 AI 生成的图了', body: '点开居中、看原图、滚轮缩放。\n\n这一版把对话里的图片查看重做了：\n· 返回图不再贴左上角\n· 自己贴的图放大看原图\n· 双击在适应窗口和 1:1 之间切换', tags: ['效率工具', 'AI', '开发者'] },
      { platform: 'douyin', title: '最好用的 AI 终端，没有之一', body: '画布、终端、对话放在一起，30 秒看懂。', tags: ['AI'] },
      { platform: 'bilibili', title: 'Eas-Term 0.4.123：对话图片查看重做', body: '演示：缩放、拖动、双击切换。' },
      { platform: 'x', title: '', body: 'Eas-Term 0.4.123: chat images now open centered, at full resolution, and zoomable.' },
      { platform: 'zhihu', title: '为什么我把 AI 对话放进了无限画布', body: '长文草稿，待补。' },
      { platform: 'linkedin', body: 'Shipping Eas-Term 0.4.123 — zoomable chat images.' },
      { platform: 'channels', title: '对话图片查看重做', body: '30 秒演示。' },
      { platform: 'reddit', title: 'I built an infinite-canvas terminal for AI CLIs', body: 'Feedback welcome.' }
    ] }]])
    await deskCall([['desk_mark', { batchId: b.batchId, platform: 'bilibili', status: 'published', url: 'https://www.bilibili.com/video/BV1xx' }], ['desk_mark', { batchId: b.batchId, platform: 'douyin', status: 'ready' }], ['desk_mark', { batchId: b.batchId, platform: 'producthunt', status: 'skipped' }]])
    await until(async () => (await read()).batch.includes('0.4.123'), 'showcase batch', 80); await wait(600)
    const shotTo = async (name) => fs.writeFileSync(path.join(out, `${name}-${LANG}.png`), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
    // 平台标识：有图标的平台出 svg，LinkedIn / 视频号出字母块
    const logos = await panel.ev("[...document.querySelectorAll('section.card')].map(c=>[c.querySelector('.name')?.textContent,c.querySelector('.logo svg')?'svg':c.querySelector('.logo.mono')?'mono':'none'])")
    result.logos = logos
    assert.ok(logos.length && logos.every(([, k]) => k !== 'none'), '每张卡片都有平台标识')
    assert.ok(logos.some(([n, k]) => n === 'LinkedIn' && k === 'mono') && logos.some(([n, k]) => n === '视频号' && k === 'mono'), 'LinkedIn / 视频号是字母块')
    await shotTo('style-dark')
    await page.ev("window.__store.getState().setTheme('light');true"); await wait(900)
    // 已开的面板要跟着切（PluginPanel 盯 <html data-theme> 发 host-context-changed）
    assert.equal(await panel.ev('document.documentElement.dataset.theme'), 'light', '切到亮色后面板跟着变')
    await shotTo('style-light')
    await page.ev("(()=>{const s=window.__store.getState();const f=s.canvas.frames.at(-1);s.setMaximizedNode({frameId:f.id,nodeId:f.nodes.at(-1).id});return true})()"); await wait(1200); await shotTo('style-light-max')
    await page.ev("window.__store.getState().setTheme('dark');true"); await wait(900); await shotTo('style-dark-max')
    result.showcase = true
  }
  result.passed = true
  console.log(JSON.stringify(result, null, 1)); console.log('PASS')
} finally {
  fs.writeFileSync(path.join(out, `result-${LANG}.json`), JSON.stringify(result, null, 1))
  app.kill('SIGTERM'); await wait(1500); try { app.kill('SIGKILL') } catch {}; fs.rmSync(temp, { recursive: true, force: true })
}
