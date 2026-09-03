// Frame 尺寸的两条下限。**零依赖，可单测** —— 摘出来就是为了这个：
// `layout.ts` 通过 `store/shared` 拖进了半个应用（gantt collector 之类），
// 进不了 `node --test`，而这两个数字错了是用户一眼能看见的事故。

/** 有节点的 Frame 的兜底下限。「一个可用的空容器」，从一开始就是这个数。 */
export const FRAME_MIN = { w: 240, h: 120 }

/** **空 Frame 的下限**。它比 `FRAME_MIN` 大得多，因为空 Frame 不再是空的 ——
 *  里面画着那排引导（选一个 AI 开始 + 三颗 CLI 按钮 + 先开个终端）。
 *
 *  2026-09-03 用户实拍的 bug：建了 AI 对话又删掉，Frame 收缩回 240×120，
 *  而引导比这大得多 —— 内容整个溢出到虚线边框外面，看着像坏了。
 *  240×120 是引导还不存在时定的，那时候空 Frame 里确实什么都没有。
 *
 *  这两个数字对着 `FrameStart` 的实际排版量：
 *    标题 ~18 + 三颗按钮两行（92×2 + 间距）+ 「先开个终端」~22 + 上下 padding 32
 *  再加上 Frame 头部（HEAD=34）。宽度按「一行放得下两颗按钮」算。
 *
 *  ⚠️ **改 `FrameStart` 的排版时回来核一次这两个数。** 它们之间没有代码约束，
 *  只有这条注释 —— 对不上的表现就是用户看到的那个溢出。 */
export const EMPTY_FRAME_MIN = { w: 320, h: 300 }

/** 这个 Frame 的最小尺寸。空的按引导算，有内容的按老规矩。 */
export function frameMinSize(isEmpty: boolean): { w: number; h: number } {
  return isEmpty ? EMPTY_FRAME_MIN : FRAME_MIN
}
