#!/usr/bin/env node
// 「电脑视野」插件的 MCP server —— **只读那一档**（设计稿 §三 决定 2 的 computer-view）。
//
// 三个工具：screen_list（有哪些屏幕/窗口）· screen_shot（截图）· screen_permission（权限自检）。
// **没有任何点击/键盘**，那是 act 档，另一个 server 名，尚未开放。
//
// 硬规矩（每条都对应设计稿里的一个坑）：
//   · 截图**落盘，不回 base64**（§二 B5：一张 Retina 全屏 base64 后能把上下文撑爆）
//   · 敏感窗口**默认打码**（§二 A2 / §三 决定 5）—— 拿不到窗口列表时**不整屏截**，直接报错说明
//   · 默认截**前台窗口**而不是全屏，且跳过 Eas-Term 自己（§三 决定 6 / windows.ts）
//   · `screencapture -x` 静音（§二 B6）
import readline from 'readline'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PANEL_URI = 'ui://computer/view'
const HELPER = path.join(HERE, 'bin', 'eas-windows')
/** 缩图长边上限：够模型看清，又不至于让文件大到没法在面板里显示 */
const MAX_EDGE = 1280

// ── 纯逻辑从 lib/ 来（有测试）。这里用 .mjs 跑，所以内联一份等价实现的薄封装 ──
// 注意：lib/*.ts 是给 node --test 用的真源码，本文件只做 IO 与拼装。
const REDACT_BUNDLES = [
  'com.1password.1password', 'com.agilebits.onepassword7', 'com.apple.keychainaccess',
  'com.bitwarden.desktop', 'com.lastpass.LastPass', 'com.apple.Terminal',
  'com.googlecode.iterm2', 'com.mitchellh.ghostty', 'com.apple.Passwords'
]
const REDACT_WORDS = ['password', '密码', 'secret', 'token', 'api key', 'apikey', 'credential', '私钥', 'passphrase']
const SELF = 'com.biily.easterm'

const shouldRedact = (w) => {
  const id = (w.bundleId || '').toLowerCase()
  if (id && REDACT_BUNDLES.includes(id)) return true
  const t = (w.title || '').toLowerCase()
  return !!t && REDACT_WORDS.some((k) => t.includes(k))
}
const isSelf = (w) => (w.bundleId || '').toLowerCase() === SELF
/** 不许拍的：敏感窗口 ＋ **Eas-Term 自己**。
 *  自己这条 2026-09-06 实测漏过：前台那条跳过了自己，但显式传 windowTitle:'Eas-Term' 照样截到了。
 *  我们自己的界面里有密钥柜、有别的对话、有正在写的东西 —— 截它等于把这些喂回模型，
 *  还会形成「截自己的对话再读回自己」的回环。 */
const isBlocked = (w) => shouldRedact(w) || isSelf(w)

function listWindows() {
  if (!fs.existsSync(HELPER)) return { ok: false, reason: 'no-helper' }
  try {
    const out = execFileSync(HELPER, [], { encoding: 'utf8', timeout: 5000 })
    const arr = JSON.parse(out)
    if (!Array.isArray(arr)) return { ok: false, reason: 'bad-output' }
    const windows = arr.filter((w) => (w.width || 0) >= 40 && (w.height || 0) >= 40)
    if (!windows.length) return { ok: false, reason: 'empty' }
    return { ok: true, windows }
  } catch (e) {
    return { ok: false, reason: 'bad-output', error: String(e.message || e) }
  }
}

const frontWindow = (windows) => windows.find((w) => (w.bundleId || '').toLowerCase() !== SELF) || null
const findWindow = (windows, q) => {
  const n = String(q).trim().toLowerCase()
  if (!n) return null
  return (
    windows.find((w) => (w.title || '').toLowerCase().includes(n)) ||
    windows.find((w) => (w.bundleId || '').toLowerCase() === n) ||
    windows.find((w) => (w.owner || '').toLowerCase().includes(n)) ||
    null
  )
}

