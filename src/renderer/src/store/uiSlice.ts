// UI 切片：主题、危险操作确认弹窗、跨面板的「最近活动终端」标记

import type { StateCreator } from 'zustand'
import { ThemeId, loadTheme, applyTheme } from '../themes'
import type { AgentRole, ArchiveItem } from '../../../shared/types'
import type { PendingConfirm } from './shared'
import type { AppState } from './types'

export interface UiSlice {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  /** 危险操作确认弹窗（终端运行中关闭/退出时触发） */
  pendingConfirm: PendingConfirm | null
  requestConfirm: (c: PendingConfirm) => void
  cancelConfirm: () => void
  /** 最近聚焦过的终端（供名词词典等非终端面板把文本插入光标处；打开词典后 activeLeaf 是词典自己，故单独记）。
   *  由 TerminalView 的 focusin 处理器直接 setState 写入。 */
  lastActiveTerminal: { tabId: string; ptyId: string } | null
  /** 需要用户处理的终端 ptyId（终端响铃触发、聚焦后清除）——供抽屉项目呼吸提示 */
  attentionPtys: string[]
  flagAttention: (ptyId: string) => void
  clearAttention: (ptyId: string) => void
  /** 正在自动跑 agent 任务的终端 ptyId。判据同「任务完成」提醒：Claude Code 干活时
   *  把终端标题设成「<盲文 spinner> 名字」，停下等人时是非 spinner。纯 shell 永不误报。 */
  runningPtys: string[]
  setPtyRunning: (ptyId: string, running: boolean) => void
  /** MCP 调用流水（AI 通过 MCP 操作画板时留痕）：标题栏指示灯据此亮起 + 展开查看做了什么。
   *  只留最近 20 条，不持久化——它是「刚才 AI 动了什么」的即时可见性，不是审计日志。 */
  mcpLog: { id: number; tool: string; detail: string; ok: boolean; at: number }[]
  /** MCP 总开关：关掉后所有工具调用一律拒绝（不用改 Claude 配置就能立刻断开） */
  mcpEnabled: boolean
  setMcpEnabled: (v: boolean) => void
  logMcp: (e: { tool: string; detail: string; ok: boolean }) => void
  clearMcpLog: () => void
  /** Claude Code / Codex 这两个 CLI 装没装。null = 还没探测出结果。
   *  一个都没有时 agent 相关控件整体隐藏——摆一堆点了没反应的按钮比没有更糟。 */
  agentCli: { claude: boolean; codex: boolean } | null
  refreshAgentCli: () => Promise<void>
  /** 左侧知识库抽屉开着没有。提到 store 是因为画布上别的浮层（左下角缩略图）
   *  要跟着让位——那些组件和抽屉没有父子关系，靠 class 传状态最省事。 */
  wikiDrawerOpen: boolean
  setWikiDrawerOpen: (v: boolean) => void
  /** 右侧资源抽屉开着没有。同上：右下角的基本操作条和缩放条贴着右边，
   *  抽屉展开会正好压在它们身上，得跟着往左让。 */
  resDrawerOpen: boolean
  setResDrawerOpen: (v: boolean) => void
  /** 词典悬浮球被右键藏起来了。存 localStorage：藏它是个明确的意愿表达，
   *  重启就冒出来等于没听见。藏起来后标题栏会出现一个恢复按钮。 */
  dictBubbleHidden: boolean
  setDictBubbleHidden: (v: boolean) => void
  /** Agent 角色表（~/.eas/roles.json）。启动 app 时拉一次，改完重拉。 */
  roles: AgentRole[]
  loadRoles: () => Promise<void>
  /** 待用户过目的归档计划。agent 提交后挂在这里，界面渲染成审批面板 */
  pendingArchive: { items: ArchiveItem[]; resolve: (approved: ArchiveItem[] | null) => void } | null
  /** MCP 侧调用：提交计划并**等**用户点头。返回 null = 用户取消 */
  requestArchivePlan: (items: ArchiveItem[]) => Promise<ArchiveItem[] | null>
  resolveArchivePlan: (approved: ArchiveItem[] | null) => void
  /** 转录队列。串行跑——CPU 密集，并行只会互相拖慢 */
  ttQueue: { name: string; path: string; state: 'wait' | 'run' | 'done' | 'fail'; done: number; total: number; error?: string }[]
  enqueueTranscribe: (files: { name: string; path: string }[]) => void
  /** 整表写回（编辑器改完调它）。主进程会再 sanitize 一遍，全是坏数据时拒绝写入 */
  saveRoles: (roles: AgentRole[]) => Promise<string | null>
  /** 恢复内置角色（用户自建的保留） */
  resetRoles: () => Promise<void>
}

const DICT_HIDDEN_KEY = 'eas.dictbubble.hidden'
/** MCP 接入开关。存「关」而不是存「开」：默认值是开，只有被明确关掉才需要记住 */
const MCP_OFF_KEY = 'eas.mcp.off'

let mcpSeq = 1
let ttRunning = false

/**
 * 串行消费转录队列。
 *
 * 这一步是「预处理」：本机跑、不花 token、**不往 wiki 正文写东西**
 * （逐字稿落在收件箱的隐藏目录里）。按定的时机纪律，这类动作可以自动跑；
 * 真正花钱和动文件的归档必须等人点头。
 */
