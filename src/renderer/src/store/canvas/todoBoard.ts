// 待办清单模块的纯逻辑：分组（待办 / 已完成）、拖拽排序换算、坏档 sanitize。
//
// 单独一个文件是为了能测——不引 React / electron / store，`node --test` 直接加载
// （同 tidyOrder.ts 的理由：排序/分组算错了不会崩、不会报错，只会表现成
// 「勾选后没进已完成区」「拖拽后顺序不对」这种要盯着看才发现的错）。
//
// 依赖方向是单向的：persist.ts 从这里取 sanitizeTodoBoard，canvasSlice.ts 从这里取
// 分组 / 排序 / 坏档函数——本文件不反过来 import persist.ts（避免循环依赖）。

import type { TodoBoard, TodoItem } from './types'

/** 新建待办清单模块的默认尺寸（世界坐标单位）。宽度是唯一真正用于渲染的值——
 *  高度随内容自增（见 CanvasTodoBoard.tsx 不设固定高度），h 只是落盘 schema 里
 *  占位的合法默认值，为将来要支持手动调高预留字段位置。 */
export const TODO_BOARD_DEFAULT_W = 280
export const TODO_BOARD_DEFAULT_H = 200

const finiteOr = (v: unknown, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : dflt

// ---------- 分组：待办 / 已完成 ----------

/**
 * 按完成状态分组。待办保持 `items` 数组里的原有相对顺序——拖拽排序改的就是这个数组里
 * 的相对位置，不需要额外的 order 字段；已完成按 doneAt 倒序，「已完成区里新的排前面」
 * 是产品原话。
 */
export function groupTodoItems(
  items: readonly TodoItem[]
): { pending: TodoItem[]; done: TodoItem[] } {
  const pending = items.filter((it) => !it.done)
  const done = items.filter((it) => it.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
  return { pending, done }
}

// ---------- 拖拽排序 ----------

/** 通用数组搬移：把下标 from 的元素挪到下标 to（其余保持相对顺序）。越界下标会被夹到合法范围内。 */
export function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
  if (!arr.length) return arr.slice()
  const f = Math.max(0, Math.min(from, arr.length - 1))
  const t = Math.max(0, Math.min(to, arr.length - 1))
  const next = arr.slice()
  const [item] = next.splice(f, 1)
  next.splice(t, 0, item)
  return next
}

/**
 * 把待办项 id 挪到「未完成子序列」里的第 toIndex 位，已完成项在原数组里的相对位置不受影响。
 *
 * 做法：先只在「未完成」这个子序列上做搬移，再照原数组「这一格原来是不是未完成项」这个
 * 骨架把结果填回去——已完成项占的格子原样保留自己，未完成的格子依次领走搬移后的结果。
 * 这样已完成项和未完成项在数组里的相对穿插关系不会被打乱，拖拽只改变「未完成」这一个
 * 子集内部的先后（已完成区的显示顺序本就只认 doneAt，不看数组位置，不受影响）。
 */
export function moveTodoItem(items: readonly TodoItem[], id: string, toIndex: number): TodoItem[] {
  const pending = items.filter((it) => !it.done)
  const from = pending.findIndex((it) => it.id === id)
  if (from === -1) return items.slice()
  const reordered = arrayMove(pending, from, toIndex)
  let cursor = 0
  return items.map((it) => (it.done ? it : reordered[cursor++]))
}

/** 拖拽中把「鼠标垂直位移量」换算成「该落在未完成子序列的第几位」。
 *  rowStep<=0 或没有可排序的项时原地不动，不产生 NaN/Infinity。 */
export function dropIndexForOffset(
  pendingLength: number,
  fromIndex: number,
  dy: number,
  rowStep: number
): number {
  if (!(rowStep > 0) || pendingLength <= 0) return fromIndex
  const shifted = fromIndex + Math.round(dy / rowStep)
  return Math.max(0, Math.min(pendingLength - 1, shifted))
}

// ---------- 完成 / 取消完成 ----------

/** 打勾 → done=true 且盖章 doneAt=now；取消勾选 → done=false 且清掉 doneAt
 *  （不删它在数组里的位置，取消勾选回到待办区时大致还在原来那一带，不会跳到随机地方）。
 *  没命中 id 的项原样返回同一个引用，方便上层做浅比较/避免多余渲染。 */
export function toggleTodoItemDone(items: readonly TodoItem[], id: string, now: number): TodoItem[] {
  return items.map((it) => {
    if (it.id !== id) return it
    const done = !it.done
    return { ...it, done, doneAt: done ? now : undefined }
  })
}

// ---------- 坏档防御 ----------
// 磁盘 canvas.json 可能「能 parse 但成员畸形」——道理和 persist.ts 顶部注释一样。
// 逐项规范化：坏 item/board 丢弃而非让整份存档跟着崩掉。

export function sanitizeTodoItem(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object') return null
  const it = raw as Record<string, unknown>
  if (typeof it.id !== 'string') return null
  const done = it.done === true
  return {
    id: it.id,
    title: typeof it.title === 'string' ? it.title : '',
    body: typeof it.body === 'string' ? it.body : undefined,
    done,
    // doneAt 只在真正完成时才有意义；done 已经是 false 的项即便存档里留着脏 doneAt 也清掉，
    // 否则会出现「未完成但带完成时间」的畸形数据，日后任何按 doneAt 排序的逻辑都可能踩到。
    doneAt: done && typeof it.doneAt === 'number' && Number.isFinite(it.doneAt) ? it.doneAt : undefined
  }
}

export function sanitizeTodoBoard(raw: unknown): TodoBoard | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (typeof b.id !== 'string') return null
  const items = Array.isArray(b.items)
    ? b.items.map(sanitizeTodoItem).filter((it): it is TodoItem => it !== null)
    : []
  return {
    id: b.id,
    x: finiteOr(b.x, 0),
    y: finiteOr(b.y, 0),
    w: finiteOr(b.w, TODO_BOARD_DEFAULT_W),
    h: finiteOr(b.h, TODO_BOARD_DEFAULT_H),
    title: typeof b.title === 'string' ? b.title : undefined,
    items
  }
}
