// 模型清单的**三级取值**：探测 → 上次探测成功的结果 → adapter 里的兜底清单。
// 纯逻辑（合并、取舍、落盘内容）在这里，可单测；读写文件的壳在下面几个小函数里。
//
// 用户 2026-09-06 定的两条：
//   ① **所有模型列表都不要硬编码** —— 模型名随版本和账号变，写死等于隔三差五给一个
//      选了就报错的选项（Codex 的 gpt-5.6-sol/terra/luna 就是这样）。
//   ② **拉不到要有降级和兜底** —— 探测要起进程、要联网，失败是常态，不能一失败就没有下拉。
//
// 于是：
//   主路径 = `CliAdapter.probeModels()`（Codex 问 app-server 的 model/list，omp 问 omp models --json）
//   降级   = 上一次探测成功的结果（落在 userData/model-catalog.json，**这不是硬编码**：
//            它是这台机器上真实成功过的清单，比任何写死的都新）
//   兜底   = adapter 的 `capabilities.models`，**只在从没探测成功过时用**，且必须标注来源
//            （Claude Code 2.1.263 确实没有任何列模型的接口：无 models 子命令、doctor 不报、
//             二进制里的目录没有可靠结构。查过了才写死这几个别名。）

import type { ChatModelOption } from '../../shared/agentChat.ts'
export type ModelOption = ChatModelOption

export type ModelSource = 'probe' | 'cache' | 'fallback' | 'none'

export interface ResolvedModels {
  models: ModelOption[]
  source: ModelSource
  /** 界面/日志用得上：不是现探的就说清楚是哪来的 */
  note?: string
}

/** 落盘结构：按 cli id 存一份 */
export interface CatalogFile {
  [cliId: string]: { at: number; models: ModelOption[] }
}

export function isValidList(v: unknown): v is ModelOption[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((m) => !!m && typeof m === 'object' && typeof m.id === 'string' && m.id.length > 0 &&
      typeof m.label === 'string' &&
      (m.defaultEffort === undefined || typeof m.defaultEffort === 'string') &&
      (m.effortLevels === undefined || (Array.isArray(m.effortLevels) && m.effortLevels.every(
        (e: unknown) => !!e && typeof e === 'object' && 'id' in e && typeof e.id === 'string' &&
          'label' in e && typeof e.label === 'string'
      ))))
  )
}

/**
 * 三级取值。**探测结果为空数组也算失败** —— 空清单和「问不到」对用户是一回事
 * （下拉里什么都没有），退到降级比显示一个空下拉好。
 */
export function resolveModels(input: {
  probed?: ModelOption[] | null
  cached?: ModelOption[] | null
  fallback?: ModelOption[] | null
  cachedAt?: number
}): ResolvedModels {
  if (isValidList(input.probed)) return { models: input.probed, source: 'probe' }
  if (isValidList(input.cached)) {
    const when = input.cachedAt ? new Date(input.cachedAt).toISOString().slice(0, 10) : '之前'
    return { models: input.cached, source: 'cache', note: `没问到最新清单，用的是 ${when} 探测到的那份` }
  }
  if (isValidList(input.fallback))
    return { models: input.fallback, source: 'fallback', note: '内置清单（这个 CLI 没有提供列模型的接口），可能与你的账号不完全一致' }
  return { models: [], source: 'none' }
}

/** 探测成功后要不要写盘：内容变了才写，避免每开一个会话都碰磁盘 */
export function shouldPersist(prev: ModelOption[] | undefined, next: ModelOption[]): boolean {
  if (!prev) return true
  if (prev.length !== next.length) return true
  return prev.some((m, i) => m.id !== next[i].id || m.label !== next[i].label || m.defaultEffort !== next[i].defaultEffort || JSON.stringify(m.effortLevels) !== JSON.stringify(next[i].effortLevels))
}

/** 解析磁盘上那份，坏了当没有 —— 绝不因为缓存文件损坏影响开会话 */
export function parseCatalog(raw: unknown): CatalogFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: CatalogFile = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as { at?: unknown; models?: unknown }
    if (isValidList(e?.models)) out[k] = { at: typeof e.at === 'number' && Number.isFinite(e.at) && Math.abs(e.at) <= 8.64e15 ? e.at : 0, models: e.models }
  }
  return out
}
