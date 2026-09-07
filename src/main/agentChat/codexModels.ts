// 问 Codex 要**这个账号真正能用的模型清单**。零 electron。
//
// 2026-09-06：用户报「codex 进对话之后无法下拉选择模型」。原因是 adapter 的
// `capabilities.models` 是空数组（当时写的是「由 -m 传任意模型名，不预设列表」），
// 而工具栏按 `models.length > 0` 决定显不显示下拉 —— 于是 Codex 那档整个下拉都不存在。
//
// 为什么不像 Claude 那样硬编码：Codex 的模型名带小版本（gpt-5.6-sol / terra / luna…），
// 一个版本一变；而且**每个账号能用的不一样**。硬编码等于隔三差五给用户一个选了就报错的选项。
//
// 数据源：`codex app-server` 的 `model/list`（stdio JSON-RPC）。这是 Codex 自己给桌面客户端
// 用的接口，实测返回的正是选择器里那几个。按来源短期缓存 60 秒 —— 它要起一个短命进程，
// 不该每开一个对话跑一次。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { PROBE_ENV } from '../probeEnv.ts'

export interface ModelOption {
  id: string
  label: string
  effortLevels?: { id: string; label: string }[]
  defaultEffort?: string
}

/** 从 `model/list` 的一条记录里挑出 id 与显示名。字段缺了就退回 id。 */
export function toOption(raw: unknown): ModelOption | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  if (!id) return null
  const label = typeof r.displayName === 'string' && r.displayName.trim() ? r.displayName.trim() : id
  const option: ModelOption = { id, label }
  if (Array.isArray(r.supportedReasoningEfforts)) {
    const seen = new Set<string>()
    const levels: { id: string; label: string }[] = []
    for (const item of r.supportedReasoningEfforts) {
      if (!item || typeof item !== 'object') continue
      const effort = typeof item.reasoningEffort === 'string' ? item.reasoningEffort.trim() : ''
      if (!effort || seen.has(effort)) continue
      seen.add(effort)
      levels.push({ id: effort, label: typeof item.description === 'string' && item.description.trim() ? item.description.trim() : effort })
    }
    if (levels.length) option.effortLevels = levels
  }
  if (typeof r.defaultReasoningEffort === 'string' && r.defaultReasoningEffort.trim()) {
    option.defaultEffort = r.defaultReasoningEffort.trim()
  }
  return option
}

export function parseModelList(result: unknown): ModelOption[] {
  const r = result as { data?: unknown } | undefined
  const arr = Array.isArray(r?.data) ? r!.data! : []
  const out: ModelOption[] = []
  const seen = new Set<string>()
  for (const it of arr) {
    const o = toOption(it)
    if (o && !seen.has(o.id)) {
      seen.add(o.id)
      out.push(o)
    }
  }
  return out
}

// Only successful discoveries are cached, briefly and per binary/environment source.
const CACHE_MS = 60_000
const cache = new Map<string, { value: ModelOption[]; expires: number }>()
const inflight = new Map<string, Promise<ModelOption[] | undefined>>()

function probe(bin: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ModelOption[] | undefined> {
  return new Promise((resolve) => {
    let done = false
    let p: ReturnType<typeof spawn> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: ModelOption[] | undefined): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (p) {
        p.stdin?.destroy()
        p.stdout?.destroy()
        if (p.exitCode === null && p.signalCode === null) {
          try { p.kill() } catch { /* already gone */ }
          killTimer = setTimeout(() => { try { p?.kill('SIGKILL') } catch { /* already gone */ } }, 250)
          killTimer.unref()
        }
      }
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    const write = (message: object): void => {
      if (done) return
      try {
        if (!p?.stdin?.writable) return finish(undefined)
        p.stdin.write(JSON.stringify(message) + '\n', error => { if (error) finish(undefined) })
      } catch { finish(undefined) }
    }
    try { p = spawn(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], env }) }
    catch { finish(undefined); return }
    p.on('error', () => finish(undefined))
    p.on('close', () => { clearTimeout(killTimer); finish(undefined) })
    p.stdin?.on('error', () => finish(undefined))
    p.stdout?.on('error', () => finish(undefined))
    let buf = ''
    let requestId = 1
    let pages = 0
    const cursors = new Set<string>()
    const models = new Map<string, ModelOption>()
    const list = (cursor?: string): void => {
      requestId++
      write({ jsonrpc: '2.0', id: requestId, method: 'model/list', params: cursor ? { cursor } : {} })
    }
    p.stdout?.setEncoding('utf8')
    p.stdout?.on('data', (chunk: string) => {
      buf += chunk
      if (buf.length > 4 * 1024 * 1024) return finish(undefined)
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (done) return
        if (!line.trim()) continue
        let m: Record<string, unknown>
        try { m = JSON.parse(line) } catch { finish(undefined); return }
        if (!m || typeof m !== 'object' || Array.isArray(m)) return finish(undefined)
        if (m.id !== requestId) continue // Notifications and unrelated responses are not our reply.
        if ('error' in m || !m.result || typeof m.result !== 'object' || Array.isArray(m.result)) return finish(undefined)
        if (requestId === 1) {
          write({ jsonrpc: '2.0', method: 'initialized' })
          list()
          continue
        }
        const result = m.result as { data?: unknown; nextCursor?: unknown }
        if (!Array.isArray(result.data)) return finish(undefined)
        for (const option of parseModelList(result)) if (!models.has(option.id)) models.set(option.id, option)
        const cursor = result.nextCursor
        if (cursor === null || cursor === undefined || cursor === '') {
          finish(models.size ? [...models.values()] : undefined)
          return
        }
        if (typeof cursor !== 'string' || cursors.has(cursor) || ++pages >= 100) return finish(undefined)
        cursors.add(cursor)
        list(cursor)
      }
    })
    write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'eas-term', version: '1.0.0' } } })
  })
}

export async function listCodexModels(
  opts: { bin?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; force?: boolean } = {}
): Promise<ModelOption[] | undefined> {
  const bin = opts.bin ?? 'codex'
  const env = { ...(opts.env ?? PROBE_ENV) }
  // Hash rather than retain environment values (which may contain credentials).
  const key = createHash('sha256').update(JSON.stringify([bin, Object.entries(env).sort(([a], [b]) => a.localeCompare(b))])).digest('hex')
  const now = Date.now()
  for (const [source, entry] of cache) if (entry.expires <= now) cache.delete(source)
  if (!opts.force && cache.has(key)) return cache.get(key)!.value
  if (inflight.has(key)) return inflight.get(key)!
  if (opts.force) cache.delete(key)
  const pending = probe(bin, env, opts.timeoutMs ?? 15_000).then(value => {
    if (inflight.get(key) === pending) {
      inflight.delete(key)
      if (value) cache.set(key, { value, expires: Date.now() + CACHE_MS })
    }
    return value
  })
  inflight.set(key, pending)
  return pending
}

/** Tests: invalidate cache and prevent older pending probes from repopulating it. */
export function resetCodexModelsCache(): void {
  cache.clear()
  inflight.clear()
}
