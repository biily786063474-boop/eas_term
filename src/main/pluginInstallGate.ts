// 安装确认闸门:两段式安装的一次性凭证。**零 electron,`node --test` 裸跑。**
//
// 为什么要闸门(延续「不静默装」红线):`plugins:install` 只把包下载、校验、解压到
// **临时目录**,把要装什么、要什么权限交回渲染层给用户看;用户点确认后才带着 token
// 调 `plugins:installCommit`,主进程凭 token 找到那份临时目录、原子移入 ~/.eas/plugins。
// token 一次性 + 30 秒过期(仿 runtime/stopGate 的一次性凭证):
//   · 一次性 —— 装完即失效,重放同一个 token 不会再装一遍
//   · 过期 —— 用户晾着不确认的临时目录不会永久占着,sweep 出来让调用方清盘
import { randomUUID } from 'node:crypto'

/** 一份已解压到临时目录、等用户确认的插件。dir 是临时目录,commit 时从这里搬走。 */
export interface StagedPlugin {
  name: string
  dir: string
  version: string
  displayName: string
  permissions: Record<string, string[]>
  size: number
}

export interface InstallGate {
  /** 登记一份待确认的插件,返回一次性 token。 */
  stage(rec: StagedPlugin): string
  /** 凭 token 取走(一次性):有效且未过期返回记录并注销;否则 undefined。 */
  consume(token: string): StagedPlugin | undefined
  /** 只看不取(展示用),过期也返回 undefined。 */
  peek(token: string): StagedPlugin | undefined
  /** 清出所有已过期的记录并注销,返回它们(调用方据此删临时目录)。 */
  sweep(): StagedPlugin[]
}

export function createInstallGate(opts?: {
  ttlMs?: number
  now?: () => number
  token?: () => string
}): InstallGate {
  const ttl = opts?.ttlMs ?? 30_000
  const now = opts?.now ?? Date.now
  const mkToken = opts?.token ?? randomUUID
  const map = new Map<string, { rec: StagedPlugin; expiresAt: number }>()

  const sweep = (): StagedPlugin[] => {
    const t = now()
    const dead: StagedPlugin[] = []
    for (const [token, v] of map) {
      if (v.expiresAt <= t) {
        dead.push(v.rec)
        map.delete(token)
      }
    }
    return dead
  }

  return {
    stage(rec) {
      const token = mkToken()
      map.set(token, { rec, expiresAt: now() + ttl })
      return token
    },
    consume(token) {
      sweep()
      const v = map.get(token)
      if (!v) return undefined
      map.delete(token)
      return v.rec
    },
    peek(token) {
      const v = map.get(token)
      if (!v || v.expiresAt <= now()) return undefined
      return v.rec
    },
    sweep
  }
}
