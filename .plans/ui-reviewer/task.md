# 审查目标：扩展能力面板渐进式披露 + CTA 文字色统一（刚改的）

## 读这些
- `src/renderer/src/features/workspace/FootprintPanel.tsx`
- `src/renderer/src/features/workspace/workspace.css` 里 `.fp-*` 整段
- `src/renderer/src/styles/base.css` 里 `--on-accent` 的定义

## 要判断的四件事
1. **冒泡**：头部整行可点展开，行内有五个操作按钮靠 `stopPropagation` 各管各的。
   五个都覆盖到了吗？还有别的会冒泡的交互吗（键盘、焦点、tooltip/`data-tip`）？
2. **无障碍**：`role="button"` + `tabIndex` 的用法对不对，`aria-expanded` 该不该加，
   展开区和触发器的关联（`aria-controls`）缺不缺。
3. **`--on-accent` 的应用范围对不对。** 用 grep 找出所有 accent 背景的规则，
   逐条判断该黑字还是白字（**实心底黑字、淡底白字**），看有没有改错或漏改的。
   注意 `--accent-soft`(0.16) 和 `rgba(accent,0.28)` 属于淡底。
4. **CSS 有没有新引入的重复定义**（这个仓库刚因为重复定义修过 5 处 bug，
   参考 `.plans/css-dup-auditor/parse_css.py`，可以直接拿来跑）。

## 产出
`.plans/ui-reviewer/findings.md`，按严重程度排序，每条给文件:行号。
**不同意就明确写出来**，不要附和。只读不改代码。
