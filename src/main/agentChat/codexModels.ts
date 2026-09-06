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
// 用的接口，实测返回的正是选择器里那几个。探测一次缓存起来 —— 它要起一个短命进程，
// 不该每开一个对话跑一次。
import { spawn } from 'node:child_process'

export interface ModelOption {
  id: string
  label: string
}

/** 从 `model/list` 的一条记录里挑出 id 与显示名。字段缺了就退回 id。 */
export function toOption(raw: unknown): ModelOption | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  if (!id) return null
  const label = typeof r.displayName === 'string' && r.displayName.trim() ? r.displayName.trim() : id
  return { id, label }
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

let cache: ModelOption[] | undefined
let inflight: Promise<ModelOption[] | undefined> | undefined

/** 起一个 `codex app-server`，问一次 model/list，然后收掉。失败一律返回 undefined ——
 *  拿不到清单就退回「没有下拉」，跟这个功能上线前一样，绝不因为探测失败影响开会话。 */
function probe(bin: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ModelOption[] | undefined> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: ModelOption[] | undefined): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        p.kill()
      } catch {
        /* 已经没了 */
      }
      resolve(v)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    let p: ReturnType<typeof spawn>
    try {
      p = spawn(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], env })
    } catch {
      finish(undefined)
      return
    }
    p.on('error', () => finish(undefined))
    p.on('exit', () => finish(undefined))
    let buf = ''
    p.stdout?.setEncoding('utf8')
    p.stdout?.on('data', (chunk: string) => {
      buf += chunk
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const line of parts) {
        if (!line.trim()) continue
        let m: Record<string, unknown>
        try {
          m = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }
        if (m.id === 1) {
          // initialize 回来了 → 问模型
          p.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'model/list', params: {} }) + '\n')
        } else if (m.id === 2) {
          const list = parseModelList(m.result)
          finish(list.length ? list : undefined)
        }
      }
    })
    p.stdin?.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'eas-term', version: '1.0.0' } }
      }) + '\n'
    )
  })
}

export async function listCodexModels(
  opts: { bin?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<ModelOption[] | undefined> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = probe(opts.bin ?? 'codex', opts.env ?? process.env, opts.timeoutMs ?? 15_000).then((v) => {
    inflight = undefined
    if (v) cache = v
    return v
  })
  return inflight
}

/** 测试用：清缓存 */
export function resetCodexModelsCache(): void {
  cache = undefined
  inflight = undefined
}
