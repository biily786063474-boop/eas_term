# OMP 调整方向误杀回归（2026-09-09）
根因：transport.interrupt 的 3 秒 cancel 超时只判断 phase==='prompting'。旧 prompt 已取消、新方向立即进入 prompting，旧 timer 就会 kill 当前进程。与用户 code=null signal=SIGTERM 一致，不是只需隐藏错误提示。

修复：cancelTimer 生命周期清理 + 原 prompt 对象身份/原 process 双重校验；响应成功/error、finally、onGone、close 清理。重复 interrupt 不重复发送或叠加 timer，真正无响应仍保留3秒 kill。

先红后绿：新增计时器单测在旧代码3项失败；真实 bundled OMP + localhost 测试模型在旧版触发 kill=1、新版 kill=0 且新方向回答完成。第二轮刻意等待4.5秒跨过旧timer；无外部模型调用、无真实账号、无用户上下文。新增 RPC error 分支单测。

Electron 实机UI `verify-agent-chat-ui.mjs --queue` 三CLI共39项通过，覆盖队列按钮/快捷键/优先调整/取消/重试，截图已看OMP原位置；该UI用模拟transport事件，真实OMP验证由上述独立测试承担。测试实例已退出。

发布前原候选9b4cd39包已废弃，不可上线；必须按修复后源码重建。Windows正式构建加入transport单测及真实OMP方向调整测试。

最终本地全套：2825项，2812通过、13跳过、0失败（test-concurrency=4）；其中真实OMP测试按默认环境跳过，已另以EAS_VERIFY_REAL_OMP显式运行通过。38项transport单测通过，typecheck通过。
