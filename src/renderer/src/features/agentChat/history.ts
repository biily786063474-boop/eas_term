// 聊天记录落盘前的裁剪。
//
// 为什么要裁：一次长对话的 turns 里，绝大部分体积在两个地方 ——
//   · `exec.output`：一条 npm test 的输出就能上百 KB，而回看历史时只需要看个开头
//   · `images[].url`：那是给界面预览用的缩略图 URL，可能是 data: URI（几百 KB 一张）
// 原样落盘的话，几十个 agent 节点各存一份，很快就是几百 MB。
// 这个仓库在终端 scrollback 上已经吃过一次同样的亏（75MB/终端）。
//
// **路径留着、URL 丢掉**：`path` 是磁盘上的真实位置，恢复时按它重新生成预览 URL 即可；
// URL 是运行时产物，存了也没有意义（下次进程的 easfile 协议地址不一定一样）。
//
// 纯函数、不引 electron/react，node --test 直接跑。

import type { Turn } from './reduce'

/** 保留最近多少个 **assistant** 轮次。**按轮不按字节** —— 字节裁剪会把一轮切成半截，
 *  读起来比没有更糟；40 轮足够回看「上次聊到哪」，那正是这个功能的目的。
 *
 *  **提问不占这个预算**，见 MAX_USER_TURNS。 */
export const MAX_TURNS = 40

/** 提问最多留多少条。
 *
 *  为什么提问要单独算额度：**一次提问要 6–39 段回答（2026-09-01 实测盘上 4 份含提问的记录：
 *  5.7 / 9.0 / 19.0 / 39.0，合计 user 13 : assistant 147）。
 *  原来 40 轮的预算是两者共用的，于是一份记录里常常只装得下一两条提问——
 *  实测最新的 4 份分别只有 1/2/4/6 条（更早的 21 份一条都没有，那是另一个已修的
 *  bug：落盘存的是归约器原始输出，里面从来没有 user 轮次）。
 *
 *  后果不只是「看不到自己问过什么」：**吸顶路标挂在 user 轮次上**
 *  （MessageList.tsx 的哨兵），没有 user 轮次就没有路标，滚一整屏答案顶上空空如也。
 *
 *  提问的体积可以忽略——一句话 vs 一个带 execs 的 assistant 轮次（2.5–25KB），
 *  60 条提问加起来也就十几 KB，所以给它一条独立的、宽得多的额度。 */
export const MAX_USER_TURNS = 60

/** 单条命令输出保留多少字符。回看历史时要的是「跑过什么、成没成」，
 *  不是完整日志 —— 真要看细节的人会去终端里重跑。 */
export const MAX_EXEC_OUTPUT = 1200

/**
 * 挑出要落盘的那些轮次的下标（升序）。
 *
 * **两条独立额度，从后往前各扣各的**：assistant 轮次扣 MAX_TURNS，user 轮次扣
 * MAX_USER_TURNS。额度用完的那一类继续往前扫时直接跳过，另一类照常收。
 *
 * 所以结果**可能不连续**：最早那几个提问会连成一串出现在开头、它们的答案不在了。
 * 这是有意的，而且跟内存里的形状一致——归约器 trimTurns() 砍掉的区间里那些提问，
 * 在 mergeUserMessages 里同样被 `max(0, …)` 收拢到开头。两边同构，
 * 重开前后看到的东西才是连续的。
 */
function keepIndexes(turns: readonly Turn[]): number[] {
  const keep: number[] = []
  let asst = 0
  let user = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') {
      if (user >= MAX_USER_TURNS) continue
      user += 1
    } else {
      if (asst >= MAX_TURNS) continue
      asst += 1
    }
    keep.push(i)
  }
  return keep.reverse()
}

/** 落盘前把一份 turns 裁到合理体积。**不改变顺序，也不合并任何轮次。** */
export function trimForSave(turns: readonly Turn[]): Turn[] {
  return keepIndexes(turns).map((i) => turns[i]).map((t) => ({
    role: t.role,
    text: t.text,
    execs: t.execs.map((e) => ({
      execId: e.execId,
      label: e.label,
      detail: e.detail,
      state: e.state,
      ...(e.output === undefined
        ? {}
        : {
            output:
              e.output.length > MAX_EXEC_OUTPUT
                ? e.output.slice(0, MAX_EXEC_OUTPUT) + `\n…（已截断，原长 ${e.output.length} 字符）`
                : e.output
          })
    })),
    // url 是运行时产物，不落盘；path 留着，恢复时重新生成预览
    ...(t.images?.length ? { images: t.images.map((i) => ({ path: i.path, url: '' })) } : {}),
    // **压缩标记必须留着。** 它不是内容是结构——丢了的话重开之后，
    // 那道「以上内容 agent 已经不记得了」的线就没了，
    // 又回到「界面摆着历史、模型不记得」那个状态（见 contextLostOf 的注释）
    ...(t.compact ? { compact: t.compact } : {})
  }))
}

/**
 * 这份历史，模型还接得回吗。
 *
 * 记录绑在**画布节点**上，模型的记忆绑在 **CLI 的会话 id**（resumeId）上 ——
 * 两者会分家：CLI 那边清理了旧会话、用户换了个 CLI（Claude 的 id Codex 不认）、
 * 或者上次 resume 失败被那条 fallback 清掉过。
 *
 * 那时界面上摆着满屏历史、模型却完全不记得，**人看着历史会以为它记得** ——
 * 比空白更糟，空白至少是诚实的。所以要能判出来并在界面上说明。
 *
 * **宁可漏报也不误报**：历史里没记 resumeId（旧版本写的、或者存得太早、
 * session.ready 还没到）一律当成「接得上」。误报会让人不信任正常的恢复，
 * 而漏报最多是没提示——那正是这个功能上线前的状态。
 */
export function contextLostOf(
  historyResumeId: string | null,
  paneResumeId: string | null | undefined
): boolean {
  if (!historyResumeId) return false
  return historyResumeId !== (paneResumeId || null)
}

/** 读回来的历史里，`state: 'running'` 是**上次退出时卡在半路的那一条**。
 *  原样渲染的话界面上会有一个永远转不完的圈 —— 进程早就没了，不会再有事件来收尾。 */
export function settleOnLoad(turns: readonly Turn[]): Turn[] {
  return turns.map((t) => ({
    ...t,
    execs: t.execs.map((e) => (e.state === 'running' ? { ...e, state: 'failed' as const } : e))
  }))
}
