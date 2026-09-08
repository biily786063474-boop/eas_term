import crypto from 'node:crypto'

/** Context comes from the owning main-process session, never tools/call arguments. */
export interface CapabilityContext {
  project?: string
  ptyId?: string
  agentSessionId?: string
  agentLeafId?: string
  /** Existing canvas agent node; independent of split-pane leaf identity. */
  agentNodeId?: string
  teamRole?: string
}
export interface CapabilityLease {
  instanceId: string
  generation: string
  id: string
  secret: string
}
interface Entry {
  secret: Buffer
  kind: 'session' | 'launcher'
  context: CapabilityContext
  parentId?: string
}

/** In-memory authority. A locator on disk is deliberately insufficient to mint or renew it. */
export class CapabilitySessions {
  private instanceId: string
  private generation: string
  private entries = new Map<string, Entry>()

  constructor(instanceId: string, generation: string) {
    this.instanceId = instanceId
    this.generation = generation
  }

  issue(context: CapabilityContext, kind: 'session' | 'launcher' = 'session'): CapabilityLease {
    const id = crypto.randomBytes(16).toString('hex')
    const secret = crypto.randomBytes(32)
    this.entries.set(id, { secret, kind, context: { ...context } })
    return { instanceId: this.instanceId, generation: this.generation, id, secret: secret.toString('hex') }
  }

  private checked(lease: CapabilityLease, kind: Entry['kind']): Entry {
    const entry = this.entries.get(lease.id)
    // Validate hex before decoding: Buffer.from silently accepts incomplete hex.
    if (lease.instanceId !== this.instanceId || lease.generation !== this.generation ||
        !entry || entry.kind !== kind || typeof lease.secret !== 'string' || !/^[a-f0-9]{64}$/.test(lease.secret) ||
        !crypto.timingSafeEqual(entry.secret, Buffer.from(lease.secret, 'hex'))) {
      throw new Error('能力会话授权无效或已撤销')
    }
    return entry
  }

  authenticate(lease: CapabilityLease): CapabilityContext {
    return { ...this.checked(lease, 'session').context }
  }
  authenticateLauncher(lease: CapabilityLease): CapabilityContext {
    return { ...this.checked(lease, 'launcher').context }
  }

  /** Only the authenticated managed launcher can bind the invocation's current working directory.
   * The owning PTY/Frame identity cannot be replaced by a child request. */
  issueChild(parent: CapabilityLease, invocation: { project: string }): CapabilityLease {
    const entry = this.checked(parent, 'launcher')
    if (!invocation.project || typeof invocation.project !== 'string' || invocation.project.includes('\0')) {
      throw new Error('CLI 工作目录无效')
    }
    const child = this.issue({ ...entry.context, project: invocation.project })
    this.entries.get(child.id)!.parentId = parent.id
    return child
  }
  revokeChild(parent: CapabilityLease, childId: string): string[] {
    this.checked(parent, 'launcher')
    const child = this.entries.get(childId)
    if (!child) return []
    if (child.parentId !== parent.id) throw new Error('能力会话不属于此终端')
    return this.revoke(childId)
  }

  /** Return every identity actually revoked so the host can release matching refs. */
  revoke(id: string): string[] {
    if (!this.entries.delete(id)) return []
    const revoked = [id]
    for (const [childId, entry] of this.entries) {
      if (entry.parentId === id) revoked.push(...this.revoke(childId))
    }
    return revoked
  }

  revokeAll(): void {
    this.entries.clear()
  }
}
