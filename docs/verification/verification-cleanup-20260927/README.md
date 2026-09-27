# Windows 内置能力验收清理竞态

基线 main `6b5ccb0a`；隔离树 `/tmp/eas-term-verification-cleanup-20260927`，分支 `fix/verification-cleanup-20260927`。只改验收脚本及其 helper/tests，不改产品、沙箱策略或发布 tag，不提交推送。

## 起因

父会话报告 Windows CI `36309927150` 与 `36311598447`：6 个业务 UI/IPC 断言已通过，随后删除 `Network/Trust Tokens` 报 `EBUSY`。原 finally 等 `exit` 而非 `close`，TERM 超时送 KILL 后不再等，并立即同步递归删除目录；退出不等于后代 stdio/Chromium 文件句柄释出。

## 最小修复

- spawn 后立即保存 close promise，防早期 close 丢失。
- 只向该 ChildProcess 发 TERM；最多等 2 秒，仍运行才发 KILL，随后再等 close 最多 5 秒。close 未确认不开始删除。
- 删除仅对 EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE 做有限线性退避：初次 + 最多 6 次重试，延迟 200–1200ms；其他错误立即失败。仍失败保留剩余 profile 并报告路径与原始 cause。递归删除可能已删部分文件，**不声称保留完整快照**。
- finally 分别收集 socket、清理、诊断文件错误，统一 AggregateError；主验收错误始终第一。诊断写失败不能跳过清理或覆盖原错误。最终 passed 日志在 finally 成功后才输出；settings-cleanup.json 明示结果。

## 验证

- `red.txt`：执行原 verifier 真实 finally，exit 后 close 前目录已被删除，预期失败。
- `green.txt`：上述回归通过。
- `review-red.txt`：独立审查的三重失败回归，原错误被 ENOSPC 覆盖，预期失败。
- `review-green.txt`：审查修复后 8/8。
- `targeted-final.txt`：最终 9/9；含原 finally 集成、早期 close、KILL 后等待、close 超时、临时/永久删目录失败、错误聚合、真实 Node 父进程退出但后代继承 stdio 仍存活的受控测试。
- `check.txt`：完整 check exit0，3841 pass、19 skip、0 fail（3860 tests）。脚本测试不在 npm test 的 src glob 内，因此另显式执行上述9项。
- `build.txt`：build exit0，有既存 warning。
- `check-final.txt`：审查修复后的全量复验 exit0，3841 pass、19 skip、0 fail；git diff --check 通过。

## 本地 GUI 失败与平台限制（不粉饰）

按安全约束仅执行临时副本：保留原 sandbox-exec 文件访问策略，**去掉 Chromium 的 `--no-sandbox` 参数**，没有执行原宽松脚本，也没有修改产品/正式脚本沙箱策略。该更严格的双重沙箱组合在 macOS 报 `sandbox initialization failed: Operation not permitted`，GPU/Network 子进程崩溃，最后 `CDP timeout: Runtime.evaluate`，GUI **失败**（`gui-run.txt` 与 `gui/settings-app.txt`）。没有绕过沙箱再试；临时执行副本已删除。

这次真实失败收尾仍通过新 helper：`gui/settings-cleanup.json` 为 `cleaned:true`，无本轮进程残留。GUI 未产生成功截图，不冒充真实业务验收。Windows 的真实 EBUSY 路径仍需新版发布 CI 验证，macOS 的9项受控测试不能代替 Windows 结果。Computer Use 外部残留不属于此次修复。
