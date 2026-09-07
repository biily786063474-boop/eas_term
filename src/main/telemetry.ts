// 匿名使用统计。
//
// ============================ 采集边界 ============================
// **能采的只有下面 EVENTS 里列出的这几个计数器，加上时长和版本/系统大类。**
// 想加新字段，先问一句「这条数据泄露了用户在做什么吗」——
// 只要答案沾边，就不要加。以下几类是明令禁止的，不接受任何理由：
//
//   · 终端里的任何字符（命令、输出、报错）
//   · 文件路径、文件名、项目名、目录结构
//   · 与 AI 的对话内容、提示词、模型回答
//   · 密钥柜里的任何东西、剪贴板、粘贴的图片
//   · 任何能跨天认出同一个人的标识符
//
// 没有客户端 ID 是刻意的：活跃数由服务端按「当日 IP+UA 哈希」估算，隔天就对不上，
// 因此算不出**个体**留存——这是为隐私付的代价，不是漏做。
//
// 2026-09-07 补充：留存分布现在能算了，但**上面那条禁令一个字没改**。
// 做法是「本地算、只报桶」：使用龄的账本（首个使用日 / 活跃过多少天）留在本机
// userData 里，**永远不上报**；上报的只有一个粗分桶 age=d1|d2_3|d4_7|d8_30|d30p。
// 桶不是标识符 —— 同一个桶里有很多人，服务端拿它认不出任何个体，
// 也无法把今天的某人和昨天的某人对上。
// ⚠️ **不要改成上报天数**（age=137 那样）：在个位数用户量下，
//    「用了 137 天」几乎就是一个唯一标识，那才是真的越线。
//
// 上报走官网那个 /e 端点（nginx 直接 return 204 写日志，服务端零常驻进程），
// 用 t=app 和网页访问区分开。
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, ipcMain, net } from 'electron'
import { getPrefs } from './prefs'

const ENDPOINT = process.env.EAS_TELEMETRY_URL || 'https://eas.biily.top/e'
/** 开发构建默认不上报（调试时反复启停会把真实数据搅乱）。
 *  置 1 可以强行上报，**只用于把这条链路真机验证一遍**，别在日常开发里开着。 */
const FORCE_DEV = process.env.EAS_TELEMETRY_FORCE === '1'

/** 心跳间隔。崩溃时最多丢这么久的时长，同时不至于把日志刷爆 */
const HEARTBEAT_MS = 5 * 60 * 1000

/** 允许上报的计数器白名单。渲染层报上来的名字不在这里面就直接丢，
 *  免得日后有人顺手 bump 一个带项目名的 key 就把隐私承诺破了。 */
const EVENTS = [
  'term', // 新建终端
  'canvas', // 新建画布节点
  'voice', // 用了语音输入
  'image', // 往输入框贴/拖了图片
  'island', // 从灵动岛跳回会话
  'approve', // 在灵动岛处理了审批
  'view', // 切换终端/画布视图
  'agent' // 新建 AI 对话面板
] as const
type EventKey = (typeof EVENTS)[number]

const counts = new Map<EventKey, number>()
let startedAt = Date.now()
/** 上一次把时长报出去的时刻。只报增量，服务端累加 */
let reportedUntil = Date.now()
let timer: ReturnType<typeof setInterval> | null = null

/** 使用龄的本地账本。**这个文件永远不上报**，只用来算「今天是第几个使用日」。
 *  刻意不存日期列表，只存三个值 —— 存了列表就等于在本机留了一份作息记录，没必要。 */
type AgeBook = { first: string; days: number; last: string }

function agePath(): string {
  return join(app.getPath('userData'), 'telemetry-age.json')
}

