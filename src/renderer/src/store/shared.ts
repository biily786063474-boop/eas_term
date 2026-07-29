// store 各切片共用的类型与纯工具函数（不含状态）

import type { LayoutNode, PaneState } from '../layout'
import { collectLeaves } from '../layout'

export interface TermTab {
  id: string
  title: string
  /** 用户手动重命名后为 true，shell 的自动标题（OSC）不再覆盖 */
  customTitle?: boolean
  projectId: string | null
  cwd: string
  root: LayoutNode
  activeLeafId: string
}

export interface PendingConfirm {
  message: string
  confirmLabel: string
  onConfirm: () => void
  /** 「取消」那一侧不总是「什么都不做」——比如换角色时它的含义是「只改下次启动」。
   *  这种时候写死的「取消」会误导人，所以允许改名并挂回调。 */
  cancelLabel?: string
  onCancel?: () => void
}

let seq = 1
export const uid = (prefix: string): string =>
  `${prefix}-${seq++}-${Math.random().toString(36).slice(2, 7)}`

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])

// 网页类文件（HTML）统一走画板内嵌浏览器，不再当代码预览
export function isWebFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'html' || ext === 'htm'
}
// 本地路径 → file:// URL（路径含空格/中文时必须转义，否则 webview 加载失败）
export function fileUrlOf(filePath: string): string {
  return 'file://' + encodeURI(filePath)
}

export function paneKindForFile(filePath: string): 'code' | 'image' {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTS.has(ext) ? 'image' : 'code'
}

export function killPanePty(pane: PaneState): void {
  if (pane.kind === 'terminal') window.api.pty.kill(pane.ptyId)
}

export function terminalPtyIds(root: LayoutNode): string[] {
  return collectLeaves(root).flatMap((l) => (l.pane.kind === 'terminal' ? [l.pane.ptyId] : []))
}

// 终端面板按项目隔离：activeTabByProject 记住每个项目上次激活的标签。
// projectId 可能为 null（无项目时打开的终端），统一映射成字符串 key。
const NO_PROJECT = '__none__'
export const projectKey = (projectId: string | null): string => projectId ?? NO_PROJECT

/** 在指定项目范围内挑选应激活的标签：优先用记忆值，否则取该项目第一个标签 */
export function pickActiveTab(
  tabs: TermTab[],
  activeTabByProject: Record<string, string | null>,
  projectId: string | null
): string | null {
  const remembered = activeTabByProject[projectKey(projectId)]
  const projectTabs = tabs.filter((t) => t.projectId === projectId)
  if (remembered && projectTabs.some((t) => t.id === remembered)) return remembered
  return projectTabs[0]?.id ?? null
}

export interface CloseResult {
  tabs: TermTab[]
  activeTabId: string | null
  activeTabByProject: Record<string, string | null>
}

// 关闭一个标签：在同项目内选相邻标签接替，绝不跨项目跳转
export function closeTabInState(
  tabs: TermTab[],
  activeTabId: string | null,
  activeTabByProject: Record<string, string | null>,
  tabId: string
): CloseResult {
  const closing = tabs.find((t) => t.id === tabId)
  const next = tabs.filter((t) => t.id !== tabId)
  if (!closing) return { tabs: next, activeTabId, activeTabByProject }

  const pk = projectKey(closing.projectId)
  const sameBefore = tabs.filter((t) => t.projectId === closing.projectId)
  const closingIdx = sameBefore.findIndex((t) => t.id === tabId)
  const sameAfter = next.filter((t) => t.projectId === closing.projectId)
  const fallback = sameAfter[Math.min(closingIdx, sameAfter.length - 1)]?.id ?? null

  const nextMap = { ...activeTabByProject }
  if (nextMap[pk] === tabId) {
    if (fallback) nextMap[pk] = fallback
    else delete nextMap[pk]
  }
  return {
    tabs: next,
    activeTabId: activeTabId === tabId ? fallback : activeTabId,
    activeTabByProject: nextMap
  }
}
