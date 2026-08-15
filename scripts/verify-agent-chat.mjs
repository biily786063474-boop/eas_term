#!/usr/bin/env node
// Task 9（2026-08-14 会话内核）：真实端到端验证。
//
// 前八个任务全部喂录好的样本跑单测。这个脚本第一次把所有零件接到*活的* Claude Code 上，
// 跑通一轮完整的审批闭环：起会话 → 发「创建 a.txt」→ 收到 approval.request →
// 模拟前端回 allow → 断言文件真的建了 / exec.done{ok:true} / turn.done 带 usage。
//
// 顺带验三件前几轮审查留下、只有真实 e2e 才能验的事（详见 task-9-brief.md）：
//   A. ELECTRON_RUN_AS_NODE 能不能真的从 Eas-Term → Claude CLI → hook 子进程 这条链路
//      完整传下去（中间那一跳——Claude CLI 传给它自己起的 hook 子进程——从没被验证过）。
//   B. 打包后 hookScriptPath() 的 process.resourcesPath 分支，路径拼得对不对（静态验证）。
//   C. --include-partial-messages 到底有没有产出真正的增量分块（text.delta 现在没实现，
//      需要证据决定要不要实现、怎么实现）。
//
// ── 整体架构：为什么是"自我重启"的单文件 ──────────────────────────────────────────
//
// src/main/agentChat/session.ts 是这次要验的核心，但它 import 了 'electron'（app/ipcMain/
// WebContents）——在裸 node 下 import 'electron' 会直接报错（这个包在非 Electron 环境里
// resolve 出来是一个字符串，不是对象，解构 { app, ipcMain } 会在 import 阶段就 SyntaxError）。
// 所以"跑单测那样直接 import session.ts"在这个脚本里行不通，必须真的起一个 Electron 进程。
//
// 但 npm test 的方式（node --test）、以及 brief 给的启动命令都是 `node scripts/verify-agent-chat.mjs`
// ——用户不会去敲 `electron scripts/verify-agent-chat.mjs`。于是这个文件身兼两态：
//   · 裸 node 跑起来时 = "编排者"：建临时目录、起并发子进程、汇总结果、决定 exit code。
//   · 编排者内部用 __EAS_T9_DRIVER=1 重新拿 electron 二进制跑*同一个文件*，
//     那一态叫"驱动"：真实 Electron 主进程，import 真正的 session.ts，
//     起一个隐藏 BrowserWindow 充当"前端"，通过真实 IPC 驱动 agentChat:start/resolveApproval。
//
// 驱动态里有两处刻意不用生产代码、自己写等价最小实现，都写明了原因：
//   1. 不调用真正的 registerMcpBridge()——它的 setupAgents() 会写用户*真实*的
//      ~/.claude.json（全局文件，不是项目内文件，红线明确不让碰）。改用一个只实现
//      /agent-approval/request 与 /agent-approval/resolve 两个端点的最小 HTTP server，
//      但两个端点内部调用的是*生产的* approvalRoute.ts（不是重新实现审批语义），
//      跟 mcpBridge.ts 里的真实路由是同一份判定逻辑。
//   2. 不加载真正的 preload/index.ts——它耦合 contextBridge，且额外做了一层事件缓冲
//      （防止 start() resolve 到 onEvent 订阅之间的丢事件窗口，Task 8 已经用独立脚本验过）。
//      这里用 nodeIntegration+executeJavaScript 直接調 ipcRenderer.invoke，
//      用 webContents.send 的猴子补丁在*源头*拦事件（比走 preload 再转发更不会丢）。
//
// 两个 monkeypatch（仅在驱动进程内存里生效，不写任何文件，进程退出即消失）：
//   · app.getAppPath = () => 项目根——实测过（见下）Electron 用"裸脚本路径"启动时，
//     getAppPath() 解析成脚本所在目录而不是项目根，hookScriptPath() 的 dev 分支会拼错路径。
//   · fs.existsSync 只在被问到 nodeBinForHook() 那 3 个硬编码候选路径时撒谎返回 false——
//     这台机器上 /opt/homebrew/bin/node 真实存在，自然场景不会走到 Electron-as-node 兜底，
//     验证不到 concern A 要验的那条链路，所以故意逼它走兜底分支（不影响其它任何路径）。

