# CSS 重复选择器审查 · 结论

审查范围：`src/renderer/src/` 下全部 23 个 `.css` 文件（约 17,800 行），解析出 2,717 条选择器记录。
共发现 **68 组「同上下文下同一选择器被定义多次」**（57 组同文件内、11 组跨文件）。
其中 **5 条判定为危险或需要修**，其余为无害的有意分层。

判据（按任务约定）：
- 两份定义是否改动同一批属性 → 有重叠才可能互相覆盖
- 后一份是否改动了 `position / display / visibility / opacity / transform / flex-*` 等布局属性
- **额外加了一条判据**：后一份若是「整块重写」，前一份**没被重新声明的属性会残留生效** ——
  `.ac-input-send` 那次事故正是这个形态，只看「重叠属性」会漏掉它

只读审查，未改任何代码。附录（全部 68 组明细）在同目录 `full-list.txt`。

---

## P1 · 危险：意外覆盖，已确认有实际后果

### 1. `.ac-bar-send:disabled` 的 `opacity: 0.4` 残留生效，直接推翻同文件写明的设计意图

`src/renderer/src/features/agentChat/agentChat.css:901`（被 `:1410` 那份"重写"但漏掉了 opacity）

- `:899-902` 定义 `{ cursor: default; opacity: 0.4 }`
- `:1410-1415` 重新定义同一选择器 `{ background; color; cursor; transform }` —— **没有声明 `opacity`**
- 两者同特异度（0,2,0），后者只覆盖了 `cursor`，**`opacity: 0.4` 原样保留**
- 而 `:1372-1374` 的注释白纸黑字写着：「禁用时**不整个变透明**（那样看着像坏了），只降饱和」
- 实际结果：聊天态发送键禁用时仍然整体 40% 透明，注释描述的效果没生效

一句话：设计意图被 500 行外的旧定义悄悄推翻，注释和实际渲染对不上。

### 2. `.ac-bar-send` 整块被重写，`:882-902` 已是完全失效的死代码（也是上一条的根源）

`src/renderer/src/features/agentChat/agentChat.css:882` 与 `:1392`

- 这是**全库唯一一处**后定义改动了布局属性**值**的重复：`display: inline-flex`(:885) → `display: flex`(:1396)
- 逐条比对：`:882` 块的 12 个属性中 11 个被 `:1392` 覆盖，剩下的 `flex-shrink: 0`(:893) 也被 `flex: none`(:1393) 等价包含 → 整块无一处生效
- `:896` 的 `border-color` 同样失效（`:1397` 的 `border: none` 让 border-color 不可见）
- `:899` 的 `opacity: 0.4` 是唯一"逃逸"出来的，就是 P1-1
- 形态与本轮踩过的 `.ac-input-send` 事故完全一致：**同一个键先后写了两遍，前一份留在原地**

改法：删掉 `:882-902` 整段（含 `:hover:not(:disabled)`、`:disabled` 两个附属块），P1-1 一并消失。
删前确认 `ChatToolbar.tsx:414` 是 `.ac-bar-send` 的唯一使用点（已确认）。

---

## P2 · 需要修：覆盖成立，后果较轻或依赖加载顺序

### 3. `.re-tools` 的 `flex-wrap: wrap` 残留在一个 `flex-direction: column` 的容器上

`src/renderer/src/features/canvas/canvas.css:3115` 与 `:3194`

- `:3115` = `{ display: flex; flex-wrap: wrap; gap: 5px }`
- `:3194` = `{ display: flex; flex-direction: column; gap: 7px; padding; border; border-radius; background }`
- `flex-wrap: wrap` 没被重新声明 → 残留。与 `column` 组合后，换行方向变成**跨轴（分列）**
- 当前不炸的唯一原因是这个容器没有确定高度，column+wrap 不会真触发分列；
  哪天给祖先加了 `height` / `max-height`，工具 chip 会毫无征兆地裂成两列
- `CanvasRoleEditor.tsx:308` 只有一处使用，且结构（`.re-tools-row` 子元素）对应的是 `:3194` 那份
  → `:3115-3119` 是遗留死块

改法：删 `:3115-3119`；若担心行为变化，至少在 `:3194` 块里显式补 `flex-wrap: nowrap`。

### 4. `.crm-row` 的淡化色被 `color: inherit` 打掉

`src/renderer/src/features/canvas/canvas.css:2739`（组）与 `:2789`

- `:2738-2745` 给 `.crm-title, .crm-row, .crm-mini` 设 `color: color-mix(in srgb, var(--fg-dim) 62%, transparent)`，
  注释解释了为什么必须淡"字"而不是淡"面板"
- `:2789` 的 `.crm-row`（一个 `<button>`，见 `RunMonitor.tsx:90`）里写了 `color: inherit` 做按钮重置，同特异度且在后 → 赢
- 结果：`.crm-row` 继承 `.crm` 的 `var(--fg-dim)`，比设计值**更实**，62% 淡化只在 `.crm-title` / `.crm-mini` 上生效
- hover 不受影响（`.crm:hover .crm-row` 特异度更高）

改法：把 `:2789` 的 `color: inherit` 改成 `color: color-mix(...)`，或直接删掉这行（父级颜色本就会继承下来）。

### 5. `.primary-btn` 的过渡被 `base.css` 抢走 —— 因为 `base.css` 是最后加载的

`src/renderer/src/ui/motion/glow.css:185`（组）与 `src/renderer/src/styles/base.css:328`

