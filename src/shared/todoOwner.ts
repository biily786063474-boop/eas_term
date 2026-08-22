// 待办清单归谁 —— **按位置算，不存字段**。
//
// 待办清单是世界坐标、自由漂浮的（TodoBoard 的类型注释：「不属于任何 Frame/项目」）。
// 而 MCP 调用方手里只有 EAS_PROJECT 和它所在的 Frame，两边本来对不上。
//
// 用户 2026-08-21 拍板「按 Frame 归属 + agent 只读」。选按位置判而不是存 frameId：
// · 零操作 —— 把清单拖进某个 Frame 它就归那个 Frame，符合人对「放进去」的直觉
// · 不会有存量数据的迁移问题（现有清单一个字段都没有）
// · **只读的前提下算错的代价很小** —— 无非是 agent 看得见/看不见，不会写坏东西
//
// 代价要说清楚：拖动 Frame 时待办**不会跟着走**（它是世界坐标），
// 于是归属可能"掉"出去。真成了问题再改成显式绑定，那时这个函数就是唯一要换的地方。

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface FrameLike extends Rect {
  id: string
  collapsed?: boolean
  parentId?: string | null
}

/** 清单的中心点落在哪个 Frame 里。
 *
 *  **判中心点不判整体包含**：清单可能比 Frame 宽、或者压着边界，
 *  要求完全包住的话稍微拖出去一点就失联了，太脆。中心点在谁那儿就算谁的。
 *
 *  **子 Frame 优先**：子 Frame 在父 Frame 内部，按面积从小到大取第一个命中的 ——
 *  否则放在子 Frame 里的清单会被判给父 Frame，而用户看到的明明是子的。
 *
 *  折叠的 Frame 不参与：它在画布上只剩一条标题栏，那时候「落在里面」没有意义。 */
export function todoFrameOf(todo: Rect, frames: readonly FrameLike[]): string | undefined {
  const cx = todo.x + todo.w / 2
  const cy = todo.y + todo.h / 2
  const hit = frames.filter(
    (f) => !f.collapsed && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h
  )
  if (!hit.length) return undefined
  // 面积最小的那个 = 最内层的那个
  hit.sort((a, b) => a.w * a.h - b.w * b.h)
  return hit[0].id
}

/** 属于这个 Frame 的清单（含它的子 Frame 里那些）。
 *
 *  为什么带上子 Frame：一个项目 Frame 里可能开着好几个文件夹子 Frame，
 *  用户在子 Frame 里记的待办，站在项目角度问「这个项目有什么待办」时理应算数。 */
export function todosOfFrame<T extends Rect>(
  frameId: string,
  todos: readonly T[],
  frames: readonly FrameLike[]
): T[] {
  const descendants = new Set<string>([frameId])
  // Frame 层级目前只有两层（项目 → 文件夹），但按通用写法处理，多层也不会漏
  let grew = true
  while (grew) {
    grew = false
    for (const f of frames) {
      if (f.parentId && descendants.has(f.parentId) && !descendants.has(f.id)) {
        descendants.add(f.id)
        grew = true
      }
    }
  }
  return todos.filter((t) => {
    const owner = todoFrameOf(t, frames)
    return !!owner && descendants.has(owner)
  })
}
