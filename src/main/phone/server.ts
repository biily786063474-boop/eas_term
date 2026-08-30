// 手机端的 HTTP 服务。**只在局域网上监听，绝不绑 0.0.0.0。**
//
// 链路：手机 ──HTTP──▸ 这里 ──IPC──▸ 渲染进程 store（照 mcpBridge 的 invokeRenderer）
//
// 为什么在主进程：渲染层关了它还得在（手机不该因为你切了个视图就连不上）、
// 要拿网卡地址、读文件要过 fsGuard——这三样都在主进程。
// 但**画布状态不搬过来**：那在渲染层的 zustand 里，搬过来就是两份真相。
//
// ── 第一步（局域网 + 只读）的风险等级，写在这里免得被高估 ──────────────
// 明文 HTTP、只在局域网、只有读。最坏情况是「同一个 Wi-Fi 下拿到 token 的人
// 能看你 Frame 里的文件」。比「被远程操控」轻一个数量级——这正是把它排第一步
// 的原因。但**不能因此说没风险**，所以手机页面上有一行「局域网明文连接」。
// TLS 是第三步（隧道）的事。
import { app, BrowserWindow, ipcMain } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'

import { guardPath } from '../fsGuard'
import { mainWindow } from '../island'
import * as audit from './audit'
import { deliverExternalMessage, readTranscript } from '../agentChat/session'
import { readTermTail } from '../pty'
import { lanCandidates, pickLan, type LanCandidate } from './lan'
import { findDevice, isAllowed, touch, type PhoneState } from './pairing'

/** 单个文档最多传多少。超了截断并明说——不静默截，那会让人以为文件就这么长。 */
const MAX_TEXT = 512 * 1024
/** 问渲染层要数据的超时。都是纯 store 计算，5 秒绰绰有余；
 *  这条链路上没有「等人点确认」的动作，不需要 mcpBridge 那套长超时清单。 */
const QUERY_TIMEOUT_MS = 5000
/** 只读档。**2026-08-29 关掉了** —— 用户要求手机端能在没有对话的项目里新建会话。
 *  放开写的前提（技术设计文档第 8 道锁写着的那条）已经补齐：
 *  · 每个写请求逐次经过电脑上的人工确认（request.ts）
 *  · 每一次请求都留痕，包括读操作（audit.ts）
 *  这两样缺一样都不该把它设成 false。 */
const READ_ONLY = false

let server: http.Server | null = null
let boundHost = ''
let boundPort = 0
let seq = 1
const pending = new Map<number, (r: unknown) => void>()

/** 拿状态 / 存状态由 index.ts 注入 —— server 不自己碰 store，
 *  否则「谁是状态的唯一持有者」就有两个答案了。 */
interface Hooks {
  getState: () => PhoneState
  setState: (s: PhoneState) => void
  /** 有手机扫了码，去弹「允许吗」。返回不等人 —— 手机那边自己轮询 /pair/wait */
  onClaim: () => void
}
let hooks: Hooks | null = null

/** 本机能给手机用的地址。挑法见 lan.ts —— **不是「取第一个非回环 IPv4」**，
 *  那会在装了 VPN/Docker 的机器上挑中隧道地址，手机就连不上了。 */
export function lanAddress(): string | null {
  return pickLan(os.networkInterfaces())
}

/** 所有候选，给界面做「挑错了？换一个」用 */
export function lanList(): LanCandidate[] {
  return lanCandidates(os.networkInterfaces())
}

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex')

/** 手机页面本体的位置。打包后在 resources/phone，开发时在仓库里。 */
const pageFile = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'phone', 'index.html')
    : path.join(app.getAppPath(), 'resources', 'phone', 'index.html')

/** 问渲染层要数据。照 mcpBridge.invokeRenderer 的做法，但简单得多：
 *  这里的动作全是纯 store 计算，没有会阻塞等人的那一类。 */
export function queryRenderer(action: string, args: unknown): Promise<unknown> {
  const win = mainWindow()
  // 必须是主窗口 —— 灵动岛也是 BrowserWindow，但它的 preload 里没有这个监听，
  // 挑到它这次调用只会一直等到超时。mcpBridge 顶部记过同一个坑。
  if (!win) return Promise.reject(new Error('renderer-not-ready'))
  const id = seq++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('renderer-timeout'))
    }, QUERY_TIMEOUT_MS)
    pending.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    win.webContents.send('phone:query', { id, action, args })
  })
}

