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

import type { OmpSmokeResult } from '../../../shared/ompSetup.ts'


export interface OmpProviderChoice {
  /** 服务商 id。**用 omp 自己那份名单里的 id**（`auth-broker list`，69 家） */
  id: string
  /** 选中的模型。**值是 `<provider>/<model>`** —— omp 按 selector 认模型，
   *  裸名字它解析不到 provider（2026-09-02 那个 1004 就是这么来的）。 */
  model?: string
  /** 思考档（ACP 的 `thinking` 配置项） */
  thinking?: string
  /** 登录**成功**的时刻（ms epoch）。**只当探测失败时的兜底** ——
   *  真判据是「omp 列不列得出这家的模型」（`ompLoggedInFrom`）。
   *  单靠它的后果 2026-09-02 真机见过：写下去就永远为真，
   *  凭证过期了面板还说「配好了」，一试就翻车。 */
  loggedInAt?: number
}

/** 用户又选了一次服务商时，新的 provider 记录长什么样。
 *
 *  **单独摘成纯函数是因为这里错过一次，而且错得看不出来。**
 *  原来是把对象整个重建，`loggedInAt` 被静默丢掉 —— 症状不是报错，
 *  是「登录成功了，回头一看还要再登一次」，而且每次都这样。
 *
 *  规则：**同一家**留着登录记录与模型；**换一家**全部清掉 ——
 *  带着上一家的登录记录，面板会说「已登录」而一发消息就 401；
 *  model 同理，那是上一家的模型名。
 *
 *  （原来这里还有个 `authMode` 参数。它是我们自己记的一个选择，
 *  而保存模型那处调用**忘了带**，于是订阅用户被静默翻成「填 key」，
 *  转头被要求去填一把他根本没有的 key —— 2026-09-02 用户截图实拍。
 *  拆掉密钥柜之后这个字段整个没了，那类错也就没地方发生了。） */
export function mergeProviderChoice(
  prev: OmpProviderChoice | undefined,
  next: { id: string; model?: string; thinking?: string }
): OmpProviderChoice {
  const same = prev?.id === next.id
  return {
    id: next.id,
    model: next.model ?? (same ? prev?.model : undefined),
    thinking: next.thinking ?? (same ? prev?.thinking : undefined),
    loggedInAt: same ? prev?.loggedInAt : undefined
  }
}

export interface OmpSetup {
  provider?: OmpProviderChoice
  /** 上一次冒烟的结果。**只当展示用，不做放行判据** ——
   *  用户之后在密钥面板里换了 key，这里仍然是 true（`secrets:save` 改 key 不动
   *  `createdAt`、也没有 `updatedAt`，指纹核不出「换错了」）。
   *  真正的判据是起会话时那三道闸，以及第一轮撞到 401 时把状态打回去。 */
  lastSmoke?: OmpSmokeResult
  /** 工具审批档位。**不写 = `yolo`（默认不打断）**，用户在设置里可以调严。
   *
   *  用户 2026-09-02：「approvalMode 默认应该是 yolo，审批要用户去点设置。」
   *
   *  ⚠️ **它决定审批卡片存不存在**：那张卡是 omp 的 `session/request_permission`
   *  驱动的（`omp/approvals.ts`），yolo 下 omp 压根不发请求，卡片永远不出现。
   *  所以这里存的不是「偏好」，是「功能开不开」。
   *
   *  **档位管不到那四条 deny**（生图 / 浏览器 / 电脑控制 / TTS）——
   *  上游 deny 先于 mode 判定生效，红线不随它松。
   *
   *  这份文件是用户手改得到的 JSON，值一律经 `safeApprovalMode` 洗一遍再用。 */
  approvalMode?: 'always-ask' | 'write' | 'yolo'
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

// **不再有 `ompKeyVarNames`。** 拆掉密钥柜之后 omp 一个环境变量都不需要我们注入 ——
// 凭证在它自己的 `agent.db` 里，由 `auth-broker` 存、由它续期、需要 key 的那些
// 它自己会问。用户 2026-09-02：「取消密钥柜的概念呢，单纯用 oh my pi
// 成熟的登录流程然后 UI 化。」