- `glow.css:181-192` 特意把五个 CTA 的 transition **列全**，注释写明「只写 box-shadow/transform 会把人家原来的过渡覆盖没」
- 但 `main.tsx:2` 的 `import { App }` 排在 `main.tsx:7` 的 `import './styles/base.css'` 前面，
  ESM 按源码顺序求值 → **base.css 的样式表最后注入**
- 打包产物实证（`out/renderer/assets/index-DUq0jRaF.css`）：glow.css 段位于字节 358687–366093，
  base.css 的 `.primary-btn { … transition: background 0.15s }` 位于 **373017**，在后
- 同为单类选择器 → base.css 赢。`glow.css:245`（hover `translateY(-0.5px)` + box-shadow）
  和 `:259`（active `translateY(1px)`）**不再有过渡，是瞬跳**
- 同组的 `.sec-primary` / `.ab-launch` / `.upd-go` / `.wk-primary` 都正常
  （workspace.css@42717、canvas.css@265964 等都在 glow.css 之前）
  —— 五个按钮里只有 `.primary-btn` 是坏的，这个不对称本身就说明是意外而非设计

改法（任选）：把 `main.tsx` 的 `import './styles/base.css'` 提到 `import { App }` 之前（最省事，但会改变全局层叠，需回归）；
或把 `base.css:328` 的 `transition` 删掉、统一交给 glow.css 管；或给 glow.css 那组加 `:not(:disabled)` 提特异度（与它自己已有的做法一致）。

---

## P3 · 无害但该合并（复发温床）

这些当前**没有**冲突（属性互补或有意分层），但形态上就是「同一个选择器散落两处」，
下一次有人往其中一块加属性时，就是 P1 那类事故的起点。

| 选择器 | 位置 | 说明 |
|---|---|---|
| `.wk-shell.open` | `canvas.css:3385` 与 `:3388` | **紧邻的两块**，一块设 `pointer-events`、一块设 `transform`。没有任何理由不合并，纯补丁叠加痕迹 |
| `.agentbar` | `canvas.css:2193` 与 `:4334` | 有意覆盖（`border-bottom` 移交给 `.agentbar-stack`），`:4329` 有注释说明。建议在 `:2193` 处回指一句 |
| `.tp-foot` | `team.css:90` 与 `:277` | 一块管盒模型、一块管 flex 布局，隔了 187 行 |
| `.project-item` | `workspace.css:62` 与 `:111` | 后者只补 `position: relative` |
| `.flb-head` | `canvas.css:5094` 与 `:5157` | 后者只补 `position/z-index`（注释写了"双保险"） |
| `.board-collabel` | `board.css:69` 与 `:418` | 后者只补 `cursor: default`，隔 349 行 |
| `.skill-remind` | `workspace.css:869`（组）与 `:889` | 组内基础 + 单独补宽度 |
| `.ac-quota` | `agentChat.css:1234` 与 `:1257` | 后者只补 `gap: 5px` |
| `.diff-view-host` | `git.css:395` 与 `:410` | 后者是 user-select 组 |
| `.ua__tl-bar` | `animate/styles.css:600` 与 `:721` | 后者把 `cursor: pointer` 改成 `grab`，有注释，有意 |

其余 ~40 组属于**惯用且安全**的形态，不建议动：
`.a, .b { 基础 }` + `.b { 特化 }`（如 `.cd-collapse`/`.cd-add`、`.re-ghost`/`.re-primary`、
`.dhb-*`、`.tbm-*`、`.ap-*`、`.skill-ghost`/`.skill-primary`、`.wikiv-lint-ok`、`.crm-mini`），
以及 `.terminal-host` / `.code-view` 那种"末尾统一放开 user-select"的收尾块。

---

## 两条结构性观察（不算 finding，但值得知道）

1. **`base.css` 是最后注入的样式表**，不是最先。`main.tsx` 里 `import { App }` 在 `import './styles/base.css'` 之前，
   ESM 按源码顺序求值，App 的整棵依赖树（含所有 feature CSS 和 glow.css）都在 base.css 之前。
   直觉上"base 打底、feature 覆盖"在这个项目里是**反的** —— P2-5 就是这么来的。
   任何"在 base.css 里写兜底样式"的想法都要先想到这一点。
2. **`animate/styles.css:17` 往全局 `:root` 注入了 19 个变量**（`--space-*`、`--font-*`、
   `--accent-dark`、`--z-modal` 等）。目前与 `base.css:2` 的 `:root` 无同名冲突，
   但设计合成器的私有 token 泄漏到全局命名空间，将来 base.css 若定义同名变量，
   **base.css 会赢**（同上，它最后加载），而症状会出现在设计合成器里 —— 很难查。
   建议改挂在 `.ua-root` 之类的作用域类上。

---

## 跨文件重复的说明

11 组跨文件同名选择器中，**10 组是 `glow.css` 有意作用在别的文件定义的按钮上**
（`.ab-launch` / `.sec-primary` / `.primary-btn` / `.upd-go` / `.wk-primary` / `.term-input-send` 及其 `:disabled`）。
`glow.css` 文件头和行内注释都写明了这个设计，并且**作者已经知道"同为单类选择器时后加载的赢"这个坑**
（`glow.css:198-201` 记着一次实测事故）。除 P2-5 的 `.primary-btn` 外其余都成立。
剩下 1 组是两个 `:root`（见上）。

`@keyframes` 步进关键字（`0%` / `from` / `to`）在跨文件比对中会大量误报 —— 它们分属不同动画名，
已按 at-rule 上下文剔除。**未发现同名 `@keyframes` 重复定义。**
