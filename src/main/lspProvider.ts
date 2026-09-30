// 用语言服务器答邻域查询。**和 `tsProvider.ts` 实现同一个契约** ——
// 界面那侧不需要知道是谁在答。
//
// ── 加一门语言 = 往下面那张表里加一行 ──────────────────────────────────────
// 这正是第二期把抽象按 LSP 形状定死换来的：`SymbolRef` 用 0-based 行列，
// 就是 `prepareCallHierarchy` 要的那种，不用转换。
//
// ── 已实测 ─────────────────────────────────────────────────────────────────
// 2026-09-03：`clangd` 与 `sourcekit-lsp` 都在 `/usr/bin`（随 Xcode 装的），
// 握手确认两个都报 `callHierarchyProvider`，并且用一个三层调用的 C 文件
// 端到端验过 `incomingCalls` 答得对（middle 调用了 helper）。
//
// ── 代价，必须如实告诉用户 ──────────────────────────────────────────────────
// 1. **服务器得装**：C/Swift 在 macOS 上白送，Python/Go/Rust 要用户自己装。
//    没装就说「装了 X 才能画」，**不静默降级**。
// 2. **服务器要项目配置才准**：clangd 要 `compile_commands.json`、
//    sourcekit-lsp 要构建过的索引。缺了不报错、**只是答得少** ——
//    这是最危险的失败模式，所以结果里带 `provider` 字段，界面上写出来。
// 3. **索引要时间**：首次查询可能等几秒到几十秒。

import {startManagedSession} from './runtime/sessionStartup.ts'
import {sharedServices} from './runtime/sharedServices.ts'
import fs from 'node:fs'
import path from 'node:path'
import { tm } from '../shared/i18n/current.ts'

import type { SymbolNode } from '../shared/symbolGraph.ts'
import {
  rankAndTrim,
  type CallSite,
  type Neighborhood,
  type ProviderInfo,
  type SymbolRef
} from '../shared/symbolProvider.ts'
import { pathToUri, uriToPath } from '../shared/lspFraming.ts'
import { LspClient, type LspServerSpec } from './lspClient.ts'

/** 语言服务器表。**加一门语言就加一行。** */
interface LangServer extends LspServerSpec {
  extensions: string[]
  languageId: string
  /** 这个服务器要什么项目配置才准。没有时给用户的一句提醒 */
  needs?: (root: string) => string | null
}

export const LANG_SERVERS: LangServer[] = [
  {
    label: 'clangd',
    bin: 'clangd',
    args: ['--log=error', '--background-index'],
    extensions: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.m', '.mm'],
    languageId: 'cpp',
    // clangd 没有编译数据库时只能靠猜 include 路径，跨文件调用基本连不上
    needs: (root) =>
      fs.existsSync(path.join(root, 'compile_commands.json')) ||
      fs.existsSync(path.join(root, 'build', 'compile_commands.json'))
        ? null
        : tm('codegraph.lsp.clangdWarn')
  },
  {
    label: 'sourcekit-lsp',
    bin: 'sourcekit-lsp',
    args: [],
    extensions: ['.swift'],
    languageId: 'swift',
    needs: (root) =>
      fs.existsSync(path.join(root, 'Package.swift')) ||
      fs.existsSync(path.join(root, '.build'))
        ? null
        : tm('codegraph.lsp.swiftWarn')
  },
  {
    label: 'pyright',
    bin: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py', '.pyi'],
    languageId: 'python'
  }
]

/** 在 PATH 上找得到这个可执行文件吗。 */
function hasBin(bin: string): boolean {
  const dirs = (process.env.PATH ?? '').split(':').filter(Boolean)
  // 从 Dock 启动时 PATH 很贫瘠，补上常见位置（同 `probeEnv.ts` 的那条教训）
  const extra = ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', path.join(process.env.HOME ?? '', '.local/bin')]
  for (const d of [...dirs, ...extra]) {
    try {
      const p = path.join(d, bin)
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return true
    } catch {
      /* 下一个 */
    }
  }
  return false
}