async function runTranscribeQueue(
  set: (fn: (s: UiSlice) => Partial<UiSlice>) => void,
  get: () => UiSlice
): Promise<void> {
  if (ttRunning) return
  ttRunning = true
  try {
    const { transcribeFile } = await import('../features/wiki/transcribe')
    for (;;) {
      const next = get().ttQueue.find((x) => x.state === 'wait')
      if (!next) break
      const upd = (patch: Partial<(typeof next)>): void =>
        set((s) => ({
          ttQueue: s.ttQueue.map((x) => (x.path === next.path ? { ...x, ...patch } : x))
        }))
      upd({ state: 'run' })
      const r = await transcribeFile(next.path, (p) => upd({ done: p.done, total: p.total }))
      if (r.ok) {
        await window.api.wiki.saveTranscript(next.name, r.text)
        upd({ state: 'done' })
      } else {
        upd({ state: 'fail', error: r.error })
      }
    }
  } finally {
    ttRunning = false
  }
}

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  theme: loadTheme(),
  pendingConfirm: null,
  lastActiveTerminal: null,
  attentionPtys: [],
  mcpLog: [],
  mcpEnabled: localStorage.getItem(MCP_OFF_KEY) !== '1',
  runningPtys: [],
  agentCli: null,
  roles: [],
  wikiDrawerOpen: false,
  setWikiDrawerOpen: (v) => set({ wikiDrawerOpen: v }),
  resDrawerOpen: false,
  setResDrawerOpen: (v) => set({ resDrawerOpen: v }),
  dictBubbleHidden: localStorage.getItem(DICT_HIDDEN_KEY) === '1',
  setDictBubbleHidden: (v) => {
    if (v) localStorage.setItem(DICT_HIDDEN_KEY, '1')
    else localStorage.removeItem(DICT_HIDDEN_KEY)
    set({ dictBubbleHidden: v })
  },
  pendingArchive: null,
  ttQueue: [],

  enqueueTranscribe: (files) => {
    const have = new Set(get().ttQueue.map((x) => x.path))
    const add = files.filter((f) => !have.has(f.path))
    if (!add.length) return
    set((s) => ({
      ttQueue: [...s.ttQueue, ...add.map((f) => ({ ...f, state: 'wait' as const, done: 0, total: 0 }))]
    }))
    void runTranscribeQueue(set, get)
  },

  requestArchivePlan: (items) =>
    new Promise((resolve) => {
      // 同一时刻只允许一份待审计划：第二份进来时先把上一份当作取消，
      // 免得两个面板叠在一起、用户点了哪个都说不清
      const prev = get().pendingArchive
      prev?.resolve(null)
      set({ pendingArchive: { items, resolve } })
    }),

  resolveArchivePlan: (approved) =>
    set((s) => {
      s.pendingArchive?.resolve(approved)
      return { pendingArchive: null }
    }),

  loadRoles: async () => {
    try {
      set({ roles: await window.api.roles.list() })
    } catch {
      set({ roles: [] }) // 读不到就当没有角色，界面回落成「无角色」的裸终端
    }
  },

  saveRoles: async (roles) => {
    const r = await window.api.roles.save(roles)
    if (r.ok && r.roles) {
      set({ roles: r.roles })
      return null
    }
    return r.error ?? '保存失败'
  },

  resetRoles: async () => {
    const r = await window.api.roles.reset()
    if (r.ok && r.roles) set({ roles: r.roles })
  },

  refreshAgentCli: async () => {
    try {
      const s = await window.api.skill.status()
      set({ agentCli: { claude: s.claude.hasCli, codex: s.codex.hasCli } })
    } catch {
      // 探测失败按「有」处理：宁可多显示控件，也别把已经装了 CLI 的用户的功能藏起来
      set({ agentCli: { claude: true, codex: true } })
    }
  },

  setPtyRunning: (ptyId, running) =>
    set((s) => {
      const has = s.runningPtys.includes(ptyId)
      if (has === running) return s
      return {
        runningPtys: running
          ? [...s.runningPtys, ptyId]
          : s.runningPtys.filter((p) => p !== ptyId)
      }
    }),

  setMcpEnabled: (v) => {
    // 存盘：这是个**安全开关**，关掉它是明确的意愿表达，不该重启就悄悄恢复成开。
    // 同步给主进程：/secret-env 走主进程直通，渲染层这份状态它查不到。
    if (v) localStorage.removeItem(MCP_OFF_KEY)
    else localStorage.setItem(MCP_OFF_KEY, '1')
    window.api.mcp.setEnabled(v)
    set({ mcpEnabled: v })
  },
  logMcp: (e) =>
    set((s) => ({
      mcpLog: [{ id: mcpSeq++, ...e, at: Date.now() }, ...s.mcpLog].slice(0, 20)
    })),
  clearMcpLog: () => set({ mcpLog: [] }),

  flagAttention: (ptyId) =>
    set((s) => (s.attentionPtys.includes(ptyId) ? s : { attentionPtys: [...s.attentionPtys, ptyId] })),
  clearAttention: (ptyId) =>
    set((s) =>
      s.attentionPtys.includes(ptyId)
        ? { attentionPtys: s.attentionPtys.filter((p) => p !== ptyId) }
        : s
    ),

  requestConfirm: (c) => set({ pendingConfirm: c }),
  cancelConfirm: () => set({ pendingConfirm: null }),

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  }
})
