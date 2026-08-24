// store 各切片共用的类型与纯工具函数（不含状态）

import type { LayoutNode, PaneState } from '../layout'
import { shouldStopSessionOnClose } from './closePolicy'
import { collectLeaves } from '../layout'
import { forgetPty } from '../features/gantt/collector'

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
  if (pane.kind === 'terminal') {
    window.api.pty.kill(pane.ptyId)
    // kill 意图一发出就同步清甘特图采集态（keyBuf/pending/active）。
    //
    // 不能只靠 TerminalView 的 pty:onExit 兜底：真实 OS 退出是异步事件（killTree 发信号
    // → 进程死 → node-pty 的 proc.onExit → 跨进程 send 回渲染进程），而这条「用户主动关」
    // 的路径会在同一个同步调用里紧接着把 leaf 从布局树摘掉，TerminalView 随之卸载、
    // 清理时把 pty:exit 的监听也摘了——真正的退出事件到达时已经没人接，onExit 里的
    // forgetPty 根本不会被调用。这里跟 kill 信号一起同步清，不依赖那趟异步事件。
    //
    // 这里只清 Map，不调用 noteRunning(false)：和主进程 pty.ts 里 forgetPty 的三处
    // 调用（proc.onExit / 收到 pty:kill / killPtysForWebContents）同一个范式——
    // 单纯的资源清理，不掺 gantt.finish 的业务判断。若这条 pty 当时有条 active 的
    // 任务记录，它的 endAt 就此不会再写入，交给 Task 1 list() 的 aborted 兜底处理，
    // 不是这里要解决的问题。
    forgetPty(pane.ptyId)
  } else if (pane.kind === 'agent' && pane.sessionId) {
    // 甘特采集器的内存态跟着清 —— 和上面 terminal 分支同一个理由和同一个范式：
    // 单纯资源清理，不掺 gantt.finish 的业务判断（没写完的 endAt 交给 list() 的
    // aborted 兜底）。**放在下面那个团队会话的早退之前**：团队会话虽然不进甘特图，
    // 但 handleSend 会给它挂过候选文本，不清就一直留在 Map 里。
    forgetPty(pane.sessionId)
    // 对称处理（2026-08-15 审查 Important）：节点被永久关闭时必须把底层 CLI 进程
    // 一起停掉，理由与上面 terminal 分支同源——同步做，不能指望组件卸载时的异步
    // 清理兜底。AgentChatView.tsx 卸载时只取消事件订阅，不调 agentChat.stop()
    // （卸载 ≠ 用户关闭节点：切走面板不该杀掉正在跑的会话，只有节点被真正移除
    // 才该杀）；真正「关闭节点时把进程杀掉」这件事完全靠这里、靠 PaneState.sessionId
    // 驱动。不这样做的后果：底层 CLI 进程会在主进程那边无人看管地继续跑到 15 分钟
    // 空闲回收阈值，期间可能仍在执行工具调用，真实消耗 API token，且与 spec §A.5
    // 「节点关闭：杀进程」直接矛盾。
    // sessionId 为空（会话还没建立成功，或者这个节点从没起过会话）时天然没有
    // 东西可停，不是遗漏。
    //
    // **例外：团队派生的会话不在这里杀。** 对那些会话，关掉节点的意思是
    // 「这块屏幕我不看了」，不是「我不要它了」—— 它还在替你干活，由团队面板
    // 负责停。上面那段论证（不杀就无人看管地烧 token）对它不成立，因为面板
    // 里每一行都能停，而且卡住/崩溃都有检测。
    //
    // 这个例外必须和团队面板的「停」按钮同时存在：只标记不给出口，
    // 就是制造一个没有任何 UI 能管的后台进程（15 分钟空闲回收对活跃会话无效，
    // 见 main/agentChat/session.ts 里 killAgentChatSessionsForWebContents 上方那段）。
    if (!shouldStopSessionOnClose(pane)) return
    window.api.agentChat.stop(pane.sessionId)
  }
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
