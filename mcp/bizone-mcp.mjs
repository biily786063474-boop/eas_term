// 笔纵画板 MCP 的启动包装器。
//
// 它自己不实现任何工具——真正的 server 是画板 app 包里那个 mcpServer.js，
// 这里只做一件事：**在把 stdio 交给它之前，确保画板真的在跑。**
//
// 为什么需要这一层：画板的 MCP server 是个 stdio 进程，但所有工具最终都要打到
// 画板本体的 HTTP 接口（默认 127.0.0.1:13140）。画板没开着的时候，server 起得来、
// tools/list 也正常，只有真去生图那一刻才失败，报的还是一句 ECONNREFUSED。
// 而它自己**不会**去拉画板（实测：整个 mcpServer.js 里没有任何 spawn / open -a）。
// 于是用户体验就是「说了句画个封面，然后莫名其妙失败」——他得先知道要去开画板。
//
// 约束（两条都踩过的话很难查）：
//  1. **绝对不许往 stdout 写任何东西**——stdout 是 MCP 的传输通道，多一个字节
//     整个协议就坏了。诊断一律走 stderr。
//  2. 零外部依赖。这个文件跟 eas-mcp.mjs 一样由 extraResources 原样拷进包里，
//     旁边没有 node_modules，import 任何三方包都会 ERR_MODULE_NOT_FOUND。
//
// 用法（Eas-Term 写进 ~/.claude.json 时拼的）：
//   node <这个文件> <画板 mcpServer.js 的绝对路径>
import fs from 'fs'
import os from 'os'
import path from 'path'
import net from 'net'
import { spawn } from 'child_process'
import { pathToFileURL } from 'url'

const APP_BUNDLE = '/Applications/笔纵画板.app'
const DEFAULT_PORT = 13140
// 冷启一个 Electron app 通常 3~8 秒。上限给 12 秒：够覆盖正常冷启，
// 又不至于吃掉 MCP 客户端的握手超时（Claude Code 默认 30s）——
// 超时也不算失败，照样把 stdio 交给真 server，让它用自己的话报错。
const WAIT_MS = 12_000
const POLL_MS = 400

const log = (...a) => console.error('[bizone-mcp]', ...a)

/** 画板的 API 端口。它把端口写在 api-token.json 里，没有就用默认值。
 *  每轮轮询都重读一次——画板刚启动时这个文件可能还没写出来。 */
function apiPort() {
  try {
    const p =
      process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', '笔纵画板', 'api-token.json')
        : process.platform === 'win32'
          ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '笔纵画板', 'api-token.json')
          : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), '笔纵画板', 'api-token.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Number(j?.port) || DEFAULT_PORT
  } catch {
    return DEFAULT_PORT
  }
}

/** 端口通不通。只做 TCP 连接——画板没有健康检查端点，而「端口能连上」
 *  正是真 server 唯一需要的前提，不必更精确。 */
function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    const done = (ok) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(800)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

async function ensureCanvasRunning() {
  // TAPTV_API 被显式指定时说明调用方自己接管了后端地址，别自作主张拉本机 app
  if (process.env.TAPTV_API) return
  if (process.platform !== 'darwin') return // 画板在别的平台装在哪还没核实，不猜
  if (await portOpen(apiPort())) return // 已经开着：零延迟，最常见的路径

  if (!fs.existsSync(APP_BUNDLE)) {
    log('画板没装，跳过拉起')
    return
  }
  // -g：不抢前台。用户正在写东西的时候被一个窗口糊脸，本身就是另一种折腾。
  // detached + unref：别让画板变成本进程的子进程，否则这个 MCP server 一退，
  // 画板跟着被带走。
  log('画板没开，尝试拉起…')
  try {
    spawn('open', ['-g', '-a', APP_BUNDLE], { detached: true, stdio: 'ignore' }).unref()
  } catch (e) {
    log('拉起失败：', e?.message ?? e)
    return
  }
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    if (await portOpen(apiPort())) {
      log('画板已就绪')
      return
    }
  }
  // 没等到也继续——真 server 会用自己的话报「连不上画板」，
  // 比这里直接退出（客户端只会显示一句「连接失败」）更有信息量。
  log(`等了 ${WAIT_MS / 1000}s 画板仍未就绪，继续交给真 server`)
}

const real = process.argv[2]
if (!real || !fs.existsSync(real)) {
  log('找不到画板的 mcpServer.js：', real ?? '(没传路径)')
  process.exit(1)
}
await ensureCanvasRunning()
// 动态 import 而不是 spawn 子进程：stdio 就是本进程的，直接被真 server 接管，
// 中间不需要转发，也就没有「转发层把协议弄坏」的可能。
// 注意用 file:// URL——路径里有中文和空格，直接传字符串在部分平台上会解析失败。
await import(pathToFileURL(real).href)
