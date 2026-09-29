// Agent 命令按钮的命令表与发送通道。
//
// 做这个的前提结论（完整论证见 docs/斜杠命令按钮化分析.html）：
// 两个 CLI 一共 132 条斜杠命令，真正配得上常驻按钮的只有个位数。
// 按钮的价值不在「省下打字」——CLI 自己就有斜杠补全，打 `/` 就出候选，
// 还带我们判不了的 isEnabled 过滤。价值在**「把只有 Eas-Term 知道的信息
// 变成一个恰好出现在那里的按钮」**。所以这里刻意只收窄到两档，不做命令面板。
//
// 命令名按 agent 分开写，不做「同一个名字两边通用」的假设——
// 「新开一轮」在 Claude 是 /clear、在 Codex 是 /new，按钮标签写中文语义，不写命令名。
import type { NodeAgent } from '../../store/canvas/types'
import { t } from '../../i18n.ts'

/** 命令表按 agent 分列，键就是 NodeAgent 的 kind —— 别在这里另造一个同义的联合类型 */
type Kind = NodeAgent['kind']

/** 一条可以做成按钮的命令。 */
export interface AgentCmd {
  id: string
  /** 按钮上/提示里给人看的中文语义 */
  label: string
  /** 悬浮提示的补充说明（一句话说清点下去会发生什么） */
  tip: string
  /** 各 agent 下真正写进终端的命令。**null = 这个 agent 没有对应命令**，按钮就不出现 */
  cmd: Record<Kind, string | null>
  /** 不可逆 / 花钱的操作：点了先弹确认。文案要说清「会失去什么」，不是泛泛问一句「确定吗」 */
  confirm?: { message: string; confirmLabel: string }
}

/** 加新 CLI 时，某一条不知道它的斜杠语法就填 `null`，**不要猜一条填上** ——
 *  猜错的代价是用户的会话被一条无效命令打乱。null 的按钮 UI 会自己隐藏，
 *  不需要为它写分支。 */
/** 一级：常驻在命令条上，一次点击直达。 */
export const PRIMARY_CMDS: AgentCmd[] = [
  {
    id: 'compact',
    get label() { return t('canvas.cmd.compact.label') },
    get tip() { return t('canvas.cmd.compact.tip') },
    cmd: { claude: '/compact', codex: '/compact' },
    // /compact 是有损且不可逆的（原始对话被摘要顶掉），所以照规矩弹确认。
    // 它同时是这一排里频次最高的按钮，文案就得写得能让人一眼判断、不用犹豫。
    confirm: {
      get message() { return t('canvas.cmd.compact.confirm') },
      get confirmLabel() { return t('canvas.cmd.compact.confirmLabel') }
    }
  },
  {
    id: 'context',
    get label() { return t('canvas.cmd.context.label') },
    get tip() { return t('canvas.cmd.context.tip') },
    // Codex 没有独立的 /context，用量信息在 /status 里
    cmd: { claude: '/context', codex: '/status' }
  },
  {
    id: 'plan',
    get label() { return t('canvas.cmd.plan.label') },
    get tip() { return t('canvas.cmd.plan.tip') },
    cmd: { claude: '/plan', codex: '/plan' }
  },
  {
    id: 'model',
    get label() { return t('canvas.cmd.model.label') },
    get tip() { return t('canvas.cmd.model.tip') },
    cmd: { claude: '/model', codex: '/model' }
  },
  {
    id: 'new',
    get label() { return t('canvas.cmd.new.label') },
    get tip() { return t('canvas.cmd.new.tip') },
    cmd: { claude: '/clear', codex: '/new' },
    confirm: {
      get message() { return t('canvas.cmd.new.confirm') },
      get confirmLabel() { return t('canvas.cmd.new.confirmLabel') }
    }
  },
  {
    id: 'copy',
    get label() { return t('canvas.cmd.copy.label') },
    get tip() { return t('canvas.cmd.copy.tip') },
    cmd: { claude: '/copy', codex: '/copy' }
  },
  {
    id: 'usage',
    get label() { return t('canvas.cmd.usage.label') },
    get tip() { return t('canvas.cmd.usage.tip') },
    cmd: { claude: '/usage', codex: '/usage' }
  },
  {
    id: 'init',
    get label() { return t('canvas.cmd.init.label') },
    get tip() { return t('canvas.cmd.init.tip') },
    cmd: { claude: '/init', codex: '/init' },
    // 会往项目里写文件（CLAUDE.md / AGENTS.md），已有内容可能被顶掉 —— 按规矩先问
    confirm: {
      get message() { return t('canvas.cmd.init.confirm') },
      get confirmLabel() { return t('canvas.cmd.init.confirmLabel') }
    }
  }
]

/** 二级：收进「更多」菜单。频次不够高、或点了之后还要在 TUI 里继续操作。 */
export const SECONDARY_CMDS: AgentCmd[] = [
  {
    id: 'review',
    get label() { return t('canvas.cmd.review.label') },
    get tip() { return t('canvas.cmd.review.tip') },
    cmd: { claude: '/review', codex: '/review' },
    confirm: {
      get message() { return t('canvas.cmd.review.confirm') },
      get confirmLabel() { return t('canvas.cmd.review.confirmLabel') }
    }
  },
  {
    id: 'security-review',
    get label() { return t('canvas.cmd.security-review.label') },
    get tip() { return t('canvas.cmd.security-review.tip') },
    cmd: { claude: '/security-review', codex: null },
    confirm: {
      get message() { return t('canvas.cmd.security-review.confirm') },
      get confirmLabel() { return t('canvas.cmd.security-review.confirmLabel') }
    }
  },
  { id: 'resume', get label() { return t('canvas.cmd.resume.label') }, get tip() { return t('canvas.cmd.resume.tip') }, cmd: { claude: '/resume', codex: '/resume' } },
  { id: 'effort', get label() { return t('canvas.cmd.effort.label') }, get tip() { return t('canvas.cmd.effort.tip') }, cmd: { claude: '/effort', codex: null } },
  { id: 'skills', get label() { return t('canvas.cmd.skills.label') }, get tip() { return t('canvas.cmd.skills.tip') }, cmd: { claude: '/reload-skills', codex: '/skills' } }
]

/** 文本和回车之间必须留的间隔。
 *
 *  **不是保守，是踩出来的**（同 TerminalInput.tsx 的 ENTER_DELAY_MS）：一次写完的话，
 *  Claude Code / Codex 这类 TUI 收到文本后要先渲染进自己的输入框，紧跟着的回车
 *  常被它当成「还在粘贴」吞掉 —— 表现是命令躺在 agent 的输入框里没执行。 */
const ENTER_DELAY_MS = 80

/** 把一条斜杠命令送进终端。**这就是「不经过输入框」的全部含义**：
 *  用户不用打字，但字符仍然要进 PTY —— TUI 只认这一条输入通道。
 *
 *  回显是**故意保留**的：用户看得见按钮到底发了什么，出问题能自查。
 *  藏起来的话，一旦命令没生效就完全没有线索。 */
export function sendSlash(ptyId: string, text: string): void {
  window.api.pty.write(ptyId, text)
  window.setTimeout(() => window.api.pty.write(ptyId, '\r'), ENTER_DELAY_MS)
}