function todayStr(): string {
  const d = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** 今天第一次调用时把活跃天数 +1 并落盘，返回累计活跃天数。 */
function bumpAge(): number {
  const today = todayStr()
  let book: AgeBook
  try {
    book = JSON.parse(readFileSync(agePath(), 'utf8')) as AgeBook
  } catch {
    book = { first: today, days: 0, last: '' }
  }
  if (book.last !== today) {
    book.days = (book.days || 0) + 1
    book.last = today
    // 写不进去就算了：统计不该影响启动，更不该因为磁盘满就崩
    try {
      writeFileSync(agePath(), JSON.stringify(book))
    } catch {
      /* 忽略 */
    }
  }
  return book.days
}

/** 使用龄分桶。**只报桶不报天数**，理由见文件头。 */
function ageBucket(days: number): string {
  if (days <= 1) return 'd1'
  if (days <= 3) return 'd2_3'
  if (days <= 7) return 'd4_7'
  if (days <= 30) return 'd8_30'
  return 'd30p'
}

let ageCache = ''

/** 懒加载：只有真要发上报时才去动账本。
 *  这样天然尊重开关 —— send() 的两个调用点都先检查过 getPrefs().telemetry。 */
function currentAge(): string {
  if (!ageCache) ageCache = ageBucket(bumpAge())
  return ageCache
}

function osName(): string {
  if (process.platform === 'darwin') return 'macOS'
  if (process.platform === 'win32') return 'Windows'
  if (process.platform === 'linux') return 'Linux'
  return 'Other'
}

/** 把计数器编成 `term:3,voice:1`。空的就不发这个字段 */
function packCounts(): string {
  const parts: string[] = []
  for (const [k, v] of counts) if (v > 0) parts.push(`${k}:${v}`)
  return parts.join(',')
}

/** 发一发就算了，不重试、不看响应。统计数据丢几条无所谓，
 *  为它做重试队列反而会在网络不好时反复占用带宽。 */
function send(params: Record<string, string | number>): void {
  // 所有 app 上报统一带使用龄桶。放在这里而不是各调用点，免得日后新增上报忘了带
  const withAge = params.t === 'app' ? { ...params, age: currentAge() } : params
  const q = Object.entries(withAge)
    .filter(([, v]) => v !== '' && v !== 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  try {
    const req = net.request({ url: `${ENDPOINT}?${q}`, method: 'GET' })
    req.on('response', (res) => res.on('data', () => {}))
    req.on('error', () => {})
    req.end()
  } catch {
    /* 统计失败绝不能影响应用 */
  }
}

/** 上报一次：这一段的时长 + 期间的功能计数，然后清零重新计。
 *  reason 只有 hb / quit 两种，用来在服务端区分「还在用」和「退出了」。 */
function flush(reason: 'hb' | 'quit'): void {
  if (!getPrefs().telemetry) return
  if (!app.isPackaged && !FORCE_DEV) return

  const now = Date.now()
  const sec = Math.round((now - reportedUntil) / 1000)
  const f = packCounts()
  // 没时长也没动作就别发了（比如刚启动就退出）
  if (sec <= 0 && !f) return
  reportedUntil = now
  counts.clear()

  send({
    t: 'app',
    e: reason,
    v: app.getVersion(),
    os: osName(),
    arch: process.arch,
    sec: sec > 0 ? sec : 0,
    f
  })
}

export function bump(key: string, n = 1): void {
  if (!EVENTS.includes(key as EventKey)) return
  counts.set(key as EventKey, (counts.get(key as EventKey) ?? 0) + n)
}

export function registerTelemetry(): void {
  ipcMain.on('telemetry:event', (_e, key: string) => bump(key))

  // 开关改了：关掉时把攒着的计数丢掉（那是用户没同意上报的数据，不该留着等下次开）
  ipcMain.on('telemetry:refresh', () => {
    if (!getPrefs().telemetry) {
      counts.clear()
      reportedUntil = Date.now()
    }
  })

  startedAt = Date.now()
  reportedUntil = startedAt
  // 启动事件单独报一次，好算「启动次数」；延迟一点，别和启动抢资源
  setTimeout(() => {
    if (getPrefs().telemetry && (app.isPackaged || FORCE_DEV)) {
      send({ t: 'app', e: 'start', v: app.getVersion(), os: osName(), arch: process.arch })
    }
  }, Number(process.env.EAS_TELEMETRY_START_MS) || 20_000)

  timer = setInterval(() => flush('hb'), HEARTBEAT_MS)

  // 退出前尽力报最后一段。**不阻塞退出**：请求发出去就走，
  // 卡在这里等响应的话，网络不通时用户会觉得「关不掉」。
  //
  // 只报一次：实测 before-quit 在一次退出里会触发两遍（第二遍 sec=1），
  // 不去重的话服务端会把同一次会话记成两条。
  let quitReported = false
  app.on('before-quit', () => {
    if (quitReported) return
    quitReported = true
    if (timer) clearInterval(timer)
    timer = null
    flush('quit')
  })
}

/** 这次会话开了多久（秒）。目前只给调试看，没有对外接口 */
export function sessionSeconds(): number {
  return Math.round((Date.now() - startedAt) / 1000)
}
