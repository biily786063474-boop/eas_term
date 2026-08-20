// AI 对话的聊天记录落盘：下次打开这个节点，直接看到上次聊到哪。
//
// **为什么不复用 CLI 自己的 transcript**：Claude Code 确实把完整记录写在
// ~/.claude/projects/<cwd>/<sessionId>.jsonl（session.ts 里有现成的解析器），
// 但那条路只覆盖 Claude —— Codex 的格式与落点都不同，而 agentChat 是 CLI 无关的。
// 这里存的是**归约之后的 ChatView.turns**，两个 CLI 走同一条路，
// 也不会被上游改内部格式弄坏。
//
// 按 **leafId**（画布节点 id）存，不是 sessionId：sessionId 每次 start 都会变
// （`ac-${nextId++}`），而 leafId 随 canvas.json 落盘、跨重启稳定，
// 正好对应用户心里的「这个对话框」。
//
// 裁剪在渲染层做（features/agentChat/history.ts），这里只负责存取与容量。

import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { safeHistoryKey } from './agentHistoryKey'

/** 最多留多少个节点的记录。超了删最旧的 —— 画布上的对话框会不断新建/关闭，
 *  不设上限的话这个目录只增不减。200 份 × 每份几十 KB，量级可控。 */
const MAX_FILES = 200

const dir = (): string => path.join(app.getPath('userData'), 'agent-history')

function fileOf(leafId: string): string | null {
  const key = safeHistoryKey(leafId)
  return key ? path.join(dir(), `${key}.json`) : null
}

function prune(): void {
  try {
    const d = dir()
    const files = fs
      .readdirSync(d)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const p = path.join(d, f)
        return { p, m: fs.statSync(p).mtimeMs }
      })
    if (files.length <= MAX_FILES) return
    files.sort((a, b) => a.m - b.m)
    for (const f of files.slice(0, files.length - MAX_FILES)) fs.unlinkSync(f.p)
  } catch {
    /* 清理失败不影响主流程 */
  }
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
  ipcMain.handle('team:roster', (_e, projectPath: unknown): string | null => {
    if (typeof projectPath !== 'string' || !projectPath) return null
    try {
      return fs.readFileSync(rosterFile(projectPath), 'utf8')
    } catch {
      return null // 没派过活 / 读不到 —— 解析那侧会退化成空花名册
    }
  })

  ipcMain.handle('team:rosterSave', (_e, projectPath: unknown, json: unknown): void => {
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
  ipcMain.handle(
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
  ipcMain.handle(
    'agentHistory:load',
    (_e, leafId: unknown): { turns: unknown[]; resumeId: string | null } => {
      const empty = { turns: [], resumeId: null }
      const f = typeof leafId === 'string' ? fileOf(leafId) : null
      if (!f) return empty
      try {
        const raw = JSON.parse(fs.readFileSync(f, 'utf8')) as { turns?: unknown; resumeId?: unknown }
        return {
          turns: Array.isArray(raw.turns) ? raw.turns : [],
          // 写这份记录时 CLI 那边的会话 id。**读回来必须跟当前 pane.resumeId 比一次** ——
          // 对不上就说明模型接不回这段上下文了，界面得说清楚，见 AgentChatView。
          resumeId: typeof raw.resumeId === 'string' ? raw.resumeId : null
        }
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
  ipcMain.handle(
    'agentHistory:list',
    (_e, cwd: unknown): { leafId: string; resumeId: string | null; savedAt: number; turns: number; preview: string }[] => {
      if (typeof cwd !== 'string' || !cwd) return []
      let names: string[]
      try {
        names = fs.readdirSync(dir()).filter((f) => f.endsWith('.json'))
      } catch {
        return []
      }
      const out: { leafId: string; resumeId: string | null; savedAt: number; turns: number; preview: string }[] = []
      for (const n of names) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8')) as {
            cwd?: unknown
            resumeId?: unknown
            savedAt?: unknown
            turns?: { role?: string; text?: string }[]
          }
          if (raw.cwd !== cwd || !Array.isArray(raw.turns) || !raw.turns.length) continue
          // 预览取第一条用户消息 —— 「上次聊的是什么」比「最后说到哪」更好认
          const first = raw.turns.find((t) => t?.role === 'user') ?? raw.turns[0]
          out.push({
            leafId: n.replace(/\.json$/, ''),
            resumeId: typeof raw.resumeId === 'string' ? raw.resumeId : null,
            savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
            turns: raw.turns.length,
            preview: (first?.text ?? '').slice(0, 60)
          })
        } catch {
          /* 坏文件跳过，不能让一份坏记录挡住整个列表 */
        }
      }
      return out.sort((a, b) => b.savedAt - a.savedAt)
    }
  )

  // 返回**真的写成了没有**。调用方里至少有一条路（adoptOrphan）要靠它决定
  // 敢不敢删掉旧的那一份 —— 先删后存、而存又失败了的话，那段对话就永久没了。
  ipcMain.handle('agentHistory:save', (_e, leafId: unknown, turns: unknown, resumeId: unknown, cwd: unknown): boolean => {
    const f = typeof leafId === 'string' ? fileOf(leafId) : null
    if (!f || !Array.isArray(turns)) return false
    try {
      fs.mkdirSync(dir(), { recursive: true })
      // 空记录就删文件，别留一堆 {"turns":[]}
      if (turns.length === 0) {
        fs.rmSync(f, { force: true })
        // **返回 false**：删掉不等于「保存好了」。调用方拿它当「可以删旧的了」
        // 会正好在这条路径上丢数据（.plans/silent-fail S-12 记的那颗雷）。
        return false
      }
      fs.writeFileSync(
        f,
        JSON.stringify({
          v: 1,
          savedAt: Date.now(),
          resumeId: typeof resumeId === 'string' && resumeId ? resumeId : null,
          // 项目路径：`agentHistory:list` 靠它把记录归到项目下。
          // 没有它就只能把所有项目的历史混在一起给用户挑，那不可用
          cwd: typeof cwd === 'string' ? cwd : null,
          turns
        }),
        { mode: 0o600 }
      )
      prune()
      return true
    } catch (e) {
      console.error('[agentHistory] 写入失败', e)
      return false
    }
  })

  /** 节点被永久关闭时清掉它的记录。**跟着节点走** ——
   *  节点都没了还留着聊天记录，既占地方又没有任何入口能看到。 */
  ipcMain.handle('agentHistory:forget', (_e, leafId: unknown): void => {
    const f = typeof leafId === 'string' ? fileOf(leafId) : null
    if (f) fs.rmSync(f, { force: true })
  })
}
