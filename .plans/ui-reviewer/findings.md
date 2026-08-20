# ui-reviewer 结论（写作中，未定稿）

> 审查范围：`7d6a8c2`（扩展能力面板渐进式披露）+ `4168e27`（`--on-accent`）。只读不改。

## 已确认的问题（初稿，按严重度）

### 1. [高] `.fp-act` 在整个仓库里没有任何 CSS 定义 —— MCP「安装」按钮会渲染成系统原生灰按钮
- **判据**：类名在 TSX 用了，全仓库无对应样式规则；且 `base.css` 没有全局 `button` reset
  （`base.css:88` 的 `*` 只重置了 margin/padding/box-sizing）。没有作者样式的 `<button>`
  在 Chromium 里就是 `buttonface` 浅灰底 + 黑字 + 系统默认边框。
- **证据**：`src/renderer/src/features/workspace/FootprintPanel.tsx:187` 用了 `className="fp-act"`；
  `grep -rn "fp-act" src/` 只有这一处命中，`workspace.css` 的 `.fp-*` 整段（1172–1372）没有 `.fp-act`。
- **表现**：只有在「MCP 接入未安装」这一个状态下才看得见 —— 装着的时候走的是 `.fp-mini`（已移除按钮），
  所以日常几乎撞不上，正好是刚做完 opt-out 功能后才会频繁出现的那个状态。
- **边界**：这条**不是这一轮两个 commit 引入的**，`git log -S "fp-act"` 指向上一个提交
  `d113185`（MCP 移除功能）。但它就长在我这轮审的那个头部行里，且和 opt-out 强相关。
  另：**未真机验证**，我没跑起来看渲染结果，判断依据是「无规则 + 无 reset」。

### 2. [高] 键盘操作被父级 `onKeyDown` 吃掉：Enter/Space 在行内五颗按钮上都触发不了，反而去展开/收起卡片
- **判据**：`stopPropagation` 只加在五颗按钮的 **onClick** 上；父级 `.fp-row-h` 的 **onKeyDown**
  没有 `e.target !== e.currentTarget` 的守卫。焦点在内层 `<button>` 时按 Enter，
  keydown 冒泡到父 div → 命中 `e.key === 'Enter'` → `e.preventDefault()` + `toggle()`。
  而 `<button>` 的 Enter 激活正是 keydown 的默认行为，`preventDefault()` 把 click 直接掐掉了。
  Space 同理（Chromium 里 keydown 上 preventDefault 会取消后续 click）。
- **证据**：`FootprintPanel.tsx:157-162`（父级 onKeyDown，无 target 守卫）
  vs `:174 / :189 / :201 / :214 / :230`（五处 `e.stopPropagation()`，都只在 onClick）。
- **后果**：纯键盘用户**完全无法**安装/卸载指引、装/移除 MCP、开关 hook、打开知识库目录 ——
  按 Enter 得到的是卡片展开。鼠标用户不受影响。
- **边界**：未在真机上按键实测，这是按 React 合成事件冒泡 + HTML 激活行为推出来的。
  要坐实需要一次真实键盘操作。

（更多条目待补：ARIA、accent 底色逐条核对、CSS 重复定义扫描）

### 3. [高] `--on-accent` 漏改了 5 处：`var(--accent-fg, #fff)` —— 这个变量**全仓库没有定义**，实际生效的就是 `#fff`
- **判据**：commit `4168e27` 的说明写着「扫描脚本复查：实心/高不透明度 accent 底配白字的规则，
  现在一处都没有」。**这条不成立。** 漏网的写法不是字面量 `#fff`，是 `var(--accent-fg, #fff)` ——
  grep `#fff` 抓不到它。而 `--accent-fg` 在整个 `src/` 里**只有读、没有一处定义**
  （`grep -rn -- "--accent-fg" src/` 全是使用点），所以 fallback `#fff` 必然生效。
