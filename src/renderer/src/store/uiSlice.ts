// UI 切片：主题、危险操作确认弹窗、跨面板的「最近活动终端」标记

import type { StateCreator } from 'zustand'
import { ThemeId, loadTheme, applyTheme } from '../themes'
import type { AgentRole } from '../../../shared/types'
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
  /** Agent 角色表（~/.eas/roles.json）。启动 app 时拉一次，改完重拉。 */
  roles: AgentRole[]
  loadRoles: () => Promise<void>
  /** 整表写回（编辑器改完调它）。主进程会再 sanitize 一遍，全是坏数据时拒绝写入 */
  saveRoles: (roles: AgentRole[]) => Promise<string | null>
  /** 恢复内置角色（用户自建的保留） */
  resetRoles: () => Promise<void>
}

let mcpSeq = 1

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  theme: loadTheme(),
  pendingConfirm: null,
  lastActiveTerminal: null,
  attentionPtys: [],
  mcpLog: [],
  mcpEnabled: true,
  runningPtys: [],
  agentCli: null,
  roles: [],

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

  setMcpEnabled: (v) => set({ mcpEnabled: v }),
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
