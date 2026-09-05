// 「这个会话默认用哪个 CLI」。**单独摘成纯函数，因为它有一条容易写反的规矩。**
//
// 原来这段逻辑写在 `AgentChatView` 的 effect 里，读得懂但测不到 ——
// 而它决定的是用户打开软件看到的第一个 agent，写反了每个人都撞得上。
import type { CliInfo } from '../../../../shared/agentChat'

/** 挑默认那个。
 *
 *  规矩两条，方向相反：
 *
 *  · **随包的那个（`bundled`）排最后。** 它的 `available` 恒真（就在安装包里，
 *    探测必过），跟着「取第一个」走的话，**只登了 Claude 的老用户升级当天
 *    每开一个新会话都会被换成随包这个** —— 而他还没配好，等于软件自己
 *    把自己变成不可用。
 *
 *  · **但别人都没装时，就该用它。** 这正是随包带一个的意义：
 *    一台干净的机器上，用户不该先去装 Claude Code 或 Codex 才能开始。
 *    用户 2026-09-02：「我希望这个 harness 在没安装 cc 和 codex 的时候是默认用这个的。」
 *
 *  判据是 `bundled` 这个**能力位**，不是 CLI 的 id —— 将来再随包带第二个也照样成立。 */
export function pickDefaultCli(usable: CliInfo[], pinned?: CliInfo, lastUsed?: string): CliInfo | null {
  // pane 指定的压过一切：插件属于哪个 CLI 是**确定的**（GitHub 是 Codex 的、
  // claude-mem 是 Claude 的），挑错家伙 = 那个插件的工具在会话里根本不存在。
  // 这不是偏好问题，是能不能用的问题。
  if (pinned) return pinned
  // **用户上次的选择排在推测之前。**
  // 下面那两条（随包排最后 / 取第一个）都是「他没表过态时」的推测；
  // 而这一条是他明确点过的。推测压过选择，就是软件在跟用户较劲。
  // 用户 2026-09-02：「我上次用了 cc 下次新建还是 cc。」
  // 上次那个已经用不了了（卸载了 / 不支持会话）就往下退，不留空白。
  const remembered = lastUsed ? usable.find((c) => c.id === lastUsed) : undefined
  if (remembered) return remembered
  return usable.find((c) => !c.bundled) ?? usable[0] ?? null
}

/** 「上次用的是哪个」存在哪。**localStorage，不是 prefs** ——
 *  `prefs:set` 是一张 key 白名单且只收布尔（`!!value`），加一个字符串字段要同时改四处
 *  （Prefs 接口、getPrefs 兜底、prefs:set 白名单、preload 手抄的 PrefsSnapshot），
 *  漏任何一处的症状都是「界面显示已保存、重启归零」而且不报错。
 *  这条偏好又是**每台机器各自一份**（这台装了 Claude、那台没装），
 *  跟着机器走正好，走 localStorage 与 `uiSlice` 里那批 UI 偏好同一条路。 */
const LAST_CLI_KEY = 'eas.agentChat.lastCli'

export function readLastCli(): string | undefined {
  try {
    return localStorage.getItem(LAST_CLI_KEY) ?? undefined
  } catch {
    // 隐私模式 / 存储被禁：记不住只是回到「按推测挑」，不该让面板起不来
    return undefined
  }
}

export function writeLastCli(id: string): void {
  try {
    localStorage.setItem(LAST_CLI_KEY, id)
  } catch {
    // 同上，记不住不是错误
  }
}

// ── 已有对话归谁：**从签发者推，不猜** ─────────────────────────────────────
//
// 2026-09-04 事故：一段 Claude Code 的对话（40 轮）重挂载时被 `pickDefaultCli`
// 的推测链（`lastUsed` = 用户刚在别处用过的 omp）挑成了 omp，Claude 的 resumeId
// 被递给 omp → "ACP session not found" → 那条对话永久报废。更糟的是 `setAgentCli`
// 把这个**猜出来的** omp 钉进了 `pane.cli`，错误从此固定。
//
// 根子：`lastUsed` 是给**新建对话**的偏好，拿它决定一段**已经存在**的对话归谁，
// 就是「软件在跟用户较劲」。而一个 resumeId 只属于签发它的那个 harness ——
// 所以已有对话的归属必须从 `resumeCli`（谁报回的 id 就记谁）推出来，
// 推测链只有在**没有 resumeId** 时才轮得到。

export interface ConversationPick {
  /** 应该用哪个；一个都不能用时 null */
  cli: CliInfo | null
  /** 手里的 resumeId **不属于**选出来的这个 cli —— 调用方必须把它丢掉并告知用户，
   *  绝不能递给一个认不得它的 harness（那正是事故的样子）。 */
  dropResume: boolean
  /** 为什么选了它（给日志/排障看，不给用户看） */
  why: 'resumeCli' | 'pinned' | 'guess' | 'none'
}

/**
 * 决定一段对话用哪个 CLI。
 *
 * 优先级（越前越硬）：
 *  1. `resumeCli`（resumeId 的签发者）在 usable 里 → 用它。**压过 pinned** ——
 *     pinned 可能是 bug 版本用猜的写进去的（事故里那两条就是），而签发者是事实。
 *  2. `resumeCli` 不在 usable 里（卸载了）→ 退回 pinned / 推测，**但要 dropResume**：
 *     换了 harness 就接不回上下文，id 不能跟过去。
 *  3. 没有 resumeId 的对话（全新）→ pinned，再 `pickDefaultCli` 的推测链。
 *
 * @param resumeCli  resumeId 的签发者；`undefined` = 没有 resumeId 或不知道签发者
 * @param hasResume  手里到底有没有 resumeId（签发者未知但 id 在，也算有）
 */
export function resolveConversationCli(
  usable: CliInfo[],
  o: { pinned?: string; resumeCli?: string; hasResume: boolean; lastUsed?: string }
): ConversationPick {
  const find = (id?: string): CliInfo | undefined => (id ? usable.find((c) => c.id === id) : undefined)

  const owner = find(o.resumeCli)
  if (owner) return { cli: owner, dropResume: false, why: 'resumeCli' }

  const pinned = find(o.pinned)
  const guessed = pinned ?? pickDefaultCli(usable, undefined, o.lastUsed)
  if (!guessed) return { cli: null, dropResume: false, why: 'none' }

  // 有 resumeId 但选出来的不是签发者：
  //  · 签发者已知且不可用 → 一定要丢
  //  · 签发者未知（老数据、磁盘也查不到）→ 也丢：拿一个来路不明的 id 去 resume，
  //    赌对了是运气，赌错了就是事故。丢掉最多损失一次上下文，用户会被告知。
  const dropResume = o.hasResume && guessed.id !== o.resumeCli
  return { cli: guessed, dropResume, why: pinned ? 'pinned' : 'guess' }
}
