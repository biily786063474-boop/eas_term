import type { BuiltinHosted } from './builtinCapabilityHost.ts'
import type { McpToolDef } from './mcpClient.ts'

/** A real McpClient bound to Bizone's official stdio server in production. */
export interface BizoneClient {
  readonly alive: boolean
  /** 进程真实退出（或起不来）时落定；准入预算只认它，不认 close() 的返回。 */
  readonly exited: Promise<void>
  initialize(version: string): Promise<void>
  listTools(): Promise<McpToolDef[]>
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  close(): void
}
export interface BizoneConnectorDeps {
  version: string
  /** Undefined is catalog-only startup: never launch the GUI here.
   * Revision is an opaque identity, never a token. Credentials stay in trusted wiring. */
  createClient(endpointRevision: string | undefined): BizoneClient
  backend: { ensureRunning(): Promise<{ revision: string }> }
  /** 资源准入（2026-09-13）：官方客户端是一个 node 进程，创建前先排队；start 回调里才 createClient，
   *  completed 交 client.exited。生产由 bizoneHosted 注入应用级 startManagedSession；
   *  测试注入直通或可控的假准入。**必填**，避免哪条装配忘了接就静默绕过。 */
  admit<T>(opts: { id: string; name: string; cost: { cpu: number; memoryBytes: number }; start: (signal: AbortSignal) => Promise<{ value: T; completed: Promise<unknown> }> }): Promise<T>
}
/** 官方客户端进程的首版预留：一个 node 进程 + 握手。估算，不是实测峰值。 */
export const BIZONE_CLIENT_COST = { cpu: 5, memoryBytes: 256 * 1024 ** 2 }

/** One official client per hosted facade. Serialize catalog/call/rotation so a new
 * endpoint cannot kill another session's in-flight operation. This connector NEVER
 * retries tools/call, even for reads: reconnecting is not replaying an operation.
 * Paid-operation confirmation and reconciliation belong to the outer journal. */
export function createBizoneConnector(deps: BizoneConnectorDeps): BuiltinHosted {
  let closed = false
  let tail: Promise<unknown> = Promise.resolve()
  let current: { client: BizoneClient; revision: string | undefined } | undefined
  let admissionSeq = 0

  function dispose(): void {
    const previous = current
    current = undefined
    previous?.client.close()
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('Bizone connector closed'))
    const work = tail.then(async () => {
      if (closed) throw new Error('Bizone connector closed')
      try { return await operation() }
      finally { if (closed) dispose() }
    })
    // A failure belongs to that request only; it must not poison future handshakes.
    tail = work.catch(() => {})
    return work
  }
  async function clientFor(revision: string | undefined): Promise<BizoneClient> {
    if (current?.client.alive && current.revision === revision) return current.client
    dispose()
    // 准入回调里才创建进程；排队被取消/超时就不会有任何进程。预算随 exited 释放。
    const client = await deps.admit<BizoneClient>({
      id: 'bizone-client:' + (++admissionSeq), name: '笔纵画板连接器启动', cost: BIZONE_CLIENT_COST,
      start: async signal => {
        if (signal.aborted || closed) throw new Error('笔纵连接器启动已取消')
        const created = deps.createClient(revision)
        return { value: created, completed: created.exited }
      }
    }).catch(error => {
      if (error instanceof Error && error.message === 'wait timeout') throw new Error('资源紧张，笔纵连接器启动排队等待未获准入；稍后重试，或在运行中心切回普通模式')
      throw error
    })
    try {
      await client.initialize(deps.version)
      current = { client, revision }
      return client
    } catch (error) {
      client.close()
      throw error
    }
  }
  return {
    kind: 'builtin',
    tools: () => enqueue(async () => {
      const client = await clientFor(current?.revision)
      try { return await client.listTools() }
      catch (error) { dispose(); throw error }
    }),
    call: (name, args, _context, assertAuthorized) => enqueue(async () => {
      const { revision } = await deps.backend.ensureRunning()
      const client = await clientFor(revision)
      // Revalidate after queueing, backend startup and the official handshake.
      assertAuthorized()
      return client.request('tools/call', { name, arguments: args }, 10 * 60 * 1000)
    }),
    close: () => {
      if (closed) return
      closed = true
      // close() is synchronous for HostRegistry; disposal waits for active work.
      void tail.then(dispose)
    }
  }
}
