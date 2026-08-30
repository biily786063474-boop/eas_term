// 手机端的操作留痕。**这不是可选功能，是放开写操作的前提。**
//
// 规格里那条原话：「没有留痕就上写操作，出问题时用户没有任何依据」。
// 第一步只读时可以先欠着（读操作没什么可追的），
// 第二步一旦让手机能在电脑上拉起进程，就必须先把这个补上。
//
// ── 记什么、不记什么 ──────────────────────────────────────────────
// **记**：哪台设备、什么时候、干了什么、成没成。
// **不记内容**：文档正文、图片、对话正文一个字都不进这里。
//   理由不是省空间 —— 是这份日志的用途是「回来之后知道发生过什么」，
//   而不是「把刚才看过的东西再存一份」。记内容等于在本地又复制一份项目数据，
//   而且它会跟着日志一起被翻出来。
//
// 写操作是例外：**请求本身要原样记下来**（比如「在哪个项目新建会话」），
// 因为那正是事后要复核的东西。
//
// ── 为什么单独一个文件而不是塞进 phone.json ────────────────────────
// phone.json 是**状态**（开关、设备表），每次改都整份重写；
// 日志是**流水**，只追加、有上限。混在一起会让每记一条就重写一遍凭据表。
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/** 留多少条。**按条不按天** —— 用得少的人一个月也攒不满，用得多的人
 *  一天就翻页；「最近 200 件事」在两种情况下都是同一个意思。 */
export const MAX_ENTRIES = 200

export interface AuditEntry {
  at: number
  deviceId: string
  deviceName: string
  action: string
  /** 一句话说清这次干了什么。**不含文件内容 / 对话正文** */
  detail: string
  /** 写操作才有：allowed / denied / expired */
  outcome?: 'allowed' | 'denied' | 'expired'
}

const file = (): string => path.join(app.getPath('userData'), 'phone-audit.json')

let cache: AuditEntry[] | null = null

function valid(e: unknown): e is AuditEntry {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  return (
    typeof o.at === 'number' &&
    typeof o.deviceId === 'string' &&
    typeof o.deviceName === 'string' &&
    typeof o.action === 'string' &&
    typeof o.detail === 'string'
  )
}

export function load(): AuditEntry[] {
  if (cache) return cache
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file(), 'utf8'))
    cache = Array.isArray(raw) ? raw.filter(valid).slice(-MAX_ENTRIES) : []
  } catch {
    cache = []
  }
  return cache
}

/** 追加一条。**同步写盘** —— 留痕晚一步落盘，正好赶上进程被杀就什么都没有了，
 *  而「出事那一刻」恰恰是最需要它的时候。这条路上一次几十字节，同步写不心疼。 */
export function record(e: AuditEntry): void {
  const list = load()
  list.push({ ...e, detail: e.detail.slice(0, 200) })
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES)
  try {
    fs.writeFileSync(file(), JSON.stringify(list), { mode: 0o600 })
  } catch (err) {
    console.error('[phone] 写留痕失败', err)
  }
}

/** 给界面看的：最近的排最前 */
export function recent(n = 50): AuditEntry[] {
  return load().slice(-n).reverse()
}

/** 用户点「清空留痕」。**不是自动清理** —— 这份东西什么时候不要了由人决定。 */
export function clear(): void {
  cache = []
  try {
    fs.rmSync(file(), { force: true })
  } catch {
    /* 没有就没有 */
  }
}

/** 一次请求该怎么记成一句话。**读操作只记「看了什么」，不记看到了什么。** */
export function describe(action: string, args: Record<string, unknown>): string {
  const p = typeof args.projectId === 'string' ? args.projectId.slice(0, 8) : ''
  switch (action) {
    case 'projects':
      return '看了项目列表'
    case 'sessions':
      return `看了项目 ${p} 的会话列表`
    case 'files':
      return `看了项目 ${p} 的文件列表`
    case 'file':
      // 记节点 id 不记路径：路径本身是信息（目录结构），日志里同样不该有
      return `打开了 ${p} 里的一个文件（节点 ${String(args.nodeId ?? '').slice(0, 14)}）`
    case 'newSession':
      return `请求在项目 ${p} 里新建一个 AI 对话`
    case 'newSessionStatus':
      return '' // 轮询，不值得记 —— 记了会把日志淹掉
    default:
      return action
  }
}