/** 这个项目里，各语言服务器的就绪状态（界面上要如实列出来）。 */
export function lspProviders(root: string): ProviderInfo[] {
  return LANG_SERVERS.map((s) => {
    if (!hasBin(s.bin)) {
      return {
        name: s.label,
        extensions: s.extensions,
        status: 'missing' as const,
        detail: tm('codegraph.lsp.missingDetail', { bin: s.bin, exts: s.extensions.slice(0, 3).join('/') })
      }
    }
    const warn = s.needs?.(root)
    return {
      name: s.label,
      extensions: s.extensions,
      status: 'ready' as const,
      ...(warn ? { detail: warn } : {})
    }
  })
}

function serverFor(file: string): LangServer | null {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  return LANG_SERVERS.find((s) => s.extensions.includes(ext)) ?? null
}

// ── 客户端缓存 ──────────────────────────────────────────────────────────────
// 起一个服务器 ＋ 建索引要几秒，交互式查询不能每次重来。
// 按「项目根 ＋ 服务器」缓存，`dropLspClients` 显式失效（界面上「重新解析」时调）。
const clients = new Map<string, { client: LspClient; ready: Promise<LspClient>; serviceId: string; windows:Set<number>; projects:Map<number,string|null> }>()
let serviceSequence = 0

export function dropLspClients(root?: string, windowId?: number): void {
  if (windowId !== undefined) {
    const visible = sharedServices.list(windowId)
    for (const [key, entry] of clients) {
      if (root && !key.startsWith(root + '\0')) continue
      if (!visible.find(service => service.id === entry.serviceId)?.canStop) {
        throw new Error('语言服务器仍被其他窗口使用或正在停止，暂不能重新解析')
      }
    }
  }
  for (const [key, entry] of clients) {
    if (root && !key.startsWith(root + '\0')) continue
    clients.delete(key)
    entry.client.stop()
  }
}

async function clientFor(root: string, s: LangServer, owner?: {windowId:number;projectId:string|null}): Promise<LspClient> {
  const key = `${root}\0${s.bin}`
  const hit = clients.get(key)
  if (hit && !hit.client.lastError) {
    if (owner) { hit.windows.add(owner.windowId);hit.projects.set(owner.windowId,owner.projectId);sharedServices.retain(hit.serviceId, owner.windowId, owner.projectId) }
    return hit.ready
  }
  if (hit) { clients.delete(key); hit.client.stop() }
  const client = new LspClient(s, root)
  const entry = { client, ready: null! as Promise<LspClient>, serviceId: 'lsp:'+(++serviceSequence),windows:new Set<number>(),projects:new Map<number,string|null>() }
  // Publish the in-flight identity before awaiting initialize; concurrent queries share it.
  clients.set(key, entry)
  if (owner) {entry.windows.add(owner.windowId);entry.projects.set(owner.windowId,owner.projectId)}
  entry.ready = (async () => {
    try {
      if (owner) {
        await startManagedSession({id:'lsp-start:'+entry.serviceId,windowId:owner.windowId,sharedWindows:entry.windows,name:s.label+' 启动',projectId:owner.projectId,cost:{cpu:7,memoryBytes:512*1024**2},start:async signal=>{
          if(signal.aborted||!entry.windows.size||clients.get(key)!==entry)throw Error('语言服务器启动已失效')
          const ready=client.start()
          void ready.catch(()=>{}) // The caller observes handshake failure after admission settles.
          sharedServices.add({id:entry.serviceId,name:s.label,kind:'language-server',completed:client.completed,stop:()=>{if(clients.get(key)===entry)clients.delete(key);client.stop()}})
          for(const id of entry.windows)sharedServices.retain(entry.serviceId,id,entry.projects.get(id)??null)
          return {value:ready,completed:client.completed}
        }})
      } else await client.start()
      if (clients.get(key) !== entry) throw new Error('语言服务器启动已失效，请重新查询')
      return client
    } catch (error) {
      if (clients.get(key) === entry) clients.delete(key)
      client.stop()
      throw error
    }
  })()
  return entry.ready
}

