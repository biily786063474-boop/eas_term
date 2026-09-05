// 宿主连插件 MCP server 的**客户端**（stdio，一行一条 JSON-RPC）。零依赖，
// 是 mcp/eas-mcp.mjs 的镜像：那边是 server 收请求，这边是 client 发请求。
//
// 只做四件事：initialize 握手、request/notify、收 server 主动发的通知、进程退出时把
// 所有挂着的请求一起拒掉（不这么做，面板会一直转圈等一个永远不来的响应）。
// 帧的切分与解析在 jsonrpcFrames.ts（纯函数，有测试）。
import { spawn, type ChildProcess } from 'node:child_process'
import { classify, encodeFrame, parseFrame, splitFrames } from './jsonrpcFrames.ts'

export interface McpClientOpts {
  /** 日志里怎么称呼它 */
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
}

export interface McpToolDef {
  name: string
  description?: string
  inputSchema?: unknown
  _meta?: Record<string, unknown>
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export const MCP_CLIENT_PROTOCOL = '2025-06-18'

export class McpClient {
  private proc: ChildProcess
  private buf = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private closed = false
  /** server 主动发来的通知（resources/updated 之类） */
  onNotification: ((method: string, params: unknown) => void) | null = null
  /** 进程没了（不管谁杀的）。宿主据此把它从复用表里摘掉 */
  onExit: ((code: number | null) => void) | null = null
  readonly name: string

  constructor(opts: McpClientOpts) {
    this.name = opts.name
    this.proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.proc.stdout?.setEncoding('utf8')
    this.proc.stdout?.on('data', (chunk: string) => this.feed(chunk))
    this.proc.stderr?.setEncoding('utf8')
    this.proc.stderr?.on('data', (s: string) => {
      const t = s.trim()
      if (t) console.log(`[plugin:${this.name}] ${t.slice(0, 400)}`)
    })
    this.proc.on('error', (e) => {
      console.error(`[plugin:${this.name}] 起不来`, e)
      this.failAll(new Error(`插件进程起不来：${e.message}`))
    })
    this.proc.on('exit', (code) => {
      this.closed = true
      this.failAll(new Error('插件进程已退出'))
      this.onExit?.(code)
    })
  }

  get pid(): number | undefined {
    return this.proc.pid
  }
  get alive(): boolean {
    return !this.closed && this.proc.exitCode === null
  }

  private feed(chunk: string): void {
    const { lines, rest } = splitFrames(this.buf, chunk)
    this.buf = rest
    for (const line of lines) {
      const m = parseFrame(line)
      if (!m) continue
      const kind = classify(m)
      if (kind === 'response') {
        const id = typeof m.id === 'number' ? m.id : Number(m.id)
        const p = this.pending.get(id)
        if (!p) continue
        this.pending.delete(id)
        clearTimeout(p.timer)
        if ('error' in m) {
          const err = m.error as { message?: string; code?: number; data?: unknown } | undefined
          const e = new Error(err?.message || 'MCP 错误') as Error & { code?: number; data?: unknown }
          e.code = err?.code
          e.data = err?.data
          p.reject(e)
        } else p.resolve(m.result)
      } else if (kind === 'notification') {
        this.onNotification?.(m.method as string, m.params)
      }
      // server → client 的请求（sampling 之类）一期不支持：不回也不崩
    }
  }

  private failAll(e: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(e)
    }
    this.pending.clear()
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (!this.alive) return Promise.reject(new Error('插件进程不在'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`插件 ${method} 超时（${Math.round(timeoutMs / 1000)}s）`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.proc.stdin?.write(encodeFrame({ jsonrpc: '2.0', id, method, params }))
    })
  }

  notify(method: string, params: unknown): void {
    if (!this.alive) return
    this.proc.stdin?.write(encodeFrame({ jsonrpc: '2.0', method, params }))
  }

  async initialize(clientVersion: string): Promise<void> {
    await this.request('initialize', {
      protocolVersion: MCP_CLIENT_PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'eas-term', version: clientVersion }
    })
    this.notify('notifications/initialized', {})
  }

  async listTools(): Promise<McpToolDef[]> {
    const r = (await this.request('tools/list', {})) as { tools?: McpToolDef[] } | undefined
    return Array.isArray(r?.tools) ? r!.tools! : []
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.proc.stdin?.end()
    } catch {
      /* 已经关了 */
    }
    // 给它 2s 自己退，不退再杀
    const t = setTimeout(() => {
      try {
        this.proc.kill('SIGKILL')
      } catch {
        /* 已经没了 */
      }
    }, 2000)
    t.unref()
    try {
      this.proc.kill('SIGTERM')
    } catch {
      /* 已经没了 */
    }
  }
}
