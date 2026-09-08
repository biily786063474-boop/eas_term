/** One app-global guard per app-owned root. RPC acknowledgment is not generation completion. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { BuiltinHosted } from './builtinCapabilityHost.ts'
import { RequestJournal, isUnsupportedDirectorySync } from './capabilityRequestJournal.ts'

interface Intent { id: string; target: string; tool: string; digest: string; state: 'submitting' | 'unknown' | 'acknowledged'; executionId?: string; prepared?: boolean; retired?: boolean }
const GENERATION = new Set(['generate', 'generate_now', 'confirm_batch_generate', 'run_group', 'matting', 'upscale', 'outpaint', 'relight', 'batch_upscale'])
const FREE = new Set([
  'list_projects', 'get_workspace_overview', 'create_project', 'open_project', 'save_project', 'get_project_info',
  'add_node', 'update_node', 'delete_node', 'get_node', 'list_nodes', 'connect_nodes', 'disconnect_nodes',
  'list_connections', 'search_assets', 'upload_asset', 'insert_asset_to_node', 'list_models', 'import_local_file',
  'get_generation_request', 'reverse_prompt_text', 'get_user_billing_tier', 'get_generation_status', 'list_templates', 'load_template', 'delete_template',
  'import_template', 'list_groups', 'get_group', 'create_group', 'delete_group', 'rename_group', 'update_group',
  'crop', 'grid_split', 'trim_video', 'arrange_nodes', 'list_prompts', 'list_inspirations', 'add_inspiration',
  'get_inspiration', 'delete_inspiration', 'list_inspiration_categories', 'add_inspiration_category'
])

const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
function stable(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Finite acyclic JSON required')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return '[' + Array.from(value, item => stable(item, ancestors)).join(',') + ']'
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Plain JSON required')
    const r = value as Record<string, unknown>
    return '{' + Object.keys(r).sort().map(k => JSON.stringify(k) + ':' + stable(r[k], ancestors)).join(',') + '}'
  } finally { ancestors.delete(value) }
}
const answer = (data: unknown, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], ...(isError ? { isError } : {}) })
const receipt = (status: string, id?: string) => answer({ status, ...(id ? { requestId: id, easOperationId: id } : {}),
  ...(status === 'unknown' ? { message: 'Outcome unknown. Only query this request ID; do not submit another ID. Node status is not request identity.' } : {}) }, status !== 'acknowledged')
function decoded(result: unknown): Record<string, any> | undefined {
  const r = result as { content?: { type?: string; text?: string }[] } | null
  try {
    const parts = r?.content?.filter(c => c.type === 'text' && typeof c.text === 'string')
    if (parts?.length !== 1) return undefined
    const value = JSON.parse(parts[0].text!)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch { return undefined }
}
function regular(path: string, directory = false): void {
  const st = lstatSync(path)
  if (st.isSymbolicLink() || (directory ? !st.isDirectory() : !st.isFile())) throw new Error('Unsafe generation intent path')
}
export function createBizoneGenerationGuard(deps: { appOwnedDataDir: string; underlying: BuiltinHosted }): BuiltinHosted {
  const { appOwnedDataDir: root, underlying } = deps
  if (!isAbsolute(root)) throw new Error('Generation guard requires app-owned absolute directory')
  regular(root, true)
  const path = join(root, 'bizone-generation-intents.json')
  const journal = new RequestJournal(root)
  let seen = false, failed = false, closed = false
  let tail: Promise<unknown> = Promise.resolve()
  function read(): Intent[] {
    if (failed) throw new Error('Generation intent persistence unavailable')
    try {
      regular(root, true)
      try { regular(path) } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !seen) {
          try { lstatSync(join(root, 'capability-requests', 'journal.json')) }
          catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
        }
        throw e
      }
      const data = JSON.parse(readFileSync(path, 'utf8')); seen = true
      // Legacy unknown records cannot be assigned invented upstream identities.
      if (data.version !== 2 || !Array.isArray(data.intents)) throw new Error('Invalid intent ledger')
      const ids = new Set<string>()
      for (const i of data.intents) {
        if (!i || !validId(i.id) || ids.has(i.id) || !GENERATION.has(i.tool) ||
          !/^[a-f0-9]{64}$/.test(i.digest) || !(i.target === '*' || /^[a-f0-9]{64}$/.test(i.target)) ||
          !['submitting', 'unknown', 'acknowledged'].includes(i.state) ||
          (i.executionId !== undefined && !validId(i.executionId)) || (i.prepared !== undefined && typeof i.prepared !== 'boolean') || (i.retired !== undefined && typeof i.retired !== 'boolean') ||
          Object.keys(i).some(k => !['id', 'target', 'tool', 'digest', 'state', 'executionId', 'prepared', 'retired'].includes(k))) throw new Error('Invalid intent ledger')
        ids.add(i.id)
      }
      return data.intents
    } catch { failed = true; throw new Error('Generation intent ledger unreadable; submissions blocked') }
  }
  function persist(intents: Intent[]): void {
    const temp = join(root, 'bizone-generation-' + randomUUID() + '.tmp')
    let fd: number | undefined
    try {
      regular(root, true); fd = openSync(temp, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify({ version: 2, intents })); fsyncSync(fd); closeSync(fd); fd = undefined
      renameSync(temp, path); seen = true
      try { fd = openSync(root, 'r'); fsyncSync(fd) }
      catch (e) { if (!isUnsupportedDirectorySync(e, process.platform)) throw e }
    } catch { failed = true; throw new Error('Generation intent persistence failed; submissions blocked') }
    finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temp) } catch { /* renamed */ } }
  }
  read()
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('Generation guard closed'))
    const next = tail.then(async () => { if (closed) throw new Error('Generation guard closed'); return fn() })
    tail = next.catch(() => {}); return next
  }
  return {
    kind: 'builtin',
    tools: () => enqueue(async () => (await underlying.tools()).map(tool => {
      if (!GENERATION.has(tool.name)) return tool
      const schema = (tool.inputSchema ?? {}) as Record<string, unknown>
      return { ...tool, inputSchema: { ...schema, properties: { ...(schema.properties as object),
        requestId: { type: 'string', description: 'Logical request ID. Reuse for retries. A new ID cannot bypass an uncertain prior submission.' }
      } } }
    })),
    call: (name, args, context, assertAuthorized) => enqueue(async () => {
      assertAuthorized()
      if (!GENERATION.has(name)) return FREE.has(name) ? underlying.call(name, args, context, assertAuthorized) : receipt('unsupported')
      if (!args || typeof args !== 'object' || Array.isArray(args)) return receipt('invalid_arguments')
      const { requestId, easOperationId, ...wireArgs } = args as Record<string, unknown>
      const explicit = requestId ?? easOperationId
      if ((requestId !== undefined && !validId(requestId)) || (easOperationId !== undefined && !validId(easOperationId)) ||
        (requestId !== undefined && easOperationId !== undefined && requestId !== easOperationId)) return receipt('invalid_request_id')
      let digest: string
      try { digest = hash(stable(wireArgs)) } catch { return receipt('invalid_arguments') }
      // Batch/group targets can overlap arbitrary nodes on the globally active canvas.
      const target = ['confirm_batch_generate', 'run_group', 'batch_upscale'].includes(name) || typeof wireArgs.nodeId !== 'string' ? '*' : hash(wireArgs.nodeId)
      const intents = read()
      const query = async (i: Intent): Promise<Record<string, any> | undefined> => {
        try {
          assertAuthorized()
          const result = decoded(await underlying.call('get_generation_request', { requestId: i.id }, context, assertAuthorized))
          if (result?.requestId === i.id && result.tool === i.tool && result.argumentsDigest === i.digest && result.state === 'acknowledged') {
            i.state = 'acknowledged'; if (i.executionId) i.prepared = !i.retired && !!result.result && !result.result.error && result.result.ok !== false && !result.result.estimate_error; persist(intents); return result
          }
        } catch { /* No evidence is never permission to retry. */ }
        return undefined
      }
      // Reconcile all overlapping locks before selecting a new identity.
      for (const i of intents.filter(i => i.state !== 'acknowledged' && (target === '*' || i.target === '*' || i.target === target))) {
        if (!await query(i)) return receipt('unknown', i.id)
      }
      const quote = name === 'generate' && (wireArgs.autoConfirm === undefined || wireArgs.autoConfirm === false)
      let id = explicit as string | undefined
      if (name === 'generate_now') {
        const latestQuote = intents.filter(i => i.target === target && i.executionId).at(-1)
        if (!latestQuote?.prepared) return receipt('not_prepared')
        if (id && intents.some(i => i.executionId === id && i !== latestQuote)) return receipt('not_prepared')
        id ??= intents.slice(intents.indexOf(latestQuote) + 1).filter(i => i.tool === name && i.target === target && i.digest === digest).at(-1)?.id ?? latestQuote.executionId
      }
      let intent = id ? intents.find(i => i.id === id) : undefined
      if (!id && !quote) intent = intents.filter(i => i.tool === name && i.digest === digest && i.target === target).at(-1)
      if (intent) {
        if (intent.tool !== name || intent.digest !== digest || intent.target !== target) return receipt('request_id_conflict', intent.id)
        const envelope = await query(intent)
        return envelope ? answer({ ...(envelope.result && typeof envelope.result === 'object' ? envelope.result : { result: envelope.result }),
          _request: { requestId: intent.id, tool: name, argumentsDigest: digest, state: 'acknowledged' },
          ...(intent.executionId ? { easOperationId: intent.executionId } : {}) }) : receipt('unknown', intent.id)
      }
      // Legacy free quotes are permitted, but cannot create execution authorization.
      const definitions = await underlying.tools()
      if (!definitions.some(t => t.name === 'get_generation_request') ||
        !((definitions.find(t => t.name === name)?.inputSchema as any)?.properties?.requestId)) {
        if (!quote) return receipt('unsupported')
        for (const prior of intents) if (prior.executionId && prior.target === target) { prior.prepared = false; prior.retired = true }
        persist(intents)
        assertAuthorized()
        return underlying.call(name, { ...wireArgs, autoConfirm: false }, context, assertAuthorized)
      }
      // Retire prior quote authorization before configuration can mutate canvas state,
      // including failures and response loss. Querying an old quote cannot revive it.
      if (quote) for (const prior of intents) if (prior.executionId && prior.target === target) { prior.prepared = false; prior.retired = true }
      intent = { id: id ?? randomUUID(), tool: name, digest, target, state: 'submitting', ...(quote ? { executionId: randomUUID() } : {}) }
      intents.push(intent); persist(intents)
      const operation = { scope: 'bizone-generation-v2', project: 'global-canvas', tool: name, arguments: wireArgs }
      // A second durable index detects loss of the primary intent ledger.
      journal.begin(intent.id, operation)
      try {
        assertAuthorized()
        const result = await underlying.call(name, { ...wireArgs, requestId: intent.id }, context, assertAuthorized)
        const meta = decoded(result)?._request
        if (meta?.requestId === intent.id && meta.tool === name && meta.argumentsDigest === digest && meta.state === 'acknowledged') {
          intent.state = 'acknowledged'; if (intent.executionId) { const body = decoded(result)!; intent.prepared = !body.error && body.ok !== false && !body.estimate_error }; persist(intents)
          journal.complete(intent.id, operation, receipt('acknowledged', intent.id))
          if (!intent.executionId) return result
          const payload = decoded(result)!
          return answer({ ...payload, easOperationId: intent.executionId }, !!(result as any)?.isError)
        }
      } catch { /* Query the exact durable upstream identity after response loss. */ }
      intent.state = 'unknown'; persist(intents)
      journal.markUnknown(intent.id, operation)
      const envelope = await query(intent)
      return envelope ? answer({ ...(envelope.result && typeof envelope.result === 'object' ? envelope.result : { result: envelope.result }),
        _request: { requestId: intent.id, tool: name, argumentsDigest: digest, state: 'acknowledged' },
        ...(intent.executionId ? { easOperationId: intent.executionId } : {}) }) : receipt('unknown', intent.id)
    }),
    close: () => { if (!closed) { closed = true; void tail.then(() => underlying.close()) } }
  }
}
