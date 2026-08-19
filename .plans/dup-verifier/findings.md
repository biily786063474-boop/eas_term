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

> **接手说明**：dup-verifier 写到这里 turn 结束了（面板显示 idle、`busy=false`），
> 而跨进程没有追加指令的通道（`team_send` 还没做），进程随后在打包时被收掉。
> 以下逐条结论由主 agent 接着它的前置分析完成，方法一致：开源文件核行号 → 判层叠 → 下结论。
> 它那节「CSS 是怎么被引入的」是本轮所有跨文件判定的基础，原样保留。

---

## 逐条结论

### P1-1 · `opacity: 0.4` 残留生效 —— **成立，但原结论引错了证据，也低估了后果**

**判据 / 证据**（`agentChat.css`）：

- 第一份 `.ac-bar-send:disabled`（`:899-902`）= `{ cursor: default; opacity: 0.4 }`
- 第二份（`:1414-1419`）= `{ background; color; cursor; transform }` —— **确实没有 `opacity`**
- 同特异度 `(0,2,0)`，后者在后 → 后者赢，但只赢它声明过的属性。`opacity: 0.4` 残留 ✅

**两处修正：**

**① 它引的注释不是这个选择器的。** 原结论写「`:1372-1374` 的注释白纸黑字写着：
禁用时不整个变透明（那样看着像坏了），只降饱和」。实际 `:1372` 是
**`.ac-input-send:disabled`**（空态那颗发送键），不是 `.ac-bar-send`；原文也没有
「不整个变透明」「只降饱和」这些字，而是：

> 空框时仍然要看得见 —— 原来用 `rgba(255,255,255,.1)`，在暗底上几乎消失，
> 真机截图里那颗按钮整个不见了。照参考 UI：空框时是一颗淡的强调色圆。

**② 因此后果比原结论说的严重。** 第二份 `:disabled` 把背景设成
`rgba(var(--accent-rgb), 0.28)`，残留的 `opacity: 0.4` 再乘一次 →
**实际不透明度约 0.11**。那正是上面那段注释描述的事故形态（「几乎消失」「整个不见了」），
只不过当时发生在另一颗按钮上。所以这不是「看着像坏了」，是**聊天态禁用的发送键几乎看不见**，
和 `.ac-input-send` 修过的那个 bug 是同一个。

### P1-2 · `:882-902` 整块死代码 —— **完全成立**

逐条核对第一份 12 个属性，全部被第二份覆盖：

| 第一份 | 第二份 | |
|---|---|---|
| `width/height: 28px` | 同 | 覆盖 |
| `display: inline-flex` | `display: flex` | **值变了**，覆盖 |
| `align-items` / `justify-content: center` | 同 | 覆盖 |
| `border-radius: 999px` | `50%` | 覆盖 |
| `border: 1px solid rgba(...)` | `border: none` | 覆盖 |
| `background: var(--accent-soft)` | `rgba(accent,.9)` | 覆盖 |
| `color: var(--fg)` | `#fff` | 覆盖 |
| `cursor: pointer` | 同 | 覆盖 |
| `flex-shrink: 0` | `flex: none` | 等价包含 |
| `transition: border-color, opacity` | `background, transform` | 覆盖 |

附属块：`:hover:not(:disabled)` 的 `border-color` 未被重新声明 → 残留，
但主块 `border: none` 让它不可见（原结论说对了）。`:disabled` 的 `opacity` 逃逸 = P1-1。

改法给的行号（删 `:882-902`，含两个附属块）与实际一致；`ChatToolbar.tsx:414` 确为唯一使用点 ✅

### P2-3 · `.re-tools` 的 `flex-wrap: wrap` 残留 —— **成立**

`:3115` `{ display:flex; flex-wrap:wrap; gap:5px }`，`:3194` 重新定义为
`{ display:flex; flex-direction:column; gap:7px; … }`，**未声明 `flex-wrap`** → 残留 ✅
「当前不炸是因为容器没有确定高度」这个判断也对：`column` + `wrap` 只有在主轴（此时是纵向）
受限时才分列。

### P2-4 · `.crm-row` 的淡化色被 `color: inherit` 打掉 —— **成立**

`:2739-2743` 的组选择器给 `.crm-title, .crm-row, .crm-mini` 设
`color: color-mix(in srgb, var(--fg-dim) 62%, transparent)`；
`:2789` 的 `.crm-row` 块里有 `color: inherit`。两者同为 `(0,1,0)`，后者在后 → 赢 ✅
`RunMonitor.tsx:88` 确认它是 `<button>`，那行 `color: inherit` 属于一组按钮重置
（`border:none` / `background:none` / `cursor:pointer` 同块），**是顺手带进来的，不是有意覆盖**。

### P2-5 · `.primary-btn` 的过渡被 base.css 抢走 —— **成立，而且有一条更强的佐证原结论没提**

链路核对无误：`main.tsx:2` `import { App }` 在 `:7` `import './styles/base.css'` 之前 →
base.css 最后注入（本报告开头已用打包产物字节位置实证）；
`base.css:339` `transition: background 0.15s` 覆盖 `glow.css:188-194` 那五项完整列表 →
`.primary-btn` 的 `box-shadow` / `transform` 过渡丢失，hover 抬升是瞬跳 ✅

**补充佐证**：`glow.css:195-199` 自己的注释就写着 ——

> `:not(:disabled)` 不只是为了排除禁用态，更是**为了抢过原规则的 background 简写**……
> 同为单类选择器时后加载的赢，实测玻璃这组就这么被清空了

**作者知道这个坑，并为 `background` 加了 `:not(:disabled)` 提特异度，却漏了 `transition` 那组。**
同一个文件里的这个不对称，比原结论说的「五个按钮只坏一个」更能说明是意外遗漏而非设计。
也因此，原结论给的三个改法里，**第三个（给 glow.css 那组加 `:not(:disabled)`）最稳妥** ——
它与该文件已有的做法一致，不动全局层叠顺序，不需要回归其他按钮。

---

## 总结

**5 条全部成立**，没有一条需要推翻。两处修正都在 P1-1：它引的注释属于另一个选择器，
而真实后果比它描述的更严重（按钮几乎不可见，不是「看着像坏了」）。

修复优先级建议：P1-2（删死代码，P1-1 随之消失）→ P2-5（加 `:not(:disabled)`）→
P2-4（删 `color: inherit`）→ P2-3（删 `:3115-3119`）。前两条有用户可见的视觉后果。

## 边界

- **只做了静态层叠分析，没有真机截图比对。** 「按钮几乎看不见」是按 `0.28 × 0.4 ≈ 0.11`
  推出来的，没有实际渲染取色验证。要确认视觉后果需要打开 app 看那颗按钮。
- 没有验证 P3 那 63 组「无害但该合并」的判定，任务只要求 1-5 号。
- 没有改任何代码。
- `WikiView-*.css` / `DictView-*.css` / `island-*.css` 是独立 chunk，注入时机与主包不同 ——
  本轮 5 条都不涉及，未做验证（dup-verifier 原文已标出这条，保留）。
