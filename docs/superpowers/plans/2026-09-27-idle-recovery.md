# Safe Idle Recovery Implementation Plan

> Execute sequentially with superpowers:executing-plans. No forced timer reload.

**Goal:** Background inactivity for one hour can release safely reconstructible resources without terminating work or losing content.
**Architecture:** Main owns activity/admission; renderer owns persistence preparation. Unknown state vetoes recovery. First phase is non-destructive; renderer rebuild requires a separate prepare/flush/recheck/commit transaction.

- [ ] Inventory authoritative activity sources in runtime/sessionStartup, cliDispatch, ownedSessions, sharedServices, pluginHost, PTY, voice and downloads. Document unobservable activity as veto, not idle.
- [ ] Add pure monotonic idle policy with tests for 59/60 minutes, focus, queued work, unknown, suspend/resume gaps and once-per-idle-period behavior.
- [ ] Add main activity snapshot that does not cross ownership boundaries for stop operations; no arbitrary process killing, no new outbound services.
- [ ] Identify disposable caches and current working sets. Do not blindly call webFrame.clearCache: installed Electron types explicitly warn it may make the app slower. Existing Markdown cache is a performance fix and must not be periodically wiped.
- [ ] Add a registry of explicitly safe release callbacks, with failures isolated. Measure process-tree/RSS and wake latency before claiming benefit.
- [ ] Inventory renderer unsaved state (drafts, image writes, editor buffers, design state, persistence writes). Any unregistered state blocks rebuild.
- [ ] Implement flush acknowledgements and generation-based cancellation; new work between snapshot and commit cancels recovery. Gate admission atomically for the brief commit interval.
- [ ] Reject rebuild if any PTY, unknown webview or non-persistable plugin remains. Restore UI from persisted data; retain old window until replacement is ready. No automatic credentials access or deletion.
- [ ] Add an off switch through existing settings persistence.
- [ ] Isolated real-app validation: each blocker, late-arriving task, failed persistence, reconnection, drafts/history/images, multiwindow ownership, focus return. Accelerated clock is not real-hour soak.
- [ ] Run full check/build, independent final review, and separately report Windows / online CLI / real-hour validation.

Current status: design accepted by user; implementation not started. Message/image fixes are independent work in this branch, not evidence of idle recovery.

## 2026-09-27 执行裁定
Ruling: 本次只启用非破坏性内存整理（Chromium回收不可达JS对象），不做整窗重建。因为现有reload会销毁会话，且没有全模块保存屏障。已向用户说明此范围，不把它当“刚启动完全一致”。原计划中的flush/替换窗口步骤仍未完成，不得勾成已完成。

30秒采样，连续后台闲置1小时、已知服务/任务为零且无guest/调试器才尝试；前台返回重置，睡眠采样断层重置。可关闭，错误不重试风暴，不清持久化/Markdown缓存。开发验收采用加速时钟与真实Chromium，非真实一小时驻留测量；未声称内存改善百分比。
