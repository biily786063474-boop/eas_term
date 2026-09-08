import crypto from 'node:crypto'
import type { HostRegistry } from './hostRegistry.ts'
import type { McpToolDef } from './mcpClient.ts'
import type { CapabilityContext } from './capabilitySessions.ts'
import type { CapabilityState } from '../shared/builtinCapabilities.ts'

export interface BuiltinHosted {
  kind: 'builtin'
  tools(): Promise<McpToolDef[]>
  call(name: string, args: unknown, context: CapabilityContext, assertAuthorized: () => void): Promise<unknown>
  close(): void
}
type BuiltinModule = 'workbench' | 'bizone'
const registryKey = (module: string): string => `\0builtin:${module}`

/** Main-process registrations only. The plugin manifest scanner never receives this object.
 * Names are in a separate registry namespace, so a user plugin cannot impersonate a binding. */
export class BuiltinCapabilityHost<T extends { kind: string }> {
  private registry: HostRegistry<T | BuiltinHosted>
  private factories = new Map<string, () => BuiltinHosted>()
  private connections = new Map<string, { module: string; leaseId: string; connectionId: string; touched: number }>()
  private catalogs = new Map<string, { count?: number; failed: boolean }>()
  private now: () => number
  constructor(registry: HostRegistry<T | BuiltinHosted>, now: () => number = Date.now) {
    this.registry = registry
    this.now = now
  }
  register(module: BuiltinModule, factory: () => BuiltinHosted): void {
    if (this.factories.has(module)) throw new Error(`内置服务已注册：${module}`)
    this.factories.set(module, factory)
  }
  private acquire(module: string, ref: string): BuiltinHosted {
    const factory = this.factories.get(module)
    if (!factory) throw new Error('内置能力未注册')
    const value = this.registry.acquire(registryKey(module), ref, factory)
    if (value.kind !== 'builtin') throw new Error('内置服务身份冲突')
    // The reserved key is created only by the factory above, never manifest names.
    return value as BuiltinHosted
  }
  private connect(module: string, leaseId: string, connectionId: string): BuiltinHosted {
    if (!connectionId) throw new Error('缺少能力连接身份')
    const ref = 'capability:' + JSON.stringify([leaseId, module, connectionId])
    const service = this.acquire(module, ref)
    this.connections.set(ref, { module, leaseId, connectionId, touched: this.now() })
    return service
  }
  /** A ping cannot create a new connection or resurrect a closed reference. */
  heartbeat(module: string, leaseId: string, connectionId: string): boolean {
    const connection = this.connections.get('capability:' + JSON.stringify([leaseId, module, connectionId]))
    if (!connection) return false
    connection.touched = this.now()
    return true
  }
  sweep(): void {
    for (const connection of this.connections.values()) {
      if (this.now() - connection.touched > 45_000) this.releaseModule(connection.leaseId, connection.module, connection.connectionId)
    }
  }
  async list(module: string, leaseId: string, connectionId: string): Promise<McpToolDef[]> {
    return this.loadTools(module, this.connect(module, leaseId, connectionId))
  }
  private async loadTools(module: string, service: BuiltinHosted): Promise<McpToolDef[]> {
    try {
      const tools = await service.tools()
      if (!tools.length) throw new Error('内置能力工具目录为空，连接尚未就绪')
      this.catalogs.set(module, { count: tools.length, failed: false })
      return tools
    } catch (error) {
      this.catalogs.set(module, { failed: true })
      throw error
    }
  }
  status(module: string): Pick<CapabilityState, 'session' | 'toolCount'> {
    const active = [...this.connections.values()].some(connection => connection.module === module)
    const catalog = this.catalogs.get(module)
    if (!active) return { session: 'not-requested' }
    if (catalog?.failed) return { session: 'failed' }
    if (catalog?.count !== undefined) return { session: 'ready', toolCount: catalog.count }
    return { session: 'waiting' }
  }
  async call(module: string, leaseId: string, connectionId: string, tool: string, args: unknown, context: CapabilityContext, assertAuthorized: () => void): Promise<unknown> {
    const service = this.connect(module, leaseId, connectionId)
    const callRef = 'call:' + crypto.randomUUID()
    this.acquire(module, callRef)
    try {
      const tools = await this.loadTools(module, service)
      assertAuthorized()
      if (!tools.some(item => item.name === tool)) throw new Error('内置能力没有这个工具')
      return await service.call(tool, args, { ...context }, assertAuthorized)
    } finally {
      this.registry.release(registryKey(module), callRef)
    }
  }
  releaseModule(leaseId: string, module: string, connectionId: string): void {
    if (!this.factories.has(module) || !connectionId) throw new Error('能力连接身份无效')
    const ref = 'capability:' + JSON.stringify([leaseId, module, connectionId])
    this.connections.delete(ref)
    this.registry.release(registryKey(module), ref)
  }
  /** Owner-only revocation. In-flight calls retain their references until they settle. */
  releaseSession(leaseId: string): void {
    for (const connection of this.connections.values()) {
      if (connection.leaseId === leaseId) this.releaseModule(leaseId, connection.module, connection.connectionId)
    }
  }
}
