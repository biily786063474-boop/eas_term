// omp 的配置状态：**用户选了哪个服务商、哪个模型、上次冒烟过没过**。
// key 本身不在这里 —— 它在密钥柜，这里只记「要去柜里取哪个变量名」。
//
// ── 为什么不放进 `prefs.ts`（spec 原本这么写的）─────────────────────────────
// `prefs.ts` 的 `prefs:set` 是一张 **key 白名单**，不在名单里的写入会走到最后那句
// `return getPrefs()` —— **不报错、还回一个看起来正常的快照**；而 `getPrefs()` 又是
// 逐字段重建缓存，没登记的键连读都读不回来。也就是说放进去要同时改四处
// （`Prefs` 接口、`getPrefs` 的兜底、`prefs:set` 的白名单、preload 手抄的 `PrefsSnapshot`），
// 漏任何一处的症状都是「界面显示已保存、重启归零」，而且没有任何报错。
//
// 这份状态只有主进程读、只有设置面板写，不需要跟着 prefs 那套同步给渲染层，
// 所以给它一个独立文件更省事也更难写坏。**代价**：多一种持久化数据
// （图纸 10「一种持久化数据」那条规矩），落点写死在 userData 下、不接受外部传路径。
import fs from 'node:fs'
import path from 'node:path'

import { ompKeyEnvName } from './config.ts'

export interface OmpProviderChoice {
  /** 服务商 id，与 `models.yml` 里的键、以及 `EAS_OMP_<ID>_KEY` 的中段一致 */
  id: string
  /** **用订阅还是填 key**。两条并列的路，起会话前的闸门判据完全不同
   *  （见 `shared/ompSetup.ts` 的 `ompLaunchGate`）。
   *  缺省按 `'apikey'` 算 —— 这个字段是后加的，老配置里没有它，
   *  而在它存在之前只有填 key 那一条路。 */
  authMode?: 'subscription' | 'apikey'
  /** 选中的模型。**值是 `<provider>/<model>`**，因为 ACP 的 `set_config_option`
   *  收的就是这个形态（真录：`zhipu-free/glm-5.3-flash`），不是裸模型名 */
  model?: string
  /** 思考档（ACP 的 `thinking` 配置项） */
  thinking?: string
  /** 订阅登录**成功**的时刻（ms epoch）。只对 `'subscription'` 有意义。
   *
   *  **必须单独记，不能拿「冒烟跑通过没有」顶替**：登录刚完成时冒烟还没跑，
   *  用后者判的话 `nextStepOf` 会说「还要去登录」—— 用户刚登完就被弹回登录页，
   *  再登一次还是弹回来。2026-09-02 真机撞到过。 */
  loggedInAt?: number
}

export interface OmpSetup {
  provider?: OmpProviderChoice
  /** 上一次冒烟的结果。**只当展示用，不做放行判据** ——
   *  用户之后在密钥面板里换了 key，这里仍然是 true（`secrets:save` 改 key 不动
   *  `createdAt`、也没有 `updatedAt`，指纹核不出「换错了」）。
   *  真正的判据是起会话时那三道闸，以及第一轮撞到 401 时把状态打回去。 */
  lastSmoke?: { ok: boolean; at: number; message?: string }
}

const FILE = 'omp-setup.json'

export function ompSetupPath(userData: string): string {
  return path.join(userData, FILE)
}

/** 读。**读不到 / 坏了一律回空对象**，不抛 —— 它在起会话的路径上，
 *  为一份配置文件把整个会话拦下来不值当（缺 provider 那道闸自然会拦，且话说得更准）。 */
export function readOmpSetup(userData: string): OmpSetup {
  try {
    const v = JSON.parse(fs.readFileSync(ompSetupPath(userData), 'utf8')) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return v as OmpSetup
  } catch {
    return {}
  }
}

/** 写。整份覆盖（调用方自己合并）—— 部分更新的语义留给调用方，
 *  这一层不猜「没给的字段是要删还是要留」。 */
export function writeOmpSetup(userData: string, next: OmpSetup): void {
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(ompSetupPath(userData), JSON.stringify(next, null, 2), 'utf8')
}

/** 这个会话要从密钥柜取哪几个变量名。
 *
 *  **每次 spawn 现算，不缓存在 adapter 上**：`adapters/index.ts` 的注册表是模块级常量，
 *  把名单写死在上面的话，用户换 provider 之后那份值就是错的；而**空名单**会让
 *  `secretsEnv([])` 直接回 `{}`、`secretsHas([])` 的 `.every()` 恒真 —— 两道闸一起失效，
 *  进程照起、一把 key 都没注入，用户看到的是 provider 回的 401。 */
export function ompKeyVarNames(setup: OmpSetup): string[] {
  // **订阅那条路没有 key 可注入**：凭证是 OAuth 令牌，在 omp 自己的 agent.db 里，
  // 由它负责刷新。这里返回空名单，闸门那侧靠 authMode 分辨「空是因为订阅」
  // 还是「空是因为还没选服务商」—— 两者的下一步完全不同。
  if (setup.provider?.authMode === 'subscription') return []
  return setup.provider?.id ? [ompKeyEnvName(setup.provider.id)] : []
}
