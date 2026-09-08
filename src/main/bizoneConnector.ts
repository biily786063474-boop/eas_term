import type { BuiltinHosted } from './builtinCapabilityHost.ts'
import type { McpToolDef } from './mcpClient.ts'

/** A real McpClient bound to Bizone's official stdio server in production. */
export interface BizoneClient {
  readonly alive: boolean
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
}

/** One official client per hosted facade. Serialize catalog/call/rotation so a new
 * endpoint cannot kill another session's in-flight operation. This connector NEVER
 * retries tools/call, even for reads: reconnecting is not replaying an operation.
 * Paid-operation confirmation and reconciliation belong to the outer journal. */
export function createBizoneConnector(deps: BizoneConnectorDeps): BuiltinHosted {
  let closed = false
  let tail: Promise<unknown> = Promise.resolve()
  let current: { client: BizoneClient; revision: string | undefined } | undefined

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
    const client = deps.createClient(revision)
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
