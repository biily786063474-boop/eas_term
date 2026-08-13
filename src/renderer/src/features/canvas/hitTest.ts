// 拖放落点判定：绕开标记层。
//
// 标记（矩形/箭头/便签）现在渲染在 PaneLayer **之上**（.canvas-shape-layer，z-index 60），
// 而 .cshape 是 pointer-events:auto、矩形还带一层实底背景 —— **整个矩形盒子都参与命中测试**。
// 于是 document.elementFromPoint 在标记盖住的地方一律返回 .cshape，
// 后面那句 closest('.pane[data-leaf-id]') / closest('.cframe') 必然是 null，
// 所有拖放**静默失败**（连 hover 高亮都不会亮，因为走的是同一个落点判定）。
// 撞的还是最自然的用法：在终端上画个框圈住一块、然后往那个终端拖东西。
//
// 为什么不照 .drawing 那条 CSS（选着绘图工具时整层 pointer-events:none）的样子做：
// 那需要在每一个拖拽入口成对地开关一个状态（四处 dropModuleOnTerminal 调用方 +
// 抽屉里三条 startXxxDrag），漏掉任何一条退出路径（blur / Esc / 异常）都会让标记
// 永久点不动。这里只换掉命中测试这一件事，无状态、无时序、无需清理。

/**
 * elementFromPoint 的替身：返回该点最上面那个**不属于标记层**的元素。
 * 标记层是「贴在玻璃上的便利贴」，可以盖住终端，但不该吃掉底下东西的拖放落点。
 */
export function elementUnderPoint(x: number, y: number): Element | null {
  // elementsFromPoint 给的是自顶向下的一整摞（含祖先），标记只在最上面几层，
  // 底下的 .pane / .cframe 原样还在列表里，取第一个不在标记层里的即可
  for (const el of document.elementsFromPoint(x, y)) {
    if (!el.closest('.canvas-shape-layer')) return el
  }
  return null
}