import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'node:module'

// session.ts 的依赖链里有几处相对 import 不带扩展名（fsGuard.ts → './wiki/paths'、
// wiki/paths.ts → './taxonomy'、mcpBridge.ts → './secrets' / './island'）——这是给
// electron-vite 的 Vite 打包器写的，打包器会自动探测扩展名；`npm test` 用的
// `node --test 'src/**/*.test.ts'` 从没踩到这个坑，是因为没有任何 *.test.ts 会传递性
// import 到这几个文件（session.ts 本身按 Ruling 3 不写单测）。但本脚本要动态 import
// 真正的 session.ts，Node 原生 ESM 解析器不做扩展名探测，会直接 ERR_MODULE_NOT_FOUND。
// 用一个极小的自定义 resolve hook 补上「解析失败就依次试几个扩展名」，只在找不到时才
// 介入（不改变任何能正常解析的 specifier 的行为），不改动任何生产代码。
const EXT_FALLBACK_LOADER = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const EXTS = ['.ts', '.mts', '.js', '.mjs', '.json']
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const relative = specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')
    if (err && err.code === 'ERR_MODULE_NOT_FOUND' && relative && context.parentURL) {
      const basePath = fileURLToPath(new URL(specifier, context.parentURL))
      for (const ext of EXTS) {
        if (existsSync(basePath + ext)) return nextResolve(specifier + ext, context)
      }
      for (const ext of EXTS) {
        if (existsSync(basePath + '/index' + ext)) {
          return nextResolve(specifier.replace(/\\/?$/, '/') + 'index' + ext, context)
        }
      }
    }
    throw err
  }
}
`

const __filename = fileURLToPath(import.meta.url)
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..')
const RESULT_MARKER = '@@T9RESULT@@'

// 这个终端本身跑在一个真实的、用户正在用的 Eas-Term 实例里，shell 环境已经带着它的
// EAS_TERM_PORT/TOKEN。任何本脚本自己起的子进程（探针、Electron 驱动）都必须清掉这四个，
// 否则会向用户正在用的那个实例发真实审批请求（上一轮实现者已经踩过这个坑一次）。
const ENV_SCRUB_KEYS = ['EAS_TERM_PORT', 'EAS_TERM_TOKEN', 'EAS_PTY_ID', 'EAS_PROJECT']

function envFor(extra = {}) {
  const env = { ...process.env }
  for (const k of ENV_SCRUB_KEYS) delete env[k]
  return { ...env, ...extra }
}

function log(...args) {
  console.log('[t9]', ...args)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => resolve(b))
    req.on('error', reject)
  })
}

const DRIVER_MODE = process.env.__EAS_T9_DRIVER === '1'

if (DRIVER_MODE) {
  // 不能在这里 `await runDriver()`——那会把这个 ESM 入口模块的顶层求值挂在
  // runDriver() 内部的 `await app.whenReady()` 上。Electron 的 ESM 主进程入口要等
  // 主模块求值完成才会真正推进到发出 'ready' 事件，于是变成「模块在等 ready，
  // ready 在等模块求值完成」的死锁——实测确凿：同一台机器同一个 Electron，仅换
  // 入口文件的模块格式（.mjs 顶层 await whenReady() vs .js 用 .then() 回调），
  // 前者 15 秒不 resolve，后者立刻 resolve。不 await 这次调用（fire-and-forget，
  // runDriver 内部有自己的 try/catch/finally + 显式 process.exit，不需要顶层再等它）
  // 就能让模块求值立刻走完，破掉这个死锁。
  runDriver().catch((e) => {
    console.error('[t9-driver] 顶层未捕获异常：', e)
    process.exit(1)
  })
} else {
  await runOrchestrator()
}

// ════════════════════════════ 编排者态（裸 node） ════════════════════════════

async function runOrchestrator() {
  log('=== Task 9：会话内核端到端验证 ===')
  log('项目根：', PROJECT_ROOT)

  const concernB = checkPackagedHookPath()
  printConcernB(concernB)

  let concernC
  try {
    concernC = await probePartialMessages()
  } catch (e) {
    concernC = { ok: false, error: String((e && e.stack) || e) }
  }
  printConcernC(concernC)

  let main
  try {
    main = await runMainFlowViaElectron()
  } catch (e) {
    main = { ok: false, error: String((e && e.stack) || e), driverResult: null }
  }
  printMain(main)

  const assertions = main?.driverResult?.assertions ?? {}
  const allCorePassed =
    !!main?.driverResult?.ok &&
    Object.keys(assertions).length > 0 &&
    Object.values(assertions).every(Boolean)

  log('')
  log('=== 结论 ===')
  log('① 收到过 approval.request：', assertions.approvalRequestSeen ?? '(未知)')
  log('② 文件真的被创建：        ', assertions.fileCreated ?? '(未知)')
  log('③ 收到 exec.done{ok:true}：', assertions.execDoneOk ?? '(未知)')
  log('④ turn.done 且 usage 非空：', assertions.turnDoneWithUsage ?? '(未知)')
  log(allCorePassed ? '四条核心断言全部通过。' : '存在未通过的断言——如实报告，不放宽判据。')

  process.exitCode = allCorePassed ? 0 : 1
}

// ── concern B：打包后 hookScriptPath() 的路径拼法是否对得上 extraResources ──────────

function checkPackagedHookPath() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
  const extraResources = pkg?.build?.extraResources ?? []
  const entry = extraResources.find((r) => r && r.from === 'resources/agent-hooks')
  const hasEntry = !!entry && entry.to === 'agent-hooks'

  const hookSrc = path.join(PROJECT_ROOT, 'resources', 'agent-hooks', 'eas-pretooluse.mjs')
  const respSrc = path.join(PROJECT_ROOT, 'resources', 'agent-hooks', 'responseBody.mjs')
  const hookSrcExists = fs.existsSync(hookSrc)
  const respSrcExists = fs.existsSync(respSrc)

  const sessionTs = fs.readFileSync(path.join(PROJECT_ROOT, 'src/main/agentChat/session.ts'), 'utf8')
  const fnMatch = sessionTs.match(/function hookScriptPath\(\)[^{]*\{[\s\S]*?\n\}/)
  const fnBody = fnMatch ? fnMatch[0] : ''
  const usesResourcesPath = fnBody.includes('process.resourcesPath')
  const usesAgentHooksLiteral = fnBody.includes("'agent-hooks'")
  const usesScriptLiteral = fnBody.includes("'eas-pretooluse.mjs'")
  const foundFn = fnBody.length > 0

  const ok =
    hasEntry && hookSrcExists && respSrcExists && foundFn && usesResourcesPath && usesAgentHooksLiteral && usesScriptLiteral

  return {
    ok,
    hasEntry,
    entry,
    hookSrcExists,
    respSrcExists,
    foundFn,
    usesResourcesPath,
    usesAgentHooksLiteral,
    usesScriptLiteral,
    fnBody
  }
}

function printConcernB(r) {
  log('')
  log('=== Concern B：打包路径静态验证 ===')
  log('  package.json build.extraResources 含 resources/agent-hooks → agent-hooks：', r.hasEntry)
  log('  源目录下 eas-pretooluse.mjs 存在：', r.hookSrcExists, '  responseBody.mjs 存在：', r.respSrcExists)
  log('  hookScriptPath() 找到函数体：', r.foundFn)
  log('  打包分支用 process.resourcesPath：', r.usesResourcesPath)
  log("  打包分支拼 'agent-hooks' 字面量（与 extraResources.to 对得上）：", r.usesAgentHooksLiteral)
  log("  打包分支拼 'eas-pretooluse.mjs' 字面量：", r.usesScriptLiteral)
  log('  静态验证结论：', r.ok ? '通过（路径算术能对上）' : '不通过——见上面各项')
  log('  注：这是静态验证，不是真跑一次 electron-builder 打包再核实产物；见任务报告的附加说明。')
}

// ── concern C：--include-partial-messages 是否产出真正的增量分块 ──────────────────

async function probePartialMessages() {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-t9-probe-'))
  try {
    const adapterUrl = pathToFileURL(path.join(PROJECT_ROOT, 'src/main/agentChat/adapters/claude.ts')).href
    const { claudeAdapter } = await import(adapterUrl)
    const built = claudeAdapter.buildArgs({ cwd: probeDir, model: 'sonnet' })

    log('')
    log('=== Concern C：--include-partial-messages 分块粒度探针 ===')
    log('  spawn:', built.bin, built.args.join(' '))

    const proc = spawn(built.bin, built.args, {
      cwd: probeDir,
      env: envFor(),
      stdio: [built.stdin, 'pipe', 'pipe']
    })

    let raw = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (c) => {
      raw += c
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (c) => {
      stderr += c
    })

    const userLine =
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: '请只回复这四个字：你好在的。不要调用任何工具，不要读写任何文件，不要做其它任何事。'
        }
      }) + '\n'
    proc.stdin.write(userLine)

    const deadline = Date.now() + 45_000
    while (!raw.includes('"type":"result"') && Date.now() < deadline && proc.exitCode === null) {
      await sleep(200)
    }
    try {
      proc.kill()
    } catch {
      /* 已经退出 */
    }
    await sleep(100)

    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const parsed = []
    for (const l of lines) {
      try {
        parsed.push(JSON.parse(l))
      } catch {
        /* 非 JSON 行忽略 */
      }
    }

    const byType = {}
    for (const p of parsed) {
      const t = typeof p.type === 'string' ? p.type : '(no type)'
      byType[t] = (byType[t] || 0) + 1
    }

    const KNOWN = new Set(['system', 'assistant', 'user', 'result'])
    const unknownTypeLines = parsed.filter((p) => !KNOWN.has(p.type))
    const assistantLines = parsed.filter((p) => p.type === 'assistant')
    const assistantTexts = assistantLines
      .map((p) => {
        const content = p?.message?.content
        const block = Array.isArray(content) ? content.find((b) => b?.type === 'text') : undefined
        return block?.text
      })
      .filter((t) => typeof t === 'string')

    // 判据：assistant 类型的行如果出现多条、且文本呈"前缀递增"关系，说明 CLI 是按块
    // 累积推送同一条消息（不是每次都给完整最终文本）——这本身就是一种增量。
    let incrementalAssistant = false
    if (assistantTexts.length > 1) {
      incrementalAssistant = assistantTexts
        .slice(1)
        .every((t, i) => t.startsWith(assistantTexts[i]) || assistantTexts[i].startsWith(t))
    }

    const hasUnknownTypes = unknownTypeLines.length > 0
    const verdict = hasUnknownTypes || incrementalAssistant ? 'incremental-evidence-found' : 'no-incremental-evidence'

    return {
      ok: true,
      totalLines: lines.length,
      byType,
      assistantLineCount: assistantLines.length,
      assistantTexts,
      incrementalAssistant,
      hasUnknownTypes,
      unknownTypeSamples: unknownTypeLines.slice(0, 5),
      verdict,
      stderrTail: stderr.slice(-1000)
    }
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true })
  }
}

function printConcernC(r) {
  if (!r.ok) {
    log('  探针失败：', r.error)
    return
  }
  log('  总行数：', r.totalLines, ' 按 type 分布：', JSON.stringify(r.byType))
  log('  assistant 类型行数：', r.assistantLineCount, ' 呈递增前缀关系：', r.incrementalAssistant)
  log('  出现 system/assistant/user/result 之外的类型：', r.hasUnknownTypes)
  if (r.unknownTypeSamples.length) {
    log('  未知类型样本（最多 5 条，截断显示）：')
    for (const s of r.unknownTypeSamples) log('    ', JSON.stringify(s).slice(0, 300))
  }
  log('  探针结论：', r.verdict)
  log(
    r.verdict === 'incremental-evidence-found'
      ? '  → 发现真实增量证据：text.delta 有实现依据（不在本任务实现，留证据）。'
      : '  → 未发现增量证据：assistant 消息看起来是整段一次到达，text.delta 目前是空定义。'
  )
}

// ── 主流程：真起会话，跑通审批闭环，验四条核心断言 + concern A ──────────────────────

async function runMainFlowViaElectron() {
  log('')
  log('=== 主流程：起隔离 Electron 驱动，跑一轮真实 Claude Code 审批闭环 ===')

  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-t9-project-')))
  const userDataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-t9-userdata-')))

  // installApprovalHook 要过 fsGuard.guardPath()，边界是"已注册项目根"，读的是
  // <userData>/projects.json。这里手写一份把临时项目目录注册进去——只在这个隔离的
  // userData 目录里，不碰用户真实的 userData。
  fs.writeFileSync(
    path.join(userDataDir, 'projects.json'),
    JSON.stringify(
      [{ id: 't9-verify-project', name: 'agent-chat-verify', path: projectDir, addedAt: Date.now() }],
      null,
      2
    )
  )

  const message =
    '在当前目录创建一个文件，文件名为 a.txt，内容写 hello。直接创建，不要先查看目录内容，' +
    '不要读取任何已有文件，创建完成后立即结束、不要执行任何其它操作。'

  const electronBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'electron')
  const env = envFor({
    __EAS_T9_DRIVER: '1',
    EAS_T9_PROJECT_DIR: projectDir,
    EAS_T9_USERDATA_DIR: userDataDir,
    EAS_T9_MESSAGE: message
  })

  log('  projectDir  =', projectDir)
  log('  userDataDir =', userDataDir)
  log('  message     =', message)
  log('  spawning isolated Electron driver（只会杀这一个自己起的 PID，不影响用户正在用的实例）…')

  const proc = spawn(electronBin, [__filename], { cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })

  let stdout = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (c) => {
    stdout += c
    process.stdout.write(c)
  })
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (c) => {
    process.stderr.write(c)
  })

  const HARD_TIMEOUT_MS = 220_000
  const exitInfo = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      log('驱动进程超过外层硬性超时（220s），强制结束——只杀这一个 PID：', proc.pid)
      try {
        proc.kill('SIGKILL')
      } catch {
        /* 已经不在了 */
      }
      resolve({ timedOut: true, code: null, signal: null })
    }, HARD_TIMEOUT_MS)
    proc.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ timedOut: false, code, signal })
    })
  })

  let driverResult = null
  const markerLine = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith(RESULT_MARKER))
    .pop()
  if (markerLine) {
    try {
      driverResult = JSON.parse(markerLine.slice(RESULT_MARKER.length))
    } catch (e) {
      driverResult = { ok: false, error: 'RESULT_MARKER JSON 解析失败：' + e.message }
    }
  } else {
    driverResult = { ok: false, error: '驱动进程没有输出结果标记行（可能崩溃或超时），exitInfo=' + JSON.stringify(exitInfo) }
  }

  const assertionsOk =
    driverResult?.ok && driverResult?.assertions && Object.values(driverResult.assertions).every(Boolean)
  if (assertionsOk) {
    fs.rmSync(projectDir, { recursive: true, force: true })
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } else {
    log('  存在失败/异常项，保留临时目录供排查：')
    log('    projectDir  =', projectDir)
    log('    userDataDir =', userDataDir)
  }

  return { exitInfo, driverResult, projectDir, userDataDir }
}

function printMain(main) {
  log('')
  log('=== 主流程结果 ===')
  if (!main.driverResult) {
    log('  没有拿到驱动进程的结果：', main.error)
    return
  }
  const r = main.driverResult
  log('  driver 自报 ok：', r.ok, r.error ? '  error: ' + r.error : '')
  log('  收到的事件种类统计：', JSON.stringify(countKinds(r.events)))
  if (r.hookCommandInSettings) {
    try {
      const parsed = JSON.parse(r.hookCommandInSettings)
      const cmd = parsed?.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command
      log('  安装到 .claude/settings.json 的 hook 命令：', cmd)
      log(
        '  → ',
        cmd && cmd.includes('Electron')
          ? 'Electron-as-node 兜底分支被真实触发（concern A 的目标路径）'
          : '(未使用 Electron 兜底路径，检查是否命中了预期分支)'
      )
    } catch {
      log('  .claude/settings.json 内容（解析失败，原样打印）：', r.hookCommandInSettings)
    }
  } else {
    log('  没有读到 .claude/settings.json——hook 可能没装上')
  }
  if (r.fileContent != null) log('  a.txt 内容：', JSON.stringify(r.fileContent))
}

function countKinds(events) {
  const out = {}
  for (const e of events || []) out[e.k] = (out[e.k] || 0) + 1
  return out
}

// ════════════════════════════ 驱动态（真实 Electron 主进程） ════════════════════════════

async function runDriver() {
  const result = {
    ok: false,
    assertions: { approvalRequestSeen: false, fileCreated: false, execDoneOk: false, turnDoneWithUsage: false },
    events: [],
    hookCommandInSettings: null,
    fileContent: null,
    error: null
  }

  let finished = false
  let appRef = null
  let sessionMod = null
  let bridgeServer = null
  let win = null
  let realExistsSync = null

  // 调试用的检查点日志：走 stderr（编排者会原样转发），不干扰 stdout 上的结果标记行。
  // 硬性超时之前完全没有中间产出的话，光靠最终结果 JSON 判断不出卡在哪一步。
  const t0 = Date.now()
  const dlog = (...args) => console.error('[t9-driver]', `+${((Date.now() - t0) / 1000).toFixed(1)}s`, ...args)

  const finish = () => {
    if (finished) return
    finished = true
    try {
      if (sessionMod) sessionMod.killAllAgentChatSessions(true)
    } catch {
      /* 尽力而为 */
    }
    try {
      if (bridgeServer) bridgeServer.close()
    } catch {
      /* 尽力而为 */
    }
    try {
      if (win && !win.isDestroyed()) win.destroy()
    } catch {
      /* 尽力而为 */
    }
    if (realExistsSync) fs.existsSync = realExistsSync
    // 用回调而不是直接 process.exit()：stdout 连着管道时是异步写入，不等回调就退出
    // 会截断这一行——正是 resources/agent-hooks/eas-pretooluse.mjs 文件头注释警告过的
    // 同一类坑，这里照它的方式处理。
    const line = RESULT_MARKER + JSON.stringify(result) + '\n'
    process.stdout.write(line, () => {
      if (appRef) {
        try {
          appRef.exit(result.ok ? 0 : 1)
          return
        } catch {
          /* 落到下面的 process.exit */
        }
      }
      process.exit(result.ok ? 0 : 1)
    })
  }

  const hardDeadline = setTimeout(() => {
    result.error = (result.error ? result.error + '; ' : '') + '驱动进程硬性超时（190s），强制收尾'
    finish()
  }, 190_000)

  try {
    dlog('driver 启动')
    register('data:text/javascript,' + encodeURIComponent(EXT_FALLBACK_LOADER), import.meta.url)
    dlog('扩展名兜底 resolve hook 已注册')
    const electronMod = await import('electron')
    dlog('import electron 完成')
    const { app, BrowserWindow } = electronMod
    appRef = app
    app.disableHardwareAcceleration()
    app.setPath('userData', process.env.EAS_T9_USERDATA_DIR)
    dlog('等待 app.whenReady() …')
    await app.whenReady()
    dlog('app ready')

    // concern A/B 的两处 monkeypatch，见文件头架构说明。
    app.getAppPath = () => PROJECT_ROOT

    realExistsSync = fs.existsSync
    const HIDDEN_NODE_CANDIDATES = new Set(['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'])
    fs.existsSync = (p) => (HIDDEN_NODE_CANDIDATES.has(p) ? false : realExistsSync(p))

    // 最小化的假 mcpBridge：只接两个审批端点，内部调用生产的 approvalRoute.ts
    // （不重新实现审批语义），不调用真正的 registerMcpBridge()（会写用户真实的
    // ~/.claude.json，见文件头说明）。
    dlog('import approvalRoute.ts …')
    const approvalRoute = await import(
      pathToFileURL(path.join(PROJECT_ROOT, 'src/main/agentChat/approvalRoute.ts')).href
    )
    dlog('approvalRoute.ts 已加载')
    const bridgeToken = crypto.randomBytes(24).toString('hex')
    bridgeServer = http.createServer(async (req, res) => {
      const send = (code, obj) => {
        const body = JSON.stringify(obj)
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(body)
      }
      try {
        if (req.headers['x-eas-token'] !== bridgeToken) return send(401, { error: 'bad token' })
        const raw = await readBody(req)
        if (req.method === 'POST' && req.url === '/agent-approval/request') {
          let payload
          try {
            payload = JSON.parse(raw || '{}')
          } catch {
            return send(400, { decision: 'deny', reason: 'hook 请求体解析失败' })
          }
          if (!approvalRoute.approvalIdOf(payload)) return send(400, { decision: 'deny', reason: '缺少 tool_use_id' })
          const decision = await approvalRoute.waitForApproval(payload)
          return send(200, decision)
        }
        if (req.method === 'POST' && req.url === '/agent-approval/resolve') {
          let body
          try {
            body = JSON.parse(raw || '{}')
          } catch {
            return send(400, { ok: false })
          }
          const ok = approvalRoute.resolveApproval(body.approvalId, body.decision, body.reason)
          return send(ok ? 200 : 404, { ok })
        }
        send(404, { error: 'unknown route' })
      } catch (e) {
        send(500, { error: String(e) })
      }
    })
    await new Promise((resolve, reject) => {
      bridgeServer.once('error', reject)
      bridgeServer.listen(0, '127.0.0.1', resolve)
    })
    const bridgePort = bridgeServer.address().port
    process.env.EAS_TERM_PORT = String(bridgePort)
    process.env.EAS_TERM_TOKEN = bridgeToken
    dlog('假 mcpBridge 监听中，端口', bridgePort)

    // 真正要验的核心：加载生产的 session.ts。
    dlog('import session.ts …')
    sessionMod = await import(pathToFileURL(path.join(PROJECT_ROOT, 'src/main/agentChat/session.ts')).href)
    dlog('session.ts 已加载，registerAgentChatHandlers() …')
    sessionMod.registerAgentChatHandlers()
    dlog('registerAgentChatHandlers() 完成')

    // 隐藏窗口充当"前端"：不加载真正的 preload，直接开 nodeIntegration 让页面自己
    // require('electron') 调 ipcRenderer——省掉 contextBridge 那层，行为上等价
    // （已用独立探针验证过这个组合能正确跑通 invoke 往返 + e.sender 有效）。
    win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    })
    dlog('BrowserWindow 已创建')
    const events = []
    const origSend = win.webContents.send.bind(win.webContents)
    // 在源头拦事件（webContents.send 本身），而不是走一遍真正的 ipcRenderer.on 订阅——
    // 这样不会撞上"start() resolve 到 onEvent 订阅之间丢事件"那个窗口（Task 8 已经用
    // 独立脚本验过那个问题本身，这里不重复验，只是不想让本脚本自己的订阅时机成为
    // 新的丢事件来源，干扰对 session.ts 本身的判断）。
    win.webContents.send = (channel, ...args) => {
      if (channel.startsWith('agentChat:event:')) events.push(args[0])
      return origSend(channel, ...args)
    }
    await win.loadURL('about:blank')
    dlog('隐藏窗口 loadURL(about:blank) 完成')

    const invoke = async (channel, ...args) => {
      const argsSrc = args.map((a) => JSON.stringify(a)).join(', ')
      const src = `require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}${argsSrc ? ', ' + argsSrc : ''})`
      return win.webContents.executeJavaScript(src)
    }

    dlog('调用 agentChat:start …')
    const startResult = await invoke('agentChat:start', {
      cli: 'claude',
      cwd: process.env.EAS_T9_PROJECT_DIR,
      message: process.env.EAS_T9_MESSAGE,
      model: 'sonnet'
    })
    dlog('agentChat:start 返回：', JSON.stringify(startResult))
    if (!startResult || !startResult.ok) {
      throw new Error('agentChat:start 失败：' + JSON.stringify(startResult))
    }
    const sessionId = startResult.sessionId

    try {
      result.hookCommandInSettings = fs.readFileSync(
        path.join(process.env.EAS_T9_PROJECT_DIR, '.claude', 'settings.json'),
        'utf8'
      )
    } catch {
      /* 装不上时 installApprovalHook 会推 error 事件，events 里会看到，这里不额外处理 */
    }

    // 自动允许收到的每一个审批请求（可能不止一个——matcher 是 '*'，任何工具调用都会
    // 弹一次）。不是只处理第一个，避免模型先做别的动作时卡死在第二个请求上。
    const handledApprovals = new Set()
    const deadline = Date.now() + 150_000
    let lastHeartbeat = 0
    let lastCount = -1
    while (Date.now() < deadline) {
      for (const e of events) {
        if (e.k === 'approval.request' && !handledApprovals.has(e.approvalId)) {
          handledApprovals.add(e.approvalId)
          dlog('看到 approval.request，回 allow：', e.approvalId, e.title)
          await invoke('agentChat:resolveApproval', sessionId, e.approvalId, 'allow')
          dlog('resolveApproval 已发出')
        }
      }
      if (events.length !== lastCount || Date.now() - lastHeartbeat > 5000) {
        lastCount = events.length
        lastHeartbeat = Date.now()
        dlog('轮询中，累计事件', events.length, '个：', events.map((e) => e.k).join(','))
      }
      if (events.some((e) => e.k === 'turn.done')) break
      if (events.some((e) => e.k === 'error' && e.fatal)) break
      await sleep(300)
    }
    dlog('轮询结束（turn.done / fatal error / 超时三者之一）')

    result.events = events
    result.assertions.approvalRequestSeen = events.some((e) => e.k === 'approval.request')

    const filePath = path.join(process.env.EAS_T9_PROJECT_DIR, 'a.txt')
    result.assertions.fileCreated = fs.existsSync(filePath)
    if (result.assertions.fileCreated) {
      try {
        result.fileContent = fs.readFileSync(filePath, 'utf8').slice(0, 500)
      } catch {
        /* 读不到就算了，存在性判定已经拿到 */
      }
    }

    result.assertions.execDoneOk = events.some((e) => e.k === 'exec.done' && e.ok === true)

    const turnDone = events.find((e) => e.k === 'turn.done')
    result.assertions.turnDoneWithUsage =
      !!turnDone && !!turnDone.usage && (turnDone.usage.inputTokens > 0 || turnDone.usage.outputTokens > 0)

    result.ok = true
  } catch (e) {
    result.error = (result.error ? result.error + '; ' : '') + String((e && e.stack) || e)
  } finally {
    clearTimeout(hardDeadline)
    finish()
  }
}
