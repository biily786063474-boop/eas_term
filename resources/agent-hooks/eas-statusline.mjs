#!/usr/bin/env node
// Claude Code 的 statusLine 命令：把状态栏那份 JSON 复制一份回传给 Eas-Term，
// 再原样转发给用户原来的 statusline 命令，输出照旧。
//
// ── 为什么必须走这条通道 ──────────────────────────────────────────────
// 真实的订阅额度百分比和「与 /context 一致」的上下文占用，**只在 statusline 的
// stdin 里**。2026-08-18 实测确认：headless 事件流（`claude -p --output-format
// stream-json`）里只有
//   · rate_limit_info —— 五小时那条**没有 utilization**，七天那条只在接近限额时才推
//   · modelUsage.contextWindow + usage —— 能自己算比例，但口径和 /context 不同
//     （Claude Code 扣掉了自动压缩预留）
// 而 statusline 的 stdin 里有现成的
//   · rate_limits.five_hour.used_percentage / seven_day.used_percentage —— 两个都有
//   · context_window.used_percentage —— v2.1.6+ 原生给，和 /context 对得上
//
// ── 三条铁律 ─────────────────────────────────────────────────────────
// 1. **绝不能搞坏用户原有的状态栏。** 这个脚本是包装器：无论回传成功与否，
//    都要把 stdin 原样交给 wrapped 命令，并把它的输出原样吐出去。
//    我们这一半出任何问题，用户看到的状态栏都不受影响。
// 2. **绝不能拖慢它。** statusline 每次刷新都跑（很频繁）。回传是 fire-and-forget
//    的本地 HTTP，带 300ms 超时；wrapped 命令并行启动，不等回传。
// 3. **没有 token 就什么都不做。** 端口/令牌由 Eas-Term 的 pty env 注入 ——
//    在别处起的 claude 拿不到，于是不回传，门禁照旧成立。
import { spawn } from 'node:child_process'

const PORT = process.env.EAS_TERM_PORT
const TOKEN = process.env.EAS_TERM_TOKEN
/** 用户原来的 statusline 命令。安装时由 Eas-Term 写进来。 */
const WRAPPED = process.env.EAS_STATUSLINE_WRAPPED || ''
const POST_TIMEOUT_MS = 300

function readStdin() {
  return new Promise((resolve) => {
    let buf = ''
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve(buf)
      }
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (buf += c))
    process.stdin.on('end', finish)
    process.stdin.on('error', finish)
    // statusline 的 stdin 理论上会正常关闭，但卡住的话不能把状态栏一起拖死
    setTimeout(finish, 1000)
  })
}

/** 回传给 app。**失败一律无声** —— 状态栏不该因为我们的通道出问题而报错。 */
async function report(raw) {
  if (!PORT || !TOKEN || !raw.trim()) return
  let payload
  try {
    const j = JSON.parse(raw)
    // 只挑我们要的两块，不把整份 JSON（含 transcript_path、cwd）往回传 ——
    // 那里面有用户的路径信息，没必要经过这条通道
    payload = { contextWindow: j.context_window ?? null, rateLimits: j.rate_limits ?? null }
    if (!payload.contextWindow && !payload.rateLimits) return // 没有我们要的东西就别发
  } catch {
    return
  }
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), POST_TIMEOUT_MS)
    await fetch(`http://127.0.0.1:${PORT}/statusline`, {
      method: 'POST',
      // **鉴权头是 x-eas-token，不是 Authorization** —— 服务端（mcpBridge.ts）认的是前者
      headers: { 'Content-Type': 'application/json', 'x-eas-token': TOKEN },
      body: JSON.stringify(payload),
      signal: ac.signal
    }).catch(() => {})
    clearTimeout(t)
  } catch {
    /* 无声 */
  }
}

async function main() {
  const raw = await readStdin()
  // **并行**：回传不阻塞状态栏渲染
  const reporting = report(raw)
  if (!WRAPPED) {
    // 没有被包装的命令 = 用户原来没配 statusline。我们自己不产出任何状态栏内容
    // （那不是我们的职责），静默退出
    await reporting
    return
  }
  await new Promise((resolve) => {
    const p = spawn('/bin/sh', ['-c', WRAPPED], { stdio: ['pipe', 'inherit', 'inherit'] })
    p.on('error', resolve) // 原命令跑不起来也不能让我们这层报错
    p.on('close', resolve)
    try {
      p.stdin.write(raw)
      p.stdin.end()
    } catch {
      resolve()
    }
  })
  await reporting
}

main().catch(() => {})
