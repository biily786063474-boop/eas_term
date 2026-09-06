#!/usr/bin/env node
// 「电脑视野」插件的 MCP server。**两档能力，一个进程**（设计稿 §三 决定 2）：
//
//   view（默认可用，只读）：screen_list · screen_shot · screen_permission
//   act （要授权窗口）    ：act_status · act_click · act_type · act_key · act_scroll
//
// act 的三道闸，缺一不可：
//   ① **授权窗口**：用户在面板上点「允许操作 N 分钟」才生效，到点自动失效，没有永久选项
//      （lib/grant.ts；设计稿 §二 A5：一次开了忘掉是最危险的形态）
//   ② **拒绝名单**：绝不点 Eas-Term 自己、绝不用鼠标戳笔纵画板、破坏性组合键黑名单
//      （lib/guard.ts；§二 C1 C2）
//   ③ **系统权限 + 动作后验证**：助手里查 AXIsProcessTrusted，动作后读回鼠标位置。
//      2026-09-06 实测：没权限时 CGEvent.post **不报错、事件被静默丢弃**，
//      只信「调用没抛错」等于让模型以为点成功了继续往下做。
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
/** 授权时长档位（分钟）。**没有「永不过期」** —— lib/grant.ts 里有测试钉住 */
const GRANT_MINUTES = [5, 10, 30]
const MAX_TYPE_LEN = 500
/** 破坏性组合键：点错一次不可撤销（文件有 git 兜底，鼠标没有） */
const BLOCKED_COMBOS = [['cmd','q'],['cmd','w'],['cmd','delete'],['cmd','shift','delete'],['cmd','alt','esc'],['ctrl','alt','delete']]
/** 授权状态：全局单例（一个插件进程），多个 agent 共用同一把钥匙 */
let grant = null // { by, grantedAt, expiresAt }
/** 动作互斥：一个没做完不接第二个（§二 C5：几个 agent 同时点会互相打架） */
let acting = false

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

function grantState(now = Date.now()) {
  if (!grant) return { active: false, reason: 'never' }
  const left = grant.expiresAt - now
  if (left <= 0) return { active: false, reason: 'expired' }
  return { active: true, remainingMs: left, expiresAt: grant.expiresAt, by: grant.by }
}
function denyMessage(s) {
  const how = '在画布上那块「电脑视野」面板里点「允许操作」，选个时长。'
  if (s.reason === 'expired') return `操作授权已经到期。${how}`
  if (s.reason === 'revoked') return `操作授权刚被收回。${how}`
  return `还没有授权操作这台电脑（截图不受影响）。${how}`
}
/** 操作日志：每个动作都留痕（§三 决定 4）。面板读它，也落盘。 */
const actLog = []
function logAct(action, detail, result) {
  const row = { at: Date.now(), action, detail, result }
  actLog.push(row)
  if (actLog.length > 200) actLog.shift()
  try {
    fs.appendFileSync(path.join(shotsDir(), '..', 'act.log'), JSON.stringify(row) + '\n')
  } catch {
    /* 写不下也不影响动作本身 */
  }
}

/** 调助手的写子命令。助手自己会查权限并在动作后验证位置。 */
function helper(args, timeoutMs = 20000) {
  if (!fs.existsSync(HELPER)) throw new Error('窗口助手没编译出来，动不了鼠标键盘')
  try {
    const out = execFileSync(HELPER, args, { encoding: 'utf8', timeout: timeoutMs })
    const j = JSON.parse(out)
    if (j && j.ok === false) throw new Error(j.error || '助手拒绝了这个动作')
    return j
  } catch (e) {
    if (e && e.stdout) {
      try {
        const j = JSON.parse(e.stdout)
        if (j && j.error) throw new Error(j.error)
      } catch {
        /* 落到下面 */
      }
    }
    throw new Error(String((e && e.message) || e))
  }
}

