// 多 agent 总闸的判定与归属。
//
// 「要不要用多 agent」是**项目的属性**，不是每次任务的属性 —— 所以它是 Frame 上的
// 持久开关，不是每次由模型判断。开着才允许组队，关着时主 agent 连提议都不会有。
//
// **只有顶层项目 Frame 持有这个字段，子 Frame 继承父的。** 子 Frame 是文件夹分组，
// 不该各有一套团队设置 —— 这跟 canvasSlice 里 setFrameStatus 的处理是同一条道理
// （那边也是把 frameId 翻译成 projectId 再写）。
//
// 纯函数、不引 store/electron，node --test 直接跑。

export interface TeamFrame {
  id: string
  projectId: string | null
  parentId?: string | null
  teamMode?: boolean
}

/** 一路回溯到顶层 Frame（projectId 非空的那个）。`seen` 防止 parentId 成环时死循环
 *  —— 抄 canvasSlice.projectIdOfFrame 的同款写法，那条路已经被真实数据验证过。 */
export function topFrameOf<T extends TeamFrame>(frames: readonly T[], frameId: string): T | null {
  const seen = new Set<string>()
  let cur = frames.find((f) => f.id === frameId)
  while (cur && !cur.projectId && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id)
    cur = frames.find((f) => f.id === cur!.parentId)
  }
  return cur ?? null
}

/**
 * 这个 Frame（或它所属的项目）开没开多 agent。
 *
 * **默认 false** —— 跟密钥柜、审批 hook 一贯立场一致：会花钱的能力默认不开。
 * 找不到 Frame 也是 false，绝不因为「查不到」就放行。
 */
export function teamModeOf(frames: readonly TeamFrame[], frameId: string | null): boolean {
  if (!frameId) return false
  return topFrameOf(frames, frameId)?.teamMode === true
}

/** 开关该写到哪个 Frame 上：顶层那个。子 Frame 上点开关，写的是它爹。 */
export function teamModeTargetId(frames: readonly TeamFrame[], frameId: string): string | null {
  return topFrameOf(frames, frameId)?.id ?? null
}
