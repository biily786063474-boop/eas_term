// 安装 / 登录这条链路的日志。**写文件，不只是 console.log。**
//
// 为什么这条链路特别需要它：它的失败**全部发生在别人的机器上** ——
// 装没装成、CLI 版本对不对、登录卡在哪一步、系统弹没弹浏览器，
// 这些在开发机上一次都复现不了（我们这台早就装好也登好了）。
// 用户报「装不上」时，如果手里一条证据都没有，任何结论都只能靠猜。
//
// 范式抄 agentChat/session.ts 的 logSession（那份是 2026-08-20
// 「三次派发三次死在同一处、查的时候没有任何证据」之后加的），三条一样：
// ① 写 userData 下的文件 —— 打包版里 console 看不见
// ② 超过 1MB 从头写 —— 这是给「刚才发生了什么」用的，不是审计日志
// ③ **写不出来绝不能影响主流程** —— 日志是辅助，不能因为它让功能挂掉
//
// ── 不记什么 ────────────────────────────────────────────────────
// **授权码、token、URL 里的 code/state 参数一律不进日志。**
// 脱敏在 redact.ts（单独成文件是为了能被 node --test 直接跑）。
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import { redact } from './redact'

const FILE = 'cli-auth.log'
const MAX_BYTES = 1_000_000

export function alog(msg: string): void {
  const line = `${new Date().toISOString()} ${redact(msg)}`
  try {
    const f = path.join(app.getPath('userData'), FILE)
    let flag: 'a' | 'w' = 'a'
    try {
      if (fs.statSync(f).size > MAX_BYTES) flag = 'w'
    } catch {
      /* 还没这个文件，追加即可 */
    }
    fs.writeFileSync(f, line + '\n', { flag })
  } catch {
    /* 日志写不出来绝不能影响安装/登录本身 */
  }
  console.log(`[cliAuth] ${redact(msg)}`)
}

/** 日志文件在哪 —— 界面上「把日志发给我」那种入口要用 */
export function logPath(): string {
  try {
    return path.join(app.getPath('userData'), FILE)
  } catch {
    return FILE
  }
}

/** 读回最近若干行，给界面上的「诊断」用。
 *  **只读尾部** —— 整份读进来在 1MB 上限下也没必要。 */
export function tail(lines = 200): string[] {
  try {
    const all = fs.readFileSync(logPath(), 'utf8').split('\n').filter(Boolean)
    return all.slice(-lines)
  } catch {
    return []
  }
}