export function registerPhoneQueryReply(): void {
  ipcMain.on('phone:query:reply', (_e, id: number, data: unknown) => {
    const fn = pending.get(id)
    pending.delete(id)
    fn?.(data)
  })
}

interface Res {
  code: number
  body: unknown
}

/** 读一个文件给手机看。**两道校验，缺一不可**（技术设计文档「数据流」那节）：
 *  ① 渲染层的 resolveFile —— 这个 id 得是该项目 Frame 里真实存在的节点
 *  ② 这里的 fsGuard —— 解析出的路径得在项目根 / 知识库根内
 *  顺序不能反：先拿路径再判边界。反过来（手机直接给路径）的话，
 *  项目根里**任何**文件都能被读，包括没摆上画布的 .env。 */
async function readFile(projectId: unknown, nodeId: unknown): Promise<Res> {
  if (typeof projectId !== 'string' || typeof nodeId !== 'string')
    return { code: 400, body: { error: 'bad-args' } }
  const found = (await queryRenderer('resolve', { projectId, nodeId })) as
    | { path: string; kind: 'doc' | 'image' }
    | null
  if (!found) return { code: 404, body: { error: 'not-in-frame' } }

  const g = guardPath(found.path)
  if (!g.ok) return { code: 403, body: { error: 'out-of-bounds' } }

  try {
    if (found.kind === 'image') {
      // 图片先原样回，压缩留到第 5 步（手机页面）时按实际观感调。
      // 大图先挡住：手机上看一张 40MB 的原图没有意义，还占满局域网带宽。
      const st = fs.statSync(g.path)
      if (st.size > 8 * 1024 * 1024) return { code: 413, body: { error: 'image-too-large' } }
      const b64 = fs.readFileSync(g.path).toString('base64')
      const ext = path.extname(g.path).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext
      return { code: 200, body: { kind: 'image', dataUrl: `data:image/${mime};base64,${b64}` } }
    }
    const buf = fs.readFileSync(g.path)
    const truncated = buf.length > MAX_TEXT
    return {
      code: 200,
      body: {
        kind: 'doc',
        text: buf.subarray(0, MAX_TEXT).toString('utf8'),
        // **明说截断了**。静默截会让人以为文件就这么长，然后按半截内容做判断
        truncated
      }
    }
  } catch {
    return { code: 404, body: { error: 'read-failed' } }
  }
}

