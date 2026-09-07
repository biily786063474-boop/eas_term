// 协同板的纯渲染。**数据从哪来不归这里管**（main/collabBoard.ts 从会话表 + git 算；
// 注意**不是** main/board.ts —— 那个是项目看板的列，跟这块板毫不相干），
// 这里只负责把 rows 排成人和模型都读得懂的一张表。零依赖，node --test 裸跑。
export const BOARD_REL = '.eas/board.md'

export interface BoardRow {
  branch: string
  roleName: string
  roleId?: string
  alive: boolean
  idleMs: number
  startedAt: number
  /** 相对项目根，已排序去重 */
  files: string[]
  cwd: string
}

export interface Overlap {
  file: string
  branches: string[]
}

export const pad = (n: number): string => String(n).padStart(2, '0')
// **本地时间，不是 UTC。** 板是给坐在这台机器前的人读的：他看到「起于 12:35」
// 会拿自己的表去对。原来这里用 getUTC*，差多少小时看时区
// （2026-09-06 真机那份板上，本地 12:35 起的会话写成了 19:35，那台机器 UTC-7）。
export const hhmm = (t: number): string => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const stamp = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm(t)}`
}

function status(r: BoardRow): string {
  if (!r.alive) return '已停'
  const min = Math.floor(r.idleMs / 60_000)
  return min >= 5 ? `闲置 ${min} 分钟` : '活跃'
}

/** ≤3 个文件全列；多了按最深公共目录归并成 `dir/**（N 文件）` */
function touched(files: string[]): string {
  if (!files.length) return '—'
  if (files.length <= 3) return files.join(', ')
  const parts = files.map((f) => f.split('/').slice(0, -1))
  let common = parts[0]
  for (const p of parts.slice(1)) {
    let i = 0
    while (i < common.length && i < p.length && common[i] === p[i]) i++
    common = common.slice(0, i)
  }
  const dir = common.length ? common.join('/') + '/' : ''
  return `${dir}**（${files.length} 文件）`
}

export function findOverlaps(rows: BoardRow[]): Overlap[] {
  // 分支去重后才数 —— 同一条分支上开着两个活会话（换了个节点接着聊）改同一个文件，
  // 那是同一个人在改自己的树，不是「两条分支撞车」。不去重的话板上会挂一条
  // 「⚠ 两条分支都改了 x（eas/builder/ab12ef, eas/builder/ab12ef）」，
  // 而两个徽标都会变黄，指着一个并不存在的冲突。
  const byFile = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.alive) continue
    for (const f of r.files) {
      const set = byFile.get(f) ?? new Set<string>()
      set.add(r.branch)
      byFile.set(f, set)
    }
  }
  return [...byFile.entries()]
    .filter(([, b]) => b.size >= 2)
    .map(([file, branches]) => ({ file, branches: [...branches] }))
}

export function renderBoard(rows: BoardRow[], now: number, overlaps: Overlap[] = findOverlaps(rows)): string {
  const head = `# 协同板 · ${stamp(now)} 自动生成，勿手改`
  if (!rows.length) return `${head}\n\n没有活跃分支。\n`
  const lines = [head, '', '| 分支 | 角色 | 状态 | 起于 | 触及 |', '|---|---|---|---|---|']
  for (const r of rows) lines.push(`| ${r.branch} | ${r.roleName} | ${status(r)} | ${hhmm(r.startedAt)} | ${touched(r.files)} |`)
  for (const o of overlaps) lines.push(`| ⚠ 两条分支都改了 ${o.file}（${o.branches.join(', ')}） |`)
  return lines.join('\n') + '\n'
}

/** 注入系统提示用：几行以内全文；超过 maxLines 截断并指路 */
export function clipForPrompt(text: string, maxLines = 20): string {
  const lines = text.replace(/\n$/, '').split('\n')
  if (lines.length <= maxLines) return lines.join('\n')
  const rest = lines.length - maxLines
  return [...lines.slice(0, maxLines), `…（还有 ${rest} 行，完整内容见 ${BOARD_REL}，用 board_read 读）`].join('\n')
}
