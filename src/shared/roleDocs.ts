// 角色章程（docs/roles/<roleId>.md，进 git）与分支台账（.eas/board/<branch>.md，不进 git）的
// 纯文本逻辑：模板、渲染、解析、追加、路径、指针段。**零依赖、裸测。** fs 与 git 在 main/ 那两个模块。
export const CHARTER_DIR = 'docs/roles'
export const LEDGER_DIR = '.eas/board'

const ROLE_RE = /^[a-z][a-z0-9-]*$/

export function charterRel(roleId: string): string | null {
  return ROLE_RE.test(roleId) ? `${CHARTER_DIR}/${roleId}.md` : null
}

/** 分支名 → 台账文件名：`/` 变 `--`（一眼看得出层级），别的怪字符变 `-` */
export function ledgerRel(branch: string): string | null {
  if (!branch.trim() || branch.includes('..')) return null
  const name = branch.replace(/\//g, '--').replace(/[^A-Za-z0-9._-]/g, '-')
  return `${LEDGER_DIR}/${name}.md`
}

export interface CharterInput { roleId: string; roleName: string; contract: string; hardLines: string[] }

/** 首次在某项目用某角色时的初稿。边界段留空给用户填；其余从角色卡来。 */
export function renderCharter(i: CharterInput): string {
  const contract = i.contract.trim() || '（角色卡没有契约，请补）'
  const hard = i.hardLines.length ? i.hardLines.map((l) => `- ${l}`).join('\n') : '- 无'
  const judge = contract.split('\n').filter((l) => /完成判据|算做完|算完成/.test(l))
  return [
    `# ${i.roleName} · 本项目章程`,
    '',
    '> 这份文件写的是**软约束**：模型会读、会照做，但没有任何东西拦着它。',
    '> 硬约束只有绑定层那份（角色卡里的能力开关，由 CLI / 沙箱 / hook 执行），列在下面「硬约束」段。',
    `> 由 Eas-Term 首次使用「${i.roleName}」时生成，之后不再覆盖 —— 放心改。`,
    '',
    '## 边界',
    '- 可以改：',
    '- 不要碰：',
    '',
    '### 硬约束（绑定层执行，改角色卡才会变）',
    hard,
    '',
    '## 产出与落点',
    '（来自角色卡契约，按本项目改写）',
    '',
    contract,
    '',
    '## 完成判据',
    judge.length ? judge.map((l) => `- ${l.trim()}`).join('\n') : '- （从上面的契约里提炼，用户可改）',
    '',
    '## 交接格式（写进台账的字段）',
    '每完成一个可交付的小步，用 `board_note` 记一条，按需带这些字段：',
    '- 决定：做了什么选择、为什么',
    '- 未完成：还差什么、卡在哪',
    '- 给合并官：合并时要注意的（冲突预期、必须一起改的文件、要跑的回归）',
    '- 怎么验：命令或步骤',
    ''
  ].join('\n')
}

export interface LedgerHeader {
  branch: string; roleName: string; worktree: string | null
  startedAt: number; lastActiveAt: number; alive: boolean; files: string[]
}

// 本地时间，与 shared/board.ts 一致 —— 台账是给坐在这台机器前的人看的
const pad = (n: number): string => String(n).padStart(2, '0')
const hhmm = (t: number): string => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const stamp = (t: number): string => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm(t)}` }

const NOTES_HEAD = '## 记录'

/** 头部从事实算（会话表 + git），记录段原样接回。 */
export function renderLedger(h: LedgerHeader, notes: string, now: number): string {
  const head = [
    `# 台账 · ${h.branch}`,
    `<!-- 头部由 app 维护，勿手改；「${NOTES_HEAD.slice(3)}」段由角色通过 board_note 追加。${stamp(now)} 更新 -->`,
    `- 角色：${h.roleName}`,
    `- 分支：${h.branch}`,
    `- worktree：${h.worktree ?? '（无）'}`,
    `- 起于：${stamp(h.startedAt)} · 最后活动：${hhmm(h.lastActiveAt)}`,
    `- 状态：${h.alive ? '活跃' : '已停'}`,
    `- 触及：${h.files.length ? `${h.files.join(', ')}（${h.files.length} 文件）` : '（无）'}`,
    '',
    NOTES_HEAD,
    ''
  ].join('\n')
  return head + notes
}

/** 「## 记录」之后的原文（不含标题行）；没有记录段 → '' */
export function splitLedger(text: string): { notes: string } {
  if (text.startsWith(`${NOTES_HEAD}\n`)) return { notes: text.slice(NOTES_HEAD.length + 1) }
  const i = text.indexOf(`\n${NOTES_HEAD}\n`)
  if (i < 0) return { notes: '' }
  return { notes: text.slice(i + NOTES_HEAD.length + 2) }
}

/** 只追加，不改写：多行 note 从第二行起缩两格当续行，列表结构不散。
 *  文本里没有记录段时先补一个标题再追加，不丢原文。 */
export function appendLedgerNote(text: string, note: string, roleName: string, now: number): string {
  const lines = note.trim().split('\n').map((l) => l.trimEnd())
  const entry = `- ${hhmm(now)} [${roleName}] ${lines[0] ?? ''}` + lines.slice(1).map((l) => `\n  ${l}`).join('') + '\n'
  const has = text.includes(`\n${NOTES_HEAD}\n`) || text.startsWith(`${NOTES_HEAD}\n`)
  const base = has ? text : `${text.trimEnd()}\n\n${NOTES_HEAD}\n`
  return (base.endsWith('\n') ? base : base + '\n') + entry
}

/** 超出时保留最后 maxLines 行，顶上加一句「前面还有 N 行」；不超原样返回 */
export function clipTail(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  if (lines.length <= maxLines) return text
  const keep = lines.slice(-maxLines)
  return `…（前面还有 ${lines.length - maxLines} 行）\n${keep.join('\n')}\n`
}

/** 起会话时附进系统提示的指针段。**只有指针**：全文注入违反托管区纪律。 */
export function roleDocsPrompt(o: { charterRel: string; ledgerRel: string | null }): string {
  const lines = [
    '## 你的角色文档',
    `- 本项目对你这个角色的章程：\`${o.charterRel}\`，动手前先读（软约束；硬约束由绑定层执行）`
  ]
  if (o.ledgerRel)
    lines.push(`- 你这条分支的台账：\`${o.ledgerRel}\`。每完成一个可交付的小步用 board_note 记一条（决定 / 未完成 / 给合并官 / 怎么验）`)
  return lines.join('\n')
}

/** 不起 git 进程读当前分支：worktree 的 .git 是文件 `gitdir: <path>`，主工作区是目录。
 *  `read` 读不到返回 null（目录也返回 null）。detached / 读不到 → null。 */
export function branchFromGitFiles(cwd: string, read: (p: string) => string | null): string | null {
  const dotGit = `${cwd}/.git`
  const asFile = read(dotGit)
  let gitDir: string
  if (asFile !== null) {
    const m = asFile.match(/^gitdir:\s*(.+?)\s*$/m)
    const target = m?.[1]
    if (!target) return null
    gitDir = target.startsWith('/') || /^[A-Za-z]:/.test(target) ? target : `${cwd}/${target}`
  } else gitDir = dotGit
  const head = read(`${gitDir}/HEAD`)
  if (!head) return null
  const r = head.match(/^ref:\s*refs\/heads\/(.+?)\s*$/m)
  return r?.[1] ?? null
}