/** 一个请求的完整处理。鉴权和白名单各只有一处，都在这里。 */
async function handle(req: http.IncomingMessage, body: string): Promise<Res> {
  const url = (req.url ?? '/').split('?')[0]
  const st = hooks?.getState()
  if (!st) return { code: 503, body: { error: 'not-ready' } }

  // ── 不需要 token 的三个 ──────────────────────────────────
  if (req.method === 'GET' && url === '/health') return { code: 200, body: { ok: true } }

  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    try {
      return { code: 200, body: { __html: fs.readFileSync(pageFile(), 'utf8') } }
    } catch {
      return { code: 500, body: { error: 'page-missing' } }
    }
  }

  if (req.method === 'POST' && url === '/pair') {
    let code = ''
    let name: string | undefined
    try {
      const j = JSON.parse(body || '{}') as { code?: unknown; name?: unknown }
      code = typeof j.code === 'string' ? j.code : ''
      name = typeof j.name === 'string' ? j.name : undefined
    } catch {
      return { code: 400, body: { error: 'bad-json' } }
    }
    const { claim } = await import('./pairing')
    const r = claim(st, code, name, Date.now())
    if (!r.ok) return { code: 400, body: { error: r.reason } }
    hooks?.setState(r.state)
    hooks?.onClaim()
    return { code: 200, body: { ok: true } }
  }

  if (req.method === 'GET' && url === '/pair/wait') {
    // 电脑上点了「允许」之后，index.ts 会把明文 token 暂存到 issuedToken；
    // 手机轮到它就取走，**取走即清**——明文在系统里只存在这一瞬。
    const t = takeIssuedToken()
    if (t) return { code: 200, body: { token: t } }
    // 还没点 → 200 + 空，让手机继续等。用 204/404 会让 fetch 那边多分一层情况
    return { code: 200, body: { pending: true } }
  }

  // ── 以下都要 token ───────────────────────────────────────
  const auth = req.headers['authorization']
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const dev = token ? findDevice(st, sha256(token)) : null
  // **401 故意不区分原因**：区分了等于告诉探测方「这个 token 曾经有效」。
  // 手机端把 401 一律当「要重新配对」，反正用户的动作是同一个。
  if (!dev) return { code: 401, body: { error: 'unauthorized' } }
  hooks?.setState(touch(st, dev.id, Date.now()))

  if (req.method !== 'POST' || url !== '/api') return { code: 404, body: { error: 'no-route' } }

  let action = ''
  let args: Record<string, unknown> = {}
  try {
    const j = JSON.parse(body || '{}') as { action?: unknown; args?: unknown }
    action = typeof j.action === 'string' ? j.action : ''
    args = j.args && typeof j.args === 'object' ? (j.args as Record<string, unknown>) : {}
  } catch {
    return { code: 400, body: { error: 'bad-json' } }
  }

  // **白名单闸。在进任何业务分支之前。**
  // 不在表上的一律 403 —— 藏起手机上的按钮不算白名单。
  if (!isAllowed(action, READ_ONLY)) return { code: 403, body: { error: 'not-allowed' } }

  // **留痕：放在业务分支之前，成不成都记。**
  // 记在这里而不是各分支里，是因为「记录一次请求」这件事不该依赖某个分支记得去调它 ——
  // 漏一个分支就是一个看不见的盲区，而盲区正是留痕最不能有的东西。
  const line = audit.describe(action, args)
  if (line) {
    audit.record({ at: Date.now(), deviceId: dev.id, deviceName: dev.name, action, detail: line })
    hooks?.onClaim() // 复用「推一次状态」——界面上的留痕列表要跟着更新
  }

  // ── 新建对话：**立即执行，不等电脑上确认** ────────────────────
  //
  // 原来这里挂了一道「等人在电脑上点允许」的闸，2026-08-29 拆掉了。
  // 用户一句话点破：**要求电脑确认，恰恰假设了你能碰到电脑** ——
  // 而这个功能存在的理由就是人不在电脑前。那道闸让功能在它唯一的使用场景下失效。
  //
  // 拆掉之后风险并没有变高，因为这个动作本身是**惰性的**：
  // 它只是往画布上加一个空的对话节点（addFileNode），**不启动任何进程**——
  // CLI 要等有人真的发消息才起。我早先把它说成「能在你电脑上拉起进程」，那是错的。
  //
  // 兜底的三样仍在：① 设备得先配过对（那一步有人工确认）；
  // ② 每一次都留痕；③ 只能建在已有的顶层 Frame 里，cwd 取项目自己的路径
  //（边界写在 renderer/features/phone/provider.ts 的 createSession）。
  if (action === 'newSession') {
    try {
      const d = (await queryRenderer('createSession', args)) as
        | { ok: boolean; nodeId?: string; error?: string }
        | null
      const pid = String(args.projectId ?? '').slice(0, 8)
      // **成和不成都记。** 失败也是「手机试过这件事」，回到电脑前该看得见
      audit.record({
        at: Date.now(),
        deviceId: dev.id,
        deviceName: dev.name,
        action,
        detail: d?.ok ? `在项目 ${pid} 里新建了一个 AI 对话` : `想在项目 ${pid} 里新建对话，没成：${d?.error ?? '建不出来'}`,
        outcome: d?.ok ? 'allowed' : undefined
      })
      hooks?.onClaim()
      if (!d?.ok) return { code: 400, body: { error: d?.error ?? '建不出来' } }
      return { code: 200, body: { nodeId: d.nodeId } }
    } catch (e) {
      return { code: 503, body: { error: e instanceof Error ? e.message : String(e) } }
    }
  }

  // ── 给一个正在跑的会话发消息（第二步）────────────────────────────
  //
  // **不走 queryRenderer。** 那条路要渲染层应答，而渲染层里知道这个会话的
  // 只有那个 AgentChatView 组件 —— 画布把视口外的面板裁掉（PaneLayer 的视口裁剪），
  // 面板一被裁掉就不在了。走它的话，「手机能不能发消息」就取决于
  // 「你电脑上的画布此刻滚到哪儿」—— 而这功能正是为够不着电脑时用的。
  //
  // 直接进主进程：会话在 sessions 表里，跟界面开没开无关。
  // 桌面那侧的显示由 deliverExternalMessage 推的 user.message 事件负责，
  // 面板没开时被 preload 缓冲接住，开的时候补上。
  if (action === 'send') {
    let sid = typeof args.sessionId === 'string' ? args.sessionId : ''
    const text = typeof args.text === 'string' ? args.text.trim() : ''
    if (!text) return { code: 400, body: { error: '消息不能为空' } }
    // ── 还没启动的对话：**第一条消息顺带把它拉起来**（2026-08-30 用户要求）──
    //
    // 手机新建出来的对话本来只是画布上一个空节点，不启动任何进程 ——
    // 建出来一个聊不了的框没有意义。所以这里补上：没有 sessionId 但给了 nodeId，
    // 就走渲染层把它跑起来（那边有画布状态，能把 sessionId 写回节点）。
    //
    // **边界在渲染层那侧写死**（provider.ts 的 startSession）：
    // 只能启动画布上已经存在的节点、cwd 用项目自己的路径、
    // 已经在跑的直接拒、CLI 不由手机选。这里不重复判断 ——
    // 同一件事判两处，「到底谁说了算」就有两个答案。
    if (!sid) {
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : ''
      if (!nodeId) return { code: 400, body: { error: '缺少 sessionId 或 nodeId' } }
      if (text.length > 4000) return { code: 413, body: { error: '消息太长（上限 4000 字）' } }
      try {
        const d = (await queryRenderer('startSession', { ...args, message: text })) as
          | { ok: boolean; sessionId?: string; error?: string }
          | null
        const pid = String(args.projectId ?? '').slice(0, 8)
        audit.record({
          at: Date.now(),
          deviceId: dev.id,
          deviceName: dev.name,
          action,
          // **只记长度不记正文**（同下面那条）
          detail: d?.ok
            ? `在项目 ${pid} 里启动了一个 AI 对话，并发了第一条（${text.length} 字）`
            : `想启动 ${pid} 里的一个对话，没成：${d?.error ?? '起不来'}`,
          outcome: d?.ok ? 'allowed' : undefined
        })
        hooks?.onClaim()
        if (!d?.ok || !d.sessionId) return { code: 400, body: { error: d?.error ?? '起不来' } }
        // 启动时第一条消息已经带进去了，不用再发一次
        return { code: 200, body: { ok: true, sessionId: d.sessionId } }
      } catch (e) {
        return { code: 503, body: { error: e instanceof Error ? e.message : String(e) } }
      }
    }
    // **长度上限。** 手机端输入框限不住协议 —— 不设的话一次请求能把
    // 几 MB 文本灌进 CLI 的 stdin
    if (text.length > 4000) return { code: 413, body: { error: '消息太长（上限 4000 字）' } }
    const r = deliverExternalMessage(sid, text)
    // **成和不成都记。** 失败也是「手机试过这件事」，回到电脑前该看得见。
    // **只记长度不记正文** —— 留痕的用途是「回来之后知道发生过什么」，
    // 不是把对话再存一份（audit.ts 顶部那条）
    audit.record({
      at: Date.now(),
      deviceId: dev.id,
      deviceName: dev.name,
      action,
      detail: r.ok
        ? `给会话 ${sid.slice(0, 8)} 发了一条消息（${text.length} 字）`
        : `想给会话 ${sid.slice(0, 8)} 发消息，没成：${r.error ?? '发不出去'}`,
      outcome: r.ok ? 'allowed' : undefined
    })
    hooks?.onClaim()
    if (!r.ok) return { code: 400, body: { error: r.error ?? '发不出去' } }
    return { code: 200, body: { ok: true } }
  }

  // 读一个会话最近的对话。**不走 queryRenderer**，理由同 send：
  // 对话内容在渲染层只活在那个组件里，而画布会把视口外的面板裁掉。
  // 主进程手里有完整事件流，摘要就留在那儿（transcript.ts，两层上限）。
  if (action === 'transcript') {
    const sid = typeof args.sessionId === 'string' ? args.sessionId : ''
    if (!sid) return { code: 400, body: { error: '缺少 sessionId' } }
    // **AI 对话和终端走同一个动作。** 手机上它们是同一件事（「这个东西在说什么」），
    // 分成两个接口只会让手机端多一处判断，而判断错了就是白屏。
    // 谁是谁按 kind 分：AI 对话读事件流摘要，终端读原始输出的尾巴。
    if (args.kind === 'terminal') {
      // **终端的 sessionId 其实是 ptyId** —— 会话列表里那个字段对终端就是 ptyId
      //（collect.ts 的 slotOf 对 terminal 返回 p.ptyId）。
      // 这条 API 不纠正它：改字段名要动手机端和采集层两处，
      // 而这里只要按 kind 分流就够了。
      return {
        code: 200,
        body: { data: readTermTail(sid, 300).map((t) => ({ role: 'assistant', text: t, at: 0 })) }
      }
    }
    // **不记留痕**：手机上下拉刷新会反复调，记了会把留痕淹掉；
    // 而「他看了一眼回复没有」也不是事后要复核的东西（同 status 那条）
    return { code: 200, body: { data: readTranscript(sid, 40) } }
  }

  if (action === 'file') return readFile(args.projectId, args.nodeId)

  try {
    const data = await queryRenderer(action, args)
    return { code: 200, body: { data } }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 渲染层没就绪 / 超时 → 503「电脑正忙」，不是 500。用户的下一步是重试，不是报 bug
    return { code: 503, body: { error: msg } }
  }
}