/** 截图目录：userData 下（由宿主用 EAS_COMPUTER_SHOTS 传进来），退回临时目录 */
function shotsDir() {
  const d = process.env.EAS_COMPUTER_SHOTS || path.join(os.tmpdir(), 'eas-computer-shots')
  fs.mkdirSync(d, { recursive: true })
  return d
}

function run(bin, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs }, (err) => resolve(err ? { ok: false, error: String(err.message || err) } : { ok: true }))
  })
}

/** 用 sips 缩图（系统自带，零依赖）。失败就保留原图，只是大一点。 */
async function shrink(file) {
  const r = await run('/usr/bin/sips', ['-Z', String(MAX_EDGE), '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', file, '--out', file])
  return r.ok
}

async function capture(args) {
  const wins = listWindows()
  const file = path.join(shotsDir(), `shot-${Date.now()}.jpg`)

  // 打码需要窗口边界。拿不到就**不截**（宁可不给，也不能把密码拍进去发到云端）
  if (!wins.ok) {
    const why =
      wins.reason === 'no-helper'
        ? '窗口助手没编译出来（装 Xcode 命令行工具后重新构建）'
        : wins.reason === 'empty'
          ? '一个窗口都看不到 —— 可能锁屏了，或者没给「屏幕录制」权限'
          : `窗口助手输出异常：${wins.error || ''}`
    throw new Error(`不能截图：${why}。拿不到窗口列表就无法给密码管理器之类的敏感窗口打码，所以这里直接拒绝而不是冒险整屏截。`)
  }

  const sensitive = wins.windows.filter(shouldRedact) // 自己不算「敏感」，但整屏时会连自己一起拍到，见下面的提示
  let target = null
  if (args.windowTitle) {
    target = findWindow(wins.windows, args.windowTitle)
    if (!target) throw new Error(`没找到标题/应用名含「${args.windowTitle}」的窗口`)
  } else if (!args.fullScreen) {
    target = frontWindow(wins.windows)
    if (!target) throw new Error('前台只有 Eas-Term 自己，没有别的窗口可截（要截整屏请传 fullScreen: true）')
  }

  if (target && isSelf(target))
    throw new Error('不截 Eas-Term 自己的窗口 —— 里面有密钥柜和你别的对话，而且截了再喂回来是个回环。要看别的窗口请传 windowTitle。')
  if (target && shouldRedact(target)) throw new Error(`「${target.owner}」在敏感窗口清单里（密码管理器 / 终端之类），不截它`)

  if (target) {
    // 按窗口 id 截，得到的就是那个窗口，别的窗口不会入镜 —— 天然不需要打码
    const r = await run('/usr/sbin/screencapture', ['-x', '-o', '-l', String(target.id), '-t', 'jpg', file])
    if (!r.ok || !fs.existsSync(file)) throw new Error(`截图失败：${r.error || '没有产出文件'}`)
  } else {
    // 整屏：**有敏感窗口就拒绝**。一期不做像素级涂黑（那要引入图像库），
    // 用「拒绝 + 说清楚」代替，符合「宁可不给也不泄漏」。
    if (sensitive.length)
      throw new Error(
        `屏幕上开着敏感窗口（${sensitive.map((w) => w.owner).join('、')}），不做整屏截图。` +
          `可以指定 windowTitle 只截某个窗口，或者先把这些窗口最小化。`
      )
    const r = await run('/usr/sbin/screencapture', ['-x', '-t', 'jpg', file])
    if (!r.ok || !fs.existsSync(file)) throw new Error(`截图失败：${r.error || '没有产出文件'}`)
  }

  await shrink(file)
  const size = fs.statSync(file).size
  return {
    file,
    kind: target ? 'window' : 'fullscreen',
    window: target ? { id: target.id, owner: target.owner, title: target.title, bundleId: target.bundleId, bounds: { x: target.x, y: target.y, width: target.width, height: target.height } } : null,
    bytes: size,
    redactedSkipped: sensitive.map((w) => w.owner),
    note: '图已落盘，路径在 file；**不要把它 base64 读进对话**，面板里能直接看到。'
  }
}

