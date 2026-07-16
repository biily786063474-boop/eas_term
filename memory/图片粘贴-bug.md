# 终端 ⌘V 粘图失效 —— 根因与修复（防再次踩坑）

> 2026-07-09。用户："之前 ⌘V 粘图到 Claude Code 对话是好的，突然坏了。"

## 根因（git 定位 + pty 实测双证）
- 罪魁 = 提交 **`ed4e471`「fix: 终端 ⌘V 粘贴两次」** 里加的 **`e.preventDefault()`**。
- 机制：Claude Code 的图片粘贴，靠的是收到一个**空的 bracketed paste `\e[200~\e[201~`**当"发生粘贴"的信号 → 它据此去读**系统剪贴板**里的图片。
- 修复前：⌘V 只 `return false` 不 preventDefault → 菜单 paste role 仍触发一次**原生粘贴** → xterm 把内容(图片时无文本→空)发出，即那个空 bracketed paste → Claude Code 读到图。文本时则多发一次 = "双击" bug。
- `ed4e471` 为修双击加了 `preventDefault` → 挡掉原生粘贴 → 那个空信号没了；而自定义 `pasteToTerm` 又只 `if(text)` 才粘 → 图片(无文本)时啥都不发 → **粘图失效**。

## 修复（TerminalView.tsx `pasteToTerm`）
```ts
if (text) { termRef.current?.paste(text); return }
// 无文本但有图：仍发一次 paste（bracketed 模式即空 \e[200~\e[201~）触发 Claude Code 读图
if (await window.api.clipboard.hasImage()) termRef.current?.paste('')
```
- 新增 `clipboard:hasImage`（main `fs.ts`：`!clipboard.readImage().isEmpty()`）+ preload `clipboard.hasImage`。
- **pty 实测确认**：剪贴板有图时，向 claude 发 `\x1b[200~\x1b[201~`，其输入框出现 `❯ [Image#1]` = 成功读图。

## 防再次出现（重点）
- `pasteToTerm` 里那段发空 paste 的分支加了 **⚠️ 别删注释**：改 ⌘V / 粘贴逻辑时务必保留。
- 教训：**"文本粘贴"和"图片粘贴"共用同一条粘贴信号路径**。任何动 ⌘V / preventDefault / paste 的改动，都要同时验证：①文本不双击 ②图片能粘(Claude Code 出 `[Image#1]`)。两者要一起测，别只测文本。
