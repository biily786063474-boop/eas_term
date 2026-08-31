// 逐字浮现的文字。拆分逻辑在 splitText.ts（纯函数、有测试），这里只管渲染。
//
// ── 无障碍：**整段文字放 aria-label，碎片全部 aria-hidden** ─────────
// 拆成一堆 span 之后，读屏软件会把它读成一个个孤立的字
// （「插」「入」「文」「档」而不是「插入文档」）。所以碎片对读屏隐藏，
// 由外层的 aria-label 提供原文。
//
// ── 为什么入场只动 transform 和 opacity ─────────────────────────
// 「上浮 / 旋转 / 模糊」里挑了前两个：它们是合成属性，不触发重绘也不触发
// 样式重算。`filter: blur()` 每一帧都要重新光栅化 —— 在一个 hover 就触发、
// 十几个字符各来一遍的动画上，那是白付的代价，而观感差别很小。
import type { CSSProperties, JSX } from 'react'

import { splitForAnimation } from './splitPieces'

export function SplitText({ text, className }: { text: string; className?: string }): JSX.Element {
  const pieces = splitForAnimation(text)
  let i = 0
  return (
    <span className={`sp-text${className ? ' ' + className : ''}`} aria-label={text}>
      {pieces.map((p, k) =>
        p.br ? (
          <br key={k} aria-hidden="true" />
        ) : (
          <span
            key={k}
            className="sp-ch"
            // 递增 delay 由 CSS 用这个序号算，不在 JS 里拼时间 ——
            // 那样改节奏要改代码，放 CSS 里改一个数就行
            style={{ '--i': i++ } as CSSProperties}
            aria-hidden="true"
          >
            {p.ch}
          </span>
        )
      )}
    </span>
  )
}