const TOOLS = [
  {
    name: 'screen_list',
    description: '列出屏幕上的窗口（应用名、标题、位置大小），以及哪些窗口因为敏感会被拒绝截图。看屏幕之前先用它认路。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'screen_shot',
    description:
      '给屏幕拍一张照片。**默认只拍最前面那个窗口**（跳过 Eas-Term 自己）。图会落盘并显示在画布的「电脑视野」面板里，' +
      '返回的是文件路径不是图片内容 —— 不要去读它的 base64。密码管理器、终端这类窗口一律拒绝拍摄。',
    inputSchema: {
      type: 'object',
      properties: {
        windowTitle: { type: 'string', description: '只拍标题或应用名含这段文字的窗口' },
        fullScreen: { type: 'boolean', description: '拍整个屏幕（屏幕上有敏感窗口时会被拒绝）' }
      }
    },
    _meta: { 'ui/resourceUri': PANEL_URI }
  },
  {
    name: 'screen_permission',
    description: '自检：窗口助手在不在、屏幕录制权限给了没有。截图报错时先用它。',
    inputSchema: { type: 'object', properties: {} }
  }
]

async function call(name, args) {
  if (name === 'screen_list') {
    const w = listWindows()
    if (!w.ok) return { ok: false, reason: w.reason, hint: '用 screen_permission 自检' }
    return {
      windows: w.windows.map((x) => ({ owner: x.owner, title: x.title, bundleId: x.bundleId, bounds: { x: x.x, y: x.y, width: x.width, height: x.height }, sensitive: isBlocked(x) })),
      note: 'sensitive 为 true 的窗口不会被拍摄（含 Eas-Term 自己）'
    }
  }
  if (name === 'screen_shot') return await capture(args || {})
  if (name === 'screen_permission') {
    const helper = fs.existsSync(HELPER)
    const w = helper ? listWindows() : { ok: false, reason: 'no-helper' }
    return {
      helper,
      windowsVisible: w.ok ? w.windows.length : 0,
      ok: helper && w.ok,
      hint: !helper
        ? '窗口助手没编译出来：在开发机上跑 node scripts/build-computer-helper.mjs（需要 Xcode 命令行工具）'
        : w.ok
          ? '一切正常'
          : '看不到任何窗口 —— 多半是没给「屏幕录制」权限：系统设置 → 隐私与安全性 → 屏幕录制，勾上 Eas-Term，然后**重启软件**（这个权限不能由程序申请）'
    }
  }
  throw new Error(`未知工具 ${name}`)
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
const ok = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const raw = line.trim()
  if (!raw) return
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  const { id, method, params } = msg
  try {
    if (method === 'initialize') {
      ok(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'computer-view', version: '1.0.0' } })
    } else if (method?.startsWith('notifications/')) {
      // 无需响应
    } else if (method === 'tools/list') {
      ok(id, { tools: TOOLS })
    } else if (method === 'tools/call') {
      try {
        const data = await call(params?.name, params?.arguments ?? {})
        ok(id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data })
      } catch (e) {
        ok(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true })
      }
    } else if (method === 'resources/list') {
      ok(id, { resources: [{ uri: PANEL_URI, name: '电脑视野', mimeType: 'text/html;profile=mcp-app' }] })
    } else if (method === 'resources/read') {
      if (params?.uri !== PANEL_URI) return fail(id, -32602, `没有资源 ${params?.uri}`)
      ok(id, { contents: [{ uri: PANEL_URI, mimeType: 'text/html;profile=mcp-app', text: fs.readFileSync(path.join(HERE, 'ui', 'view.html'), 'utf8') }] })
    } else if (method === 'ping') {
      ok(id, {})
    } else if (id !== undefined) {
      fail(id, -32601, `不支持的方法 ${method}`)
    }
  } catch (e) {
    if (id !== undefined) fail(id, -32603, String(e.message || e))
  }
})
