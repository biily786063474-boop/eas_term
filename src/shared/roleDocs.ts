// 角色章程（docs/roles/<roleId>.md，进 git）与分支台账（.eas/board/<branch>.md，不进 git）的
// 纯文本逻辑：模板、渲染、解析、追加、路径、指针段。**零依赖、裸测。** fs 与 git 在 main/ 那两个模块。
// 本地时间，直接用 shared/board.ts 那份（台账和板一样是给坐在这台机器前的人看的；
// 两份各写一遍迟早对不上）。带 `.ts` 后缀：两边都在 shared/，裸 `node --test` 也解析得了。
import { hhmm, stamp } from './board.ts'

export const CHARTER_DIR = 'docs/roles'
export const LEDGER_DIR = '.eas/board'

const ROLE_RE = /^[a-z][a-z0-9-]*$/

export function charterRel(roleId: string): string | null {
  return ROLE_RE.test(roleId) ? `${CHARTER_DIR}/${roleId}.md` : null
}

/** 分支名 → 台账文件名：`/` 变 `--`（一眼看得出层级），别的怪字符变 `-`。
 *  字母数字按 Unicode 认（`\p{L}\p{N}`）—— 中文分支名 `eas/工匠/x` 与 `eas/侦察/x`
 *  不能塌成同一个文件。 */
export function ledgerRel(branch: string): string | null {
  if (!branch.trim() || branch.includes('..')) return null
  const name = branch.replace(/\//g, '--').replace(/[^\p{L}\p{N}._-]/gu, '-')
  return `${LEDGER_DIR}/${name}.md`
}

const JUDGE_RE = /完成判据|算做完|算完成/
/** 行尾是这些连接符 → 这句话没说完，下一行是它的续 */
const CONT_RE = /(——|；|，|、)\s*$/

/** 从契约里把「完成判据」那几句捞出来当初稿。
 *  一条 = 匹配行，外加：前一行以连接符结尾时把前一行并进来（匹配行是它的续）；
 *  匹配行（或并入后的尾行）以连接符结尾时把后面的行并进来，直到某行不再以连接符收尾。
 *  输出前剥掉行首列表符与「完成判据：」前缀 —— 我们自己会加 `- `，叠两层就成了 `- - `。 */
function extractJudge(contract: string): string[] {
  const lines = contract.split('\n').map((l) => l.trim())
  const used = new Set<number>()
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i) || !JUDGE_RE.test(lines[i] ?? '')) continue
    let lo = i
    let hi = i
    if (i > 0 && !used.has(i - 1) && CONT_RE.test(lines[i - 1] ?? '')) lo = i - 1
    while (hi + 1 < lines.length && CONT_RE.test(lines[hi] ?? '')) hi++
    const parts: string[] = []
    for (let k = lo; k <= hi; k++) {
      used.add(k)
      const l = (lines[k] ?? '').replace(/^[-*]\s*/, '')
      if (l) parts.push(l)
    }
    const text = parts.join('').replace(/^完成判据[:：]\s*/, '').trim()
    if (text) out.push(text)
  }
  return out
}

export interface CharterInput {
  roleId: string; roleName: string; contract: string; hardLines: string[]
  /** 硬约束列表上方的一行说明（比如「按首次起会话的 Codex 算；换别家 CLI 时落法可能不同」）。没有就不出这一行。 */
  hardNote?: string
}

/** 首次在某项目用某角色时的初稿。边界段留空给用户填；其余从角色卡来。 */
export function renderCharter(i: CharterInput): string {
  const contract = i.contract.trim() || '（角色卡没有契约，请补）'
  const hard = i.hardLines.length
    ? i.hardLines.map((l) => `- ${l}`).join('\n')
    : '- 无（角色卡没点亮任何能力开关；要加硬限制去角色卡改，写在这里不算数）'
  const judge = extractJudge(contract)
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
    ...(i.hardNote ? [i.hardNote] : []),
    hard,
    '',
    '## 产出与落点',
    '（来自角色卡契约，按本项目改写）',
    '',
    contract,
    '',
    '## 完成判据',
    judge.length ? judge.map((l) => `- ${l}`).join('\n') : '- （从上面的契约里提炼，用户可改）',
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

const NOTES_HEAD = '## 记录'
/** 记录段标题：独占一行（文件开头也算），容忍尾空白与 CRLF。匹配到的是「标题行 + 换行」，
 *  之后的全部原文就是记录段。**只认第一处** —— 后面 note 里再出现「## 记录」是内容，不是标题。 */
const NOTES_HEAD_RE = /(?:^|\r?\n)## 记录[ \t]*\r?\n/

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

/** 「## 记录」之后的原文（不含标题行）。`found=false` 表示整份文本里没有记录段标题
 *  —— 调用方拿到 false 且文本非空时，要把整份旧文本当 notes 接回去，不能当空处理（会丢字）。 */
export function splitLedger(text: string): { notes: string; found: boolean } {
  const m = NOTES_HEAD_RE.exec(text)
  if (!m) return { notes: '', found: false }
  return { notes: text.slice(m.index + m[0].length), found: true }
}

/** 只追加，不改写：多行 note 从第二行起缩两格当续行，列表结构不散。
 *  文本里没有记录段时先补一个标题再追加，不丢原文。 */
export function appendLedgerNote(text: string, note: string, roleName: string, now: number): string {
  const lines = note.trim().split('\n').map((l) => l.trimEnd())
  const entry = `- ${hhmm(now)} [${roleName}] ${lines[0] ?? ''}` + lines.slice(1).map((l) => `\n  ${l}`).join('') + '\n'
  const has = NOTES_HEAD_RE.test(text)
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

/** 起会话时附进系统提示的指针段。**只有指针**：全文注入违反托管区纪律。
 *  路径给**绝对路径**（`root` + 相对）：角色会话的 cwd 在 `.worktrees/<x>` 里，
 *  章程是主工作树刚生成的未提交文件、台账只在项目根，相对路径在那棵树里都打不开。 */
export function roleDocsPrompt(o: { root: string; charterRel: string; ledgerRel: string | null }): string {
  const root = o.root.replace(/[\\/]+$/, '')
  const lines = [
    '## 你的角色文档',
    `- 本项目对你这个角色的章程：\`${root}/${o.charterRel}\`，动手前先读（项目对你的要求；里面列的硬约束只是说明，执行在系统这边）`
  ]
  if (o.ledgerRel)
    lines.push(`- 你这条分支的台账：\`${root}/${o.ledgerRel}\`。每完成一个可交付的小步用 board_note 记一条（决定 / 未完成 / 给合并官 / 怎么验）`)
  return lines.join('\n')
}

/** 不起 git 进程读当前分支：worktree 的 .git 是文件 `gitdir: <path>`，主工作区是目录。
 *  `cwd` **必须是仓库根或 worktree 根** —— 只看 `<cwd>/.git`，不往上级目录找；传子目录进来一律 null。
 *  `read` **必须把目录映射为 null**（读到目录抛错就吞成 null）：这里靠「.git 读得出内容」区分
 *  worktree 与主工作区，目录被读成空串会走错分支。detached / 读不到 → null。 */
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