- **证据**（背景都是实心 `var(--accent)`）：
  - `src/renderer/src/features/design/composer/designer/styles.css:76` `.uc__mode-seg-btn.is-active`
  - `…/designer/styles.css:121` `.uc__topbar-btn--primary`
  - `…/designer/styles.css:156` `.uc__guide-chip--on`
  - `…/designer/styles.css:650` `.uc__pr-seg-btn--on`
  - `…/designer/styles.css:908` `.uc-export__btn`（导出主按钮）
  - 另有两处 JSX 内联同写法：`…/composer/ErrorBoundary.jsx:74`、`…/animate/AnimateView.jsx:1407`
- **不是「composer 有自己的主题所以不算」**：`…/animate/styles.css:12-14` 的注释白纸黑字写着
  「base.css 已有 `--accent` … 派生色改用 `color-mix(var(--accent))` 以贴合 Eas-Term 当前主题」，
  且全仓库 `--accent:` 只在 `base.css:18/48` 定义过。composer 吃的就是那个浅色 accent，
  对比度和别处一样是 ~2:1。
- **附带**：`…/animate/styles.css:119` / `:126` 的 `.ua__btn--accent` 写的是 `color: var(--accent-fg)`
  **没有 fallback** → 变量未定义时整条 `color` 声明在计算值阶段作废 → 变成继承父级颜色。
  背景是 `linear-gradient(--accent-dark → --accent)`，最终是什么字色取决于祖先，等于没定。
- **边界**：我按静态解析判定，没在真机上取渲染色值。若 composer 视图在运行时另外注入过
  `--accent-fg`（比如 JS 设 inline style），结论会变 —— 我 grep 过 `src/` 没找到，
  但没查 `node_modules` 里可能被打包进来的第三方样式。

### 4. [中] `--on-accent` 只吃掉了两个近黑字面量中较少的那一个：`#0d0f16` 还有 19 条实心 accent 规则没归拢
- **判据**：仓库里同一个意图（浅 accent 实心底上的近黑字）存在**两个**字面量。
  这一轮把 `#0b0d12`（7 处）抽成了 `--on-accent`，但 `#0d0f16` 一个没动。
  数出来是 **`color: #0d0f16` + 实心 accent 底 19 条 vs `var(--on-accent)` 12 条**
  —— 也就是说，下一个人照抄现有 CTA 时，**更可能抄到硬编码那条**。
  而这个 commit 的立论正是「散着写死、没有名字，于是后加的 CTA 抄不到它」。抽象只做了三分之一。
- **证据**（`.plans/ui-reviewer/accent_scan.py` 的输出，19 条节选）：
  `canvas.css:1263 .ctool.on` / `canvas.css:3166 .re-primary` / `canvas.css:3478 .wk-primary` /
  `canvas.css:4139 .rm-primary` / `dict.css:397 .dhb-primary` / `wiki.css:349 .ap-primary` /
  `gantt.css:53`、`:760` / `git.css:269 .git-ref.head` / `image.css:45` /
  `workspace.css:76 .project-item.active`、`:233 .tab.active`、`:579 .view-seg button.on`、`:1067 .onb-btn` /
  `base.css:251`、`:266 .glass-menu-item`。全仓库 `#0d0f16` 共 26 处命中。
- **不是视觉 bug**：`#0d0f16` 与 `#0b0d12` 对比度都是 ~9.6:1，肉眼分不出。这条是**可维护性**问题，
  不是「改错了」。我按 WCAG 公式复算过 commit 里的两个数字：白字 1.99:1、`#0b0d12` 9.68:1，
  **和它写的 2:1 / 9.5:1 一致，这部分我同意**。
- **边界**：我没去核对这 19 条里是否有哪条背景其实不是纯 accent（比如叠了 opacity 的祖先）。

### 5. [同意，非问题] 淡底保持白字的判断是对的
- 扫描确认：`--accent-soft`(0.16)、`rgba(--accent-rgb, 0.04–0.16)` 这一档共 40+ 条，
  没有任何一条被误改成 `var(--on-accent)`（脚本里专门标了 `淡底-却用了on-accent`，0 命中）。
- `base.css:528-531` `.err-btn.primary`（`#7c8cff` 底 + `#0b0d12`）故意不动 —— 我算了一下
  近黑在 `#7c8cff` 上是 6.25:1、白字 3.0:1，留黑字是对的，且它确实不该被主题色牵连。**同意不改。**