/** 电脑上点「允许」之后由 index.ts 塞进来的明文 token，等手机来取。
 *  **取走即清**，而且只在内存里 —— 明文永远不落盘。 */
let issuedToken: string | null = null
export function setIssuedToken(t: string): void {
  issuedToken = t
}
function takeIssuedToken(): string | null {
  const t = issuedToken
  issuedToken = null
  return t
}

export function isRunning(): boolean {
  return !!server
}
export function endpoint(): { host: string; port: number } | null {
  return server ? { host: boundHost, port: boundPort } : null
}

/** 起服务。**绑局域网地址，不绑 0.0.0.0** —— 见文件头。 */
export function start(h: Hooks, preferHost?: string): { ok: boolean; error?: string } {
  if (server) return { ok: true }
  hooks = h
  // 指定了就用指定的（前提是它真在候选里，不接受任意地址 —— 那等于允许绑 0.0.0.0）
  const host = preferHost && lanList().some((c) => c.address === preferHost) ? preferHost : lanAddress()
  if (!host) return { ok: false, error: '没有可用的局域网地址（没连 Wi-Fi？）' }

  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      // 请求体上限：这条路上最大的输入就是配对码和几个 id，1MB 绰绰有余。
      // 不设上限的话一个大 POST 就能把内存吃穿。
      if (size > 1024 * 1024) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      void handle(req, Buffer.concat(chunks).toString('utf8'))
        .then((r) => {
          const html = (r.body as { __html?: string })?.__html
          if (typeof html === 'string') {
            res.writeHead(r.code, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(html)
            return
          }
          res.writeHead(r.code, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(r.body))
        })
        .catch(() => {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal' }))
        })
    })
  })

  try {
    // 端口 0 = 让系统挑一个空闲的。固定端口没有好处：手机是扫码拿地址的，
    // 不需要人记住端口；固定反而更容易被同网段扫到。
    server.listen(0, host, () => {
      const addr = server?.address()
      boundHost = host
      boundPort = typeof addr === 'object' && addr ? addr.port : 0
      console.log(`[phone] listening on ${boundHost}:${boundPort}`)
    })
  } catch (e) {
    server = null
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true }
}

/** 关服务。**同步关掉，不等退出** —— 用户点了开关就该立刻看不到那个端口。 */
export function stop(): void {
  server?.close()
  server = null
  boundHost = ''
  boundPort = 0
  issuedToken = null
  pending.clear()
}

app.on('will-quit', stop)