/** act 类工具的统一前置：授权 → 互斥。目标/按键的闸在各自的工具里。 */
function requireGrant() {
  const st = grantState()
  if (!st.active) throw new Error(denyMessage(st))
  if (acting) throw new Error('上一个动作还没做完 —— 同一时刻只做一件事，避免几个 agent 抢鼠标')
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
    name: 'act_status',
    description:
      '操作授权还剩多久、系统权限给了没有。**动手之前先看这个** —— 没授权时别的 act_ 工具一律拒绝。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'act_click',
    description:
      '在屏幕上点一下。坐标是**屏幕逻辑坐标（点）**，不是截图里的像素 —— 从 screen_shot 的图上读到位置后，' +
      '按返回里的 window.bounds 自己换算，或者直接用窗口内的相对位置加上 bounds 的 x/y。' +
      '**需要先有操作授权**。绝不会点 Eas-Term 自己和笔纵画板。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '屏幕逻辑坐标 x（点）' },
        y: { type: 'number', description: '屏幕逻辑坐标 y（点）' },
        button: { type: 'string', enum: ['left', 'right'], description: '默认 left' },
        count: { type: 'number', description: '连击次数，1~3，默认 1' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'act_type',
    description: '在当前焦点处输入文本（最多 500 字）。**不读也不写剪贴板**。需要先有操作授权。',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  },
  {
    name: 'act_key',
    description:
      '按一组键，形如 ["cmd","s"]。禁 cmd+q / cmd+w / cmd+delete 这类不可撤销的。需要先有操作授权。',
    inputSchema: { type: 'object', properties: { keys: { type: 'array', items: { type: 'string' } } }, required: ['keys'] }
  },
  {
    name: 'act_scroll',
    description: '在当前鼠标位置滚动。dy 正数向下。需要先有操作授权。',
    inputSchema: { type: 'object', properties: { dx: { type: 'number' }, dy: { type: 'number' } } }
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
  if (name === 'act_status') {
    const st = grantState()
    let ax = false
    try {
      ax = !!helper(['axcheck']).axTrusted
    } catch {
      /* 助手不在 */
    }
    return {
      granted: st.active,
      remainingSeconds: st.active ? Math.ceil(st.remainingMs / 1000) : 0,
      systemPermission: ax,
      canAct: st.active && ax,
      hint: !ax
        ? '系统「辅助功能」权限没给：系统设置 → 隐私与安全性 → 辅助功能，勾上 Eas-Term，然后重启软件。（没有它，鼠标键盘事件会被静默丢弃）'
        : st.active
          ? '可以操作'
          : denyMessage(st),
      recentActions: actLog.slice(-10)
    }
  }
  if (name === 'act_click') {
    requireGrant()
    const x = Number(args.x)
    const y = Number(args.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('坐标不是数字')
    // 坐标要落在某个显示器里 —— 越界报错而不是钳到边缘（钳制会把「算错」变成「点到别的东西」）
    const disp = helper(['displays']).displays || []
    const inside = disp.find((d) => x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height)
    if (!inside)
      throw new Error(
        `坐标 (${x}, ${y}) 不在任何显示器内。当前：` + disp.map((d) => `#${d.id} ${d.x},${d.y} ${d.width}×${d.height}`).join('；')
      )
    // 目标窗口的拒绝名单：绝不点自己、绝不戳画板
    const wins = listWindows()
    if (wins.ok) {
      const hit = wins.windows.find((w) => x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height)
      if (hit && isSelf(hit))
        throw new Error('不点 Eas-Term 自己的窗口 —— 那会绕开所有确认（清空画布、删项目、替你发消息）')
      if (hit && (hit.bundleId || '').toLowerCase() === 'com.bizone.canvas')
        throw new Error('不用鼠标去戳笔纵画板 —— 生图只能由 AI 直接调它的工具，戳界面会绕开这个约定')
      if (hit && shouldRedact(hit)) throw new Error(`「${hit.owner}」在敏感窗口清单里，不在它上面点`)
    }
    acting = true
    try {
      const r = helper(['click', String(Math.round(x)), String(Math.round(y)), String(args.button || 'left'), String(Math.max(1, Math.min(3, Number(args.count) || 1)))])
      logAct('click', { x, y, button: args.button || 'left' }, 'ok')
      return r
    } catch (e) {
      logAct('click', { x, y }, String(e.message || e))
      throw e
    } finally {
      acting = false
    }
  }
  if (name === 'act_type') {
    requireGrant()
    const text = String(args.text ?? '')
    if (!text) throw new Error('没有给文本')
    if (text.length > MAX_TYPE_LEN) throw new Error(`一次最多输入 ${MAX_TYPE_LEN} 个字符（给的是 ${text.length}）`)
    acting = true
    try {
      const r = helper(['type', text])
      logAct('type', { length: text.length }, 'ok')
      return r
    } finally {
      acting = false
    }
  }
  if (name === 'act_key') {
    requireGrant()
    const keys = Array.isArray(args.keys) ? args.keys.map((k) => String(k).trim().toLowerCase()) : []
    if (!keys.length) throw new Error('没有给按键')
    if (keys.length > 5) throw new Error('一次最多 5 个键')
    const norm = keys.map((k) => (k === 'command' || k === 'meta' ? 'cmd' : k === 'option' || k === 'opt' ? 'alt' : k === 'control' ? 'ctrl' : k === 'backspace' || k === 'del' ? 'delete' : k === 'escape' ? 'esc' : k))
    const set = new Set(norm)
    for (const combo of BLOCKED_COMBOS)
      if (combo.length === set.size && combo.every((k) => set.has(k)))
        throw new Error(`不允许 ${combo.join('+')} —— 这类操作不可撤销，请让用户自己按`)
    acting = true
    try {
      const r = helper(['key', norm.join(',')])
      logAct('key', { keys: norm }, 'ok')
      return r
    } finally {
      acting = false
    }
  }
  if (name === 'act_scroll') {
    requireGrant()
    acting = true
    try {
      const r = helper(['scroll', String(Math.round(Number(args.dx) || 0)), String(Math.round(Number(args.dy) || 0))])
      logAct('scroll', { dx: args.dx, dy: args.dy }, 'ok')
      return r
    } finally {
      acting = false
    }
  }
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
  // ⚠️ **授权与收回故意不是 MCP 工具** —— 工具面里没有它们，模型给自己授权是不可能的。
  // 面板（用户真手点）经 `panel/` 前缀的私有方法调进来，见下面 tools/call 的分流。
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
    } else if (method === 'panel/grant' || method === 'panel/revoke' || method === 'panel/state') {
      // **只有面板能调**（面板 → 宿主 → 这里）。模型走的是 tools/call，够不到这几个方法。
      if (method === 'panel/grant') {
        const m = GRANT_MINUTES.find((x) => x === Number(params?.minutes))
        if (!m) return fail(id, -32602, `时长只能是 ${GRANT_MINUTES.join('/')} 分钟（没有永不过期这一档）`)
        grant = { by: String(params?.by || 'panel'), grantedAt: Date.now(), expiresAt: Date.now() + m * 60_000 }
        logAct('grant', { minutes: m }, 'ok')
      } else if (method === 'panel/revoke') {
        grant = null
        logAct('revoke', {}, 'ok')
      }
      const st = grantState()
      let ax = false
      try {
        ax = !!helper(['axcheck']).axTrusted
      } catch {
        /* 助手不在 */
      }
      ok(id, {
        granted: st.active,
        remainingSeconds: st.active ? Math.ceil(st.remainingMs / 1000) : 0,
        systemPermission: ax,
        minutes: GRANT_MINUTES,
        recentActions: actLog.slice(-12)
      })
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
