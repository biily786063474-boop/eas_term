# 2026-09-28 聊天图片/调整方向待验收

用户要求四项图片优化+修复调整方向。工作树 `.worktrees/chat-media-steer-20260928`，分支 `fix/chat-media-steer-20260928`，基线b1bdfa71；原根工作树脏分支不可碰。未提交/合并/发布。

代码与独立审查已完成，最终UI受临时HOME macOS钥匙串提示阻塞。已请求用户点取消，不要还原默认；不能绕过/更改用户钥匙串。测试实例已按持有子进程清理，无需全局杀Electron/CUA。

先读 `docs/verification/chat-media-steer/README.md` 再续。计划ID800b8272-fa9c-4cac-8691-4436fdd2d06b。Node PATH=/private/tmp/eas-release-tools/node-v22.23.3-darwin-arm64/bin:$PATH；node_modules指向/private/tmp/eas-release-0.4.115/node_modules。

关键保留：saveArchive传previous保护迁移失败原图；非ACP close才done；main不解码bitmap；renderer不用fetch(dataURL)以保持CSP，不自动模型生成恢复。单图2MiB/4图上限保留。

下一步先真实实启图片脚本与redirect脚本，未通过不宣布修复。真实用户数据、正式版不能做测试写入；不在当前旧根分支构建发布。

最终check：3982通过、19跳过、0失败，共4001；build成功；git diff --check通过。关键结构化证据 docs/verification/chat-media-steer/checks.json。

## 2026-09-28 用户授权提交与安全合并
在已告知UI未最终验收后，用户明确要求提交并合并，执行本轮代码整合，不发版。待验收事项不自动关闭。整合证据见 docs/verification/chat-media-steer/integration.json。
