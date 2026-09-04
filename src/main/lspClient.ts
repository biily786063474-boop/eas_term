// 一个够用的 LSP 客户端：起服务器、握手、问 callHierarchy。**零 electron。**
//
// ── 为什么照着 `omp/transport.ts` 的形状写 ──────────────────────────────────
// LSP 和 ACP 是同一种协议形态（JSON-RPC over stdio ＋ Content-Length 分帧），
// 而 transport.ts 那套状态机的纪律是用事故换来的，这里逐条照抄：
//   · 进程死了要**合成一个终止结果**，不能让调用方永远等（omp 卡「正在处理」那次）
//   · 每个请求都要有超时，且超时要能区分「没回」和「回了坏包」
//   · stderr 单独收着，失败时给用户看**一句人话**而不是倒日志
//
// ── 边界：这里只做「问一次、拿一次」──────────────────────────────────────
// 不做增量同步（didChange）、不做诊断、不做补全。邻域视图只需要
// initialize → didOpen → prepareCallHierarchy → incoming/outgoingCalls。
// 多做的每一样都要跟着维护服务器的生命周期，而那是纯成本。

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { LspDecoder, encodeLsp, pathToUri } from '../shared/lspFraming.ts'

/** 一次请求最多等多久。**服务器首次要建索引**，clangd 在中等项目上要几秒。 */
const REQUEST_TIMEOUT_MS = 20_000
/** 起进程之后等它 initialize 回来的时间。 */
const INIT_TIMEOUT_MS = 25_000

export interface LspServerSpec {
  /** 可执行文件名（在 PATH 上找） */
  bin: string
  args: string[]
  /** 显示名 */
  label: string
}

interface Pending {
  resolve: (v: unknown) => void
  timer: NodeJS.Timeout
}

export class LspClient {
  private proc: ChildProcess | null = null
  private readonly dec = new LspDecoder()
  private readonly pending = new Map<number, Pending>()
  private seq = 0
  private stderr = ''
  /** 进程已经不在了。**所有等待中的请求都要被叫醒**，否则界面永远转圈 */
  private dead = false

  private readonly spec: LspServerSpec
  private readonly root: string

  // ⚠️ **不能用 TS 的「参数属性」**（`constructor(private readonly x: T)`）——
  // Node 的类型剥离（`node --test` / `--experimental-strip-types`）不支持它，
  // 会在加载时抛 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。
  // 本仓库所有 main/shared 下的模块都要能被 node 直接加载，这是硬约束。
  constructor(spec: LspServerSpec, root: string) {
    this.spec = spec
    this.root = root
  }

  /** 起进程并握手。失败时抛一句**人话**（调用方直接显示给用户）。 */
  async start(): Promise<void> {
    let p: ChildProcess
    try {
      p = spawn(this.spec.bin, this.spec.args, { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch {
      throw new Error(`起不了 ${this.spec.label} —— 这台机器上没有 ${this.spec.bin}`)
    }
    this.proc = p
    p.on('error', () => this.die(`起不了 ${this.spec.label} —— 这台机器上没有 ${this.spec.bin}`))
    p.stderr?.setEncoding('utf8')
    p.stderr?.on('data', (s: string) => {
      // **只留尾部**：语言服务器的 stderr 能刷几十 MB（clangd 的 index 日志）
      this.stderr = (this.stderr + s).slice(-4000)
    })
    p.stdout?.on('data', (chunk: Buffer) => {
      for (const msg of this.dec.push(chunk)) this.dispatch(msg)
    })
    p.on('exit', (code) =>
      this.die(`${this.spec.label} 退出了（code ${code ?? '?'}）${this.hint()}`)
    )

    const res = (await this.request(
      'initialize',
      {
        processId: process.pid,
        rootUri: pathToUri(this.root),
        workspaceFolders: [{ uri: pathToUri(this.root), name: path.basename(this.root) }],
        capabilities: {
          textDocument: {
            callHierarchy: { dynamicRegistration: false },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            references: {}
          }
        }
      },
      INIT_TIMEOUT_MS
    )) as { capabilities?: { callHierarchyProvider?: unknown } } | null

    if (!res) throw new Error(`${this.spec.label} 没有回应 initialize${this.hint()}`)
    if (!res.capabilities?.callHierarchyProvider) {
      throw new Error(`${this.spec.label} 不支持调用层级（callHierarchy），画不了邻域`)
    }
    this.notify('initialized', {})
  }

  /** stderr 尾部里最像原因的那一行，拼进错误消息。**不倒整段日志给用户。** */
  private hint(): string {
    const line = this.stderr
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^I\[|^V\[/.test(l)) // clangd 的 info/verbose 前缀
      .pop()
    return line ? `：${line.slice(0, 160)}` : ''
  }

  private die(reason: string): void {
    if (this.dead) return
    this.dead = true
    // **把所有等待中的请求叫醒**，否则调用方永远等（omp 那次「卡正在处理」的教训）
    for (const [, w] of this.pending) {
      clearTimeout(w.timer)
      w.resolve(null)
    }
    this.pending.clear()
    this.lastError = reason
  }

  /** 进程死掉的原因（调用方拿去显示）。 */
  lastError: string | null = null

  private dispatch(msg: unknown): void {
    const m = msg as { id?: number; result?: unknown; error?: { message?: string } }
    if (typeof m.id !== 'number') return // 通知（诊断之类），这里不关心
    const w = this.pending.get(m.id)
    if (!w) return
    clearTimeout(w.timer)
    this.pending.delete(m.id)
    // **错误也 resolve(null)，不 reject** —— 调用方要的是「有没有答案」，
    // 而 reject 会让一次失败的查询变成一条未捕获异常
    w.resolve(m.error ? null : (m.result ?? null))
  }

  private send(obj: unknown): void {
    try {
      this.proc?.stdin?.write(encodeLsp(obj))
    } catch {
      this.die(`${this.spec.label} 的输入管道断了`)
    }
  }

  notify(method: string, params: unknown): void {
    if (this.dead) return
    this.send({ jsonrpc: '2.0', method, params })
  }

  request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.dead) return Promise.resolve(null)
    const id = ++this.seq
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        // 超时**不算进程死了** —— 服务器可能只是还在建索引，下一个请求还能用
        resolve(null)
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  /** 告诉服务器一个文件的内容。**必须先 didOpen 才能问那个文件的问题。** */
  openDoc(absFile: string, languageId: string): void {
    let text = ''
    try {
      text = fs.readFileSync(absFile, 'utf8')
    } catch {
      return
    }
    this.notify('textDocument/didOpen', {
      textDocument: { uri: pathToUri(absFile), languageId, version: 1, text }
    })
  }

  stop(): void {
    this.die(`${this.spec.label} 已停止`)
    try {
      this.proc?.kill()
    } catch {
      /* 已经没了 */
    }
    this.proc = null
  }
}
