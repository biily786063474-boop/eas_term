# B1–B4 修复复核（2026-09-11）

工作树：`.worktrees/voice-regression`。不提交、不发版；生产版未操作；未读写生产密钥。保留原验收报告和测试组。

## 根因与实现
- B1：在用户留下的 PID 77931 开发窗口通过原生 DevTools 只读控制台看到 `Uncaught (in promise) TypeError: Failed to fetch dynamically imported module`，URL 为 `out/renderer/assets/index-D5zBNlgU.js`，并有 `ERR_FILE_NOT_FOUND`；磁盘已无此 hash。旧窗口引用构建前模块，CodeView 在 await language.load 后才建 EditorView，失败即空白。改成同步建正文、独立 Compartment 异步加载高亮，失败保留纯文本，卸载守卫防迟到写入。没有清空文档或绕过文件写保护。
- B2：原 secretRequest 没有超时，只有 mcpBridge 外层 10 分钟返回错误，renderer.pending 和 popup 永久残留。按同项目 batchRequest 的生命周期做 9 分钟内部超时，清空/通知/拒绝并给出重试文案。超时不是用户拒绝，不计连续取消。旧回调保留身份守卫。
- B3：原刷新保护只看 dirty，漏 clean editing。新增每节点 gate，同步保护 editing/dirty，退出且无草稿后合并一次刷新；灯箱 dirty API 语义不改。
- B4：图片正则排除空格。改为识别完整目的路径，剥离明确标题/尖括号，路径解析前还原实体，URL 输出重新转义；不改安全路径白名单。

## 自动测试
- secretRequest 3 项；artifactRefresh 2 项；CodeView 真实 TSX + mock React/CodeMirror 生命周期 2 项；markdown 实际解析/媒体编码 2 项。均先观察失败再修复通过。CodeView 测试是组件 effect 单测，不冒充 DOM/e2e。
- `npm run check`：2903 tests，2890 pass，13 skip，0 fail；含 typecheck 和项目结构检查。日志 `/tmp/eas-bugs-check.log`。Node 的既有 MODULE_TYPELESS_PACKAGE_JSON 警告仍在。
- `npm run build` 成功；日志 `/tmp/eas-bugs-build.log`。

## 实际开发窗口观察
- 同一个隔离 userData `eas-verify-Tn07Pu`、PID 77931，通过应用快捷键刷新 renderer 加载新构建，无重启生产版。
- B1/B3：最大化原 `cnode-7-vrbuc`，点击编辑出现完整原文；干净编辑时 MCP 重提同路径返回 reused:true，仍保留焦点/编辑态；输入 `B3-VERIFY` 后重提仍保留草稿。撤销测试文字、完成返回排版，文档原内容不变。
- B4：原会话“关了”后的第 3 项收尾回复，原本 raw Markdown 的带 `vibe coding` 路径图片已显示彩色色块图。没有重复验收用户已经验过的图片 popup。
- B2：真实 9 分钟超时闭环正在观察，完成后追加结果。六位码未输入、未新增授权。

## 仍需分开验收
原安全待验：首次建柜说明、已有未授权组只授权不重填、实际节点关闭后旧 token 失效。它们不因为本轮缺陷测试通过就自动标为通过。

测试过程异常（保留）：首个真实超时探针误用 Node fetch，约 5 分钟报 `UND_ERR_HEADERS_TIMEOUT`，未取得原 HTTP 响应。产品 `mcp/eas-mcp.mjs` 已使用 node:http，不是产品 shim 回退。探针已改同样 node:http；没有重复触发原请求，继续等它的 UI 生命周期结束。

B2 真实窗口闭环已复核：等待原计时到期后，CUA 看到解锁窗/画布遮罩自动消失；MCP 调用记录显示“等待密钥柜操作超时（9 分钟），本次弹窗已关闭，未授予新的权限。用户准备好后可重新请求。”随后用修正后的 node:http 探针调用同一个 secret_check，立即重新弹出解锁窗（不再被 pending 拒绝）；点取消后响应返回用户取消，弹窗/遮罩清除。全程未输六位码、未新增密钥或授权。原超时 HTTP 响应因测试 fetch 5 分钟断线没有保留，真实应用日志/弹窗生命周期和后续请求已核验。

最后回到原故障节点 `cnode-10-4d3ii` 最大化，点击编辑，实际截图确认原文和行号/高亮全部显示。开发窗口留在这里供用户直接检查；没有新增测试文字。
