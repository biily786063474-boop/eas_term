// 把一段文字拆成可以逐个做入场动画的片段。**纯函数** ——
// 「空格没了」「emoji 被切成两半」这类问题不看代码根本查不出来，必须能单测。
//
// ── 三条硬要求 ──────────────────────────────────────────────────
// ① **按码点拆，不按 UTF-16 码元。** `'👍'.length === 2`，用 split('') 会把它
//    切成两个孤立的代理项，渲染出来是两个「�」。`[...text]` 按码点迭代，
//    中文、emoji、组合字都不会被切坏。
// ② **空格要留住。** 拆完每个字符各占一个 span，普通空格在行内会被折叠掉，
//    于是「你 好」变成「你好」。空格片段要用不换行空格渲染。
// ③ **换行要留住。** 拆成 span 之后 `\n` 在 HTML 里什么都不是，
//    整段会挤成一行。单独标出来，由渲染层换成 <br>。

export interface Piece {
  /** 要显示的字符。空格已换成不换行空格 */
  ch: string
  /** 这是个换行 —— 渲染层该给个 <br> 而不是 span */
  br?: boolean
}

/**
 * 拆成片段。返回的顺序就是渲染顺序，索引即动画的递增 delay 序号。
 *
 * **换行不占动画序号**：它不是一个「浮现出来的字」，
 * 给它排一个 delay 只会让后面所有字白等一拍。
 */
export function splitForAnimation(text: string): Piece[] {
  const out: Piece[] = []
  for (const ch of text) {
    if (ch === '\n') out.push({ ch: '\n', br: true })
    // 普通空格换成不换行空格：每个字符各占一个 span 之后，
    // 行内的普通空格会被折叠掉，「你 好」就变成了「你好」
    else if (ch === ' ') out.push({ ch: ' ' })
    else out.push({ ch })
  }
  return out
}

/** 会被排进动画序号的片段有几个（换行不算）。给调用方算总时长用。 */
export function animatedCount(pieces: Piece[]): number {
  return pieces.reduce((n, p) => n + (p.br ? 0 : 1), 0)
}
