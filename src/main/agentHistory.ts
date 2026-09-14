// AI 对话的聊天记录落盘：下次打开这个节点，直接看到上次聊到哪。
//
// **为什么不复用 CLI 自己的 transcript**：Claude Code 确实把完整记录写在
// ~/.claude/projects/<cwd>/<sessionId>.jsonl（session.ts 里有现成的解析器），
// 但那条路只覆盖 Claude —— Codex 的格式与落点都不同，而 agentChat 是 CLI 无关的。
// 这里存的是**归约之后的 ChatView.turns**，两个 CLI 走同一条路，
// 也不会被上游改内部格式弄坏。
//
// 按 **画布节点 id**（`cnode-…`）存，不是 sessionId 也不是 leafId：
// · sessionId 每次 start 都会变（`ac-${nextId++}`）
// · **leafId 也会变** —— `uid()` 带随机段，而 persist 落盘时 `delete copy.leafId`。
//   这里原本写着「leafId 随 canvas.json 落盘、跨重启稳定」，那句是错的，
//   后果是重启后每个节点都读不到自己的历史（2026-08-20 实测）。
// 画布节点 id 随 canvas.json 一起落盘，重启后原样回来，
// 正好对应用户心里的「这个对话框」。
//
// 裁剪在渲染层做（features/agentChat/history.ts），这里只负责存取与容量。

import { guardedHandle } from './ipcGuard'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { safeHistoryKey } from './agentHistoryKey'
import { writeHistorySnapshot } from './agentHistoryStorage'
import { saveArchive, loadArchiveWindow } from './agentHistoryArchive'
import { createHistoryListCache } from './historyListCache'
import { type HistorySummary } from '../shared/historyCatalog'

// 历史由用户管理；不可按数量静默淘汰。
const dir = (): string => path.join(app.getPath('userData'), 'agent-history')

function fileOf(leafId: string): string | null {
  const key = safeHistoryKey(leafId)
  return key ? path.join(dir(), `${key}.json`) : null
}

/** 一批 agent 的产出状态：每个 role 的 `.plans/<role>/findings.md` 在不在、多大。
 *
 *  放在这个文件里是因为它跟聊天记录一样，是「主进程代渲染层看一眼磁盘」——
 *  渲染层没有 fs，而 `fs:readTextFile` 会把整份文件读出来，这里只要 size。
 *
 *  **不做路径拼接以外的任何解释**：role 是 kebab-case（batchSpec 校验过），
 *  projectPath 来自 Frame 的项目配置，两者都不是用户现填的。 */
/** 团队花名册的落点。**在项目目录里，跟 .plans/<role>/ 的产出放一起** ——
 *  它属于这个项目的工作记录，跟着项目走（换机器、开另一个副本都还在），
 *  不该藏进 userData。 */
const rosterFile = (projectPath: string): string =>
  path.join(projectPath, '.plans', 'team.json')

export function registerTeamRoster(): void {
  guardedHandle('team:roster', (_e, projectPath: unknown): string | null => {
    if (typeof projectPath !== 'string' || !projectPath) return null
    try {
      return fs.readFileSync(rosterFile(projectPath), 'utf8')
    } catch {
      return null // 没派过活 / 读不到 —— 解析那侧会退化成空花名册
    }
  })

  guardedHandle('team:rosterSave', (_e, projectPath: unknown, json: unknown): void => {
    if (typeof projectPath !== 'string' || !projectPath || typeof json !== 'string') return
    try {
      const f = rosterFile(projectPath)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, json)
    } catch (e) {
      // 记不下来不该让派活失败 —— 这是记录不是前提
      console.error('[team] 花名册写入失败', e)
    }
  })
}

export function registerTeamFindings(): void {
  guardedHandle(
    'team:findings',
    (_e, projectPath: unknown, roles: unknown): Record<string, number | null> => {
      const out: Record<string, number | null> = {}
      if (typeof projectPath !== 'string' || !Array.isArray(roles)) return out
      for (const r of roles) {
        if (typeof r !== 'string' || !/^[a-z0-9-]+$/.test(r)) continue
        try {
          out[r] = fs.statSync(path.join(projectPath, '.plans', r, 'findings.md')).size
        } catch {
          out[r] = null // 文件不存在 —— 跟 0 字节是两回事，见 teamFindings.ts
        }
      }
      return out
    }
  )
}

