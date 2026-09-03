// 空 Frame（用户口中的「造梦空间」）上那排引导按钮：显示哪几颗、各自什么状态。
//
// **纯函数，可单测。** 抽出来的理由和 pickCli.ts 一样：它决定用户新建一个造梦空间
// 之后看到的第一屏，写错了每个人都撞得上，而写在组件的 effect 里测不到。
//
// ── 顺序为什么写死在这里，而不是复用 pickCli ────────────────────────────────
// `pickCli.ts` 的 `pickDefaultCli` 管的是「**没人明说时**用哪个」——
// 它有条「随包的排最后」的规矩，会跟着「这台机器装了什么」变。
// 而这排按钮是**摆在眼前让人挑**的，用户 2026-09-02 要的是「按常用度」固定：
// 第三颗永远是同一个，不因为今天装没装 Claude 就换位置（肌肉记忆）。
//
// 两件事共用一套顺序，改一处必然弄坏另一处。所以这里独立定义，别去动 pickCli。

import type { CliInfo } from '../../../../shared/agentChat'

/** 按常用度固定的顺序（用户 2026-09-02 拍板）。名单外的 CLI 排在后面，保持原顺序 ——
 *  第四个 CLI 接进来时不该因为没登记在这儿就整个消失。 */
export const START_ORDER = ['claude', 'codex', 'omp'] as const

/** 一颗按钮该长什么样。 */
export interface StartChoice {
  cli: CliInfo
  /** 点下去会发生什么。
   *
   *  **界面上不再显示这句话**（用户 2026-09-03：「这三个胶囊中不要有什么
   *  点一下登录类似的文案」）—— 三颗并排的胶囊，一颗底下多一行字，
   *  三颗就不一样高，而那行字说的事点进去自然会看到。
   *
   *  留着这个字段是因为**界面仍然要靠它把没配好的那颗压暗一档**
   *  （`.pending`），只是不再用文字讲。 */
  state: 'ready' | 'need-install' | 'need-setup'
}

/**
 * 排出这排按钮。
 *
 * @param clis   `listClis()` 的原样返回。**不过滤没装的** —— 用户第一次打开软件时
 *               一个都没装，那时候恰恰最需要看见「有哪些可选」（同 CliInfo.available 的注释）。
 * @param setUp  这个 CLI 配好了没有。只有调用方知道：claude/codex 看登录态，
 *               随包那个（omp）看它自己的四档配置状态机（`nextStepOf`）。
 *               返回 `undefined` = 还没探出来，按「就绪」显示，别在加载中吓唬人。
 */
export function startChoices(
  clis: readonly CliInfo[],
  setUp: (cli: CliInfo) => boolean | undefined
): StartChoice[] {
  const rank = (id: string): number => {
    const i = START_ORDER.indexOf(id as (typeof START_ORDER)[number])
    return i < 0 ? START_ORDER.length : i
  }
  return [...clis]
    // 不支持在这儿跑会话的不进来（装了也选不了，列出来只会让人点了发现没用）
    .filter((c) => c.chatSupported)
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((cli) => {
      if (!cli.available) return { cli, state: 'need-install' as const }
      // 探测还没回来时不压暗：那一瞬间的「没配好」是假的
      if (setUp(cli) === false) return { cli, state: 'need-setup' as const }
      return { cli, state: 'ready' as const }
    })
}
