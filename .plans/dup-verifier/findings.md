# dup-verifier · 对 css-dup-auditor 1-5 号结论的交叉验证

审查对象：`.plans/css-dup-auditor/findings.md` 的 P1-1、P1-2、P2-3、P2-4、P2-5。
方法：① 逐条打开源文件核行号与声明内容 ② 独立判定层叠胜负（特异度 + 加载顺序）
③ 用**打包产物** `out/renderer/assets/index-DUq0jRaF.css` 实证跨文件加载顺序。
只读，未改任何代码。

## 前置：CSS 是怎么被引入的（这决定跨文件结论的成败）

- 全部 CSS 都是 ESM `import './x.css'`（共 34 条，见下），没有 `<link>`，没有 CSS Modules，
  没有 `@layer`，没有 `@import`。特异度相同时**由打包/注入顺序决定胜负**。
- `main.tsx:2` `import { App }` 在 `main.tsx:7` `import './styles/base.css'` 之前
  → App 整棵依赖树（含所有 feature CSS 与 `glow.css`）先求值，**`base.css` 最后**。
- 打包产物实证（我自己用括号栈解析器扫的，不是照抄）：
  `index-DUq0jRaF.css` 全长 378,640 字节，`base.css` 段起点在 **365,992**
  （`/* ========== 设计令牌 / 主题 / reset / 标题栏 ========== */`），
  glow.css 的按钮组规则在 **362,311**，确实在前。
  → **原结论「base.css 是最后注入的」成立**，这是本轮唯一影响跨文件判定的结构性事实。

（尚未展开：`WikiView-*.css` / `DictView-*.css` / `island-*.css` 是独立 chunk，
运行时注入时机与主包不同。本轮 5 条都不涉及这三个文件，未做进一步验证。）

---

（结论逐条填充中，见下）
