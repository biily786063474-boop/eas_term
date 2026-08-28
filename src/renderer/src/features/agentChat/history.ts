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

/** 保留最近多少轮。**按轮不按字节** —— 字节裁剪会把一轮切成半截，
 *  读起来比没有更糟；40 轮足够回看「上次聊到哪」，那正是这个功能的目的。 */
export const MAX_TURNS = 40

/** 单条命令输出保留多少字符。回看历史时要的是「跑过什么、成没成」，
 *  不是完整日志 —— 真要看细节的人会去终端里重跑。 */
export const MAX_EXEC_OUTPUT = 1200

/** 落盘前把一份 turns 裁到合理体积。**不改变顺序，也不合并任何轮次。** */
export function trimForSave(turns: readonly Turn[]): Turn[] {
  return turns.slice(-MAX_TURNS).map((t) => ({
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