/** LSP 的 `CallHierarchyItem`（只列我们用到的字段）。 */
interface HierarchyItem {
  name: string
  kind: number
  uri: string
  range: { start: { line: number; character: number } }
  selectionRange: { start: { line: number; character: number } }
}

/** LSP 的 SymbolKind → 我们的种类。**认不出的一律 other，不猜。** */
function kindOf(k: number): SymbolNode['kind'] {
  if (k === 12) return 'function'
  if (k === 6) return 'method'
  if (k === 5) return 'class'
  return 'other'
}

function toNode(it: HierarchyItem, root: string): SymbolNode {
  const file = uriToPath(it.uri)
  const rel = path.relative(root, file).split(path.sep).join('/')
  return {
    id: `${rel}#${it.name}`,
    file: rel,
    name: it.name,
    kind: kindOf(it.kind),
    // LSP 的行列是 0-based，我们的 `line` 给人看所以 +1；`character` 保持 0-based
    line: it.range.start.line + 1,
    character: it.selectionRange.start.character,
    exported: false,
    refs: 0,
    topLevel: false
  }
}

/**
 * 用语言服务器查一个符号的邻域。
 *
 * @returns 这个扩展名没有对应服务器、或服务器起不来时返回 `{ error }` ——
 *          **如实说，不静默返回空**（空邻域和「查不了」在界面上长得一样，
 *          而它们的下一步完全不同）。
 */
export async function lspNeighborhood(
  root: string,
  ref: SymbolRef,
  owner?: {windowId:number;projectId:string|null}
): Promise<{ ok: true; neighborhood: Neighborhood } | { ok: false; error: string }> {
  const s = serverFor(ref.file)
  if (!s) return { ok: false, error: tm('codegraph.lsp.noServer', { ext: path.extname(ref.file) }) }
  if (!hasBin(s.bin)) {
    return { ok: false, error: tm('codegraph.lsp.missingBin', { bin: s.bin }) }
  }

  let c: LspClient
  try {
    c = await clientFor(root, s, owner)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const abs = path.join(root, ref.file)
  c.openDoc(abs, s.languageId)
  // 给服务器一点时间把这个文件读进去 —— didOpen 是通知，没有回执可等
  await new Promise((r) => setTimeout(r, 400))

  const prep = (await c.request('textDocument/prepareCallHierarchy', {
    textDocument: { uri: pathToUri(abs) },
    position: { line: ref.line, character: ref.character }
  })) as HierarchyItem[] | null

  const item = prep?.[0]
  if (!item) {
    return {
      ok: false,
      error:
        c.lastError ??
        (s.needs?.(root)
          ? tm('codegraph.lsp.noSymbolWithNeed', { label: s.label, need: s.needs(root) ?? '' })
          : tm('codegraph.lsp.noSymbol', { label: s.label }))
    }
  }

  const [inc, out] = await Promise.all([
    c.request('callHierarchy/incomingCalls', { item }),
    c.request('callHierarchy/outgoingCalls', { item })
  ])

  const toSites = (
    arr: unknown,
    pick: 'from' | 'to'
  ): CallSite[] =>
    ((arr ?? []) as { from?: HierarchyItem; to?: HierarchyItem; fromRanges?: { start: { line: number } }[] }[])
      .map((c2) => {
        const it = pick === 'from' ? c2.from : c2.to
        if (!it) return null
        return {
          symbol: toNode(it, root),
          lines: (c2.fromRanges ?? []).map((r) => r.start.line + 1)
        }
      })
      .filter((x): x is CallSite => x !== null)

  const i = rankAndTrim(toSites(inc, 'from'))
  const o = rankAndTrim(toSites(out, 'to'))
  return {
    ok: true,
    neighborhood: {
      center: toNode(item, root),
      incoming: i.sites,
      outgoing: o.sites,
      truncated: i.truncated || o.truncated,
      // **写清是谁答的** —— 不同 provider 的准确率差很远
      provider: s.label
    }
  }
}