export function registerAgentHistory(): void {
  guardedHandle(
    'agentHistory:load',
    (_e, leafId: unknown): { turns: unknown[]; resumeId: string | null; resumeCli: string | null; total?: number } => {
      const empty = { turns: [], resumeId: null, resumeCli: null }
      const f = typeof leafId === 'string' ? fileOf(leafId) : null
      if (!f) return empty
      try {
        // 2026-09-14 完整归档：磁盘全量、界面只回最近一窗（HISTORY_WINDOW）；旧档补序号。
        // resumeId：写这份记录时 CLI 那边的会话 id。**读回来必须跟当前 pane.resumeId 比一次** ——
        // 对不上就说明模型接不回这段上下文了，界面得说清楚，见 AgentChatView。
        const win = loadArchiveWindow(f)
        return { turns: win.turns, resumeId: win.resumeId, resumeCli: win.resumeCli, total: win.total }
      } catch {
        // 文件不存在 / 坏了 —— 一律当成「没有历史」。
        // **绝不能因为这个抛错**：那会让对话框整个起不来，而它只是个锦上添花的功能。
        return empty
      }
    }
  )

  /**
   * 这个项目下**已经没有对应节点**的历史记录，最近的排前面。
   *
   * 关节点不再删记录（用户 2026-08-19 要求：误关了要能捞回来），于是需要一条
   * 「上次那个对话去哪了」的路：新开的对话框是新的 leafId，跟旧记录对不上，
   * 没有这个列表就等于记录留着也找不回来 —— 那跟删了没区别。
   *
   * **只报元信息，不带 turns** —— 空态只需要显示「什么时候的、聊了几轮、开头是什么」，
   * 把几十份记录的正文全读进渲染层是纯浪费。
   */
  // 2026-09-14：完整归档后文件会变大，列表/搜索走 mtime 缓存（historyListCache.ts），没变的文件不重读。
  const listCache = createHistoryListCache()
  guardedHandle('agentHistory:list', (_e, cwd: unknown, query: unknown): HistorySummary[] => {
    if (typeof cwd !== 'string' || !cwd) return []
    return listCache.list(dir(), cwd, typeof query === 'string' ? query.slice(0, 500) : '')
  })

  // 返回**真的写成了没有**。调用方里至少有一条路（adoptOrphan）要靠它决定
  // 敢不敢删掉旧的那一份 —— 先删后存、而存又失败了的话，那段对话就永久没了。
  guardedHandle('agentHistory:save', (_e, leafId: unknown, turns: unknown, resumeId: unknown, cwd: unknown, resumeCli: unknown, moduleId: unknown): boolean => {
    const f = typeof leafId === 'string' ? fileOf(leafId) : null
    if (!f || !Array.isArray(turns)) return false
    try {
      // 2026-09-14 完整归档：渲染层送来的是窗口，主进程按 seq 并回全量（agentHistoryArchive.ts）。
      // 签发者和 id 一起存：历史文件是老对话「接上上次」的入口，缺了签发者又得回去猜。
      // 项目路径：`agentHistory:list` 靠它把记录归到项目下。
      return saveArchive(f, {
        moduleId: typeof moduleId === 'string' && safeHistoryKey(moduleId) ? moduleId : null,
        resumeId: typeof resumeId === 'string' && resumeId ? resumeId : null,
        resumeCli: typeof resumeCli === 'string' && resumeCli ? resumeCli : null,
        cwd: typeof cwd === 'string' ? cwd : null
      }, turns as { seq?: number }[])
    } catch (e) {
      console.error('[agentHistory] 写入失败', e)
      return false
    }
  })

  // App-private metadata: validated key, no caller-provided filesystem paths.
  guardedHandle('agentHistory:pin', (_e, key: unknown, cwd: unknown, pinned: unknown): boolean => {
    const f = typeof key === 'string' ? fileOf(key) : null
    if (!f || typeof cwd !== 'string' || typeof pinned !== 'boolean') return false
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (raw.cwd !== cwd || !Array.isArray(raw.turns)) return false
      return writeHistorySnapshot(f, { ...raw, pinned })
    } catch { return false }
  })

  /** 节点被永久关闭时清掉它的记录。**跟着节点走** ——
   *  节点都没了还留着聊天记录，既占地方又没有任何入口能看到。 */
  guardedHandle('agentHistory:forget', (_e, leafId: unknown): void => {
    const f = typeof leafId === 'string' ? fileOf(leafId) : null
    if (f) fs.rmSync(f, { force: true })
  })
}
