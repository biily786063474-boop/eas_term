# 无账号内存与持续运行验收（2026-09-26 → 09-27）

## 基线与范围
- 固定主线提交 `53f2334ad478b09c9ee4bd687c1e2c97ded9d995`，工作树 `/private/tmp/eas-first-claude-audit`，分支 `test/memory-soak-20260926`。
- macOS / arm64 / 实体 48 GiB。独立 userData，未复制凭证或用户历史，没有模型消息，没有整机内存填充，没有强制 GC。
- 本轮新增验收脚本与记录；生产源码不修改。未提交、未合并、未发版。
- 持续采样 17 分 37 秒、200 样本（约每 6 秒调用已有按需聚合 IPC）。不是过夜稳定性测试；脚本采样不进入正式软件常驻轮询。

## 实际执行
1. runtime 全组：181 项，178 通过、3 条件跳过、0 失败。覆盖 8/16/32GB normal/warning/critical 模拟、无效/过期样本、等待与执行时钟、取消预算、进程树读取失败等。跳过项：真实 clangd、真实 ASR 模型、实际 VAD worker；未将跳过计为通过。
2. `verify-resource-queue.mjs`：真实 Electron / IPC / 调度器，受控准入门，超过 70 秒两任务仍排队，鼠标取消 B，恢复资源后 A 恰好启动 1 次、B 从不启动。临时 ipc 源码逐字还原并重新构建。
3. 三个空闲 AI Frame，逐个最大化/恢复；不启动推理会话。
4. 10 轮真实 PNG、2 万三角面 GLB、纯本地 HTML、内置 execution-plan 插件同时打开，保持约 30 秒，经真实 removeNode 关闭后采样约 30 秒。场景由 EAS_VERIFY store 创建，不冒充逐个菜单鼠标点击；图像解码、model-viewer.loaded、HTML 正文与插件 iframe 实际加载通过。首轮/末轮截图已亲眼核对。
5. 最后一轮关闭后再观察 300 秒。其前约 40 秒同时完成原生最小化/恢复验证，时间点见 window-result.json，后续约 260 秒为正常窗口空闲观察。
6. Electron 不支持 CDP Browser.getWindowForTarget（原始错误保留在 result.json）；改用 System Events AX，仅对属于本次启动器的准确 Electron PID 和 Eas-Term 窗口验证 AXMinimized true→false。不是产品失败。初次人工探测取到 node wrapper PID 导致 -1719；最终脚本沿父子关系精确识别 Electron，原生测试通过。

## 结果
| 指标 | 测量值 |
|---|---:|
| 初始 60 秒稳定空闲末值 | 551.4 MiB |
| 整轮采样峰值（同时采样 RSS） | 1045.6 MiB |
| 首轮关闭末值 | 639.8 MiB |
| 第十轮关闭末值 | 644.8 MiB |
| 十轮关闭后的范围 | 639.8–649.2 MiB |
| 最终 5 分钟观察末值 | 646.8 MiB |
| 最终相对初始稳定空闲差值 | +95.4 MiB |
| 每轮关闭后的进程 / 页面调试目标数 | 4 / 1 |

十轮关闭末值只差约 5 MiB，主渲染 JS 堆在约 10–15 MiB 间回落，未看到本轮持续明显累积；但最终没有恢复到初始冷态。首次加载驻留、Chromium/GPU 缓存与泄漏不能仅凭这些 RSS 数据区分，不宣称没有泄漏，也未实现或证明 20% 降幅。RSS 可能重复计算共享物理页；不等于私有内存/PSS。最终空 Frame 与完全空画布的冷基线也不完全相同。

## 发现与待查
- 主进程日志出现 2 条 Chromium ERROR：`Message 7 rejected by interface blink.mojom.WidgetHost`、`Message 2 rejected by interface blink.mojom.Widget`。发生在媒体关闭附近，后续轮次、加载和回收断言仍通过，无应用崩溃；不能因此把日志当无害，根因尚未定位。脱敏摘录见 chromium-errors.txt。
- 优先后续：拆开图片 / 3D / HTML / 插件做相同冷启动与预热对照，定位额外约 95 MiB 的来源，再决定是否优化；不要凭单次差值叠补丁。
- 仍未验：实体 16GB、真实 Claude 首发、并行推理、其他业务插件、Windows/Linux、正式安装包、数小时或过夜稳定性。

## 清理与复验
本次启动器正常退出；采集到的 7 个所属进程均已退出，最后无媒体 webview/插件 iframe DOM。只清理本次创建的 PNG/GLB/HTML 夹具，不关闭正式软件或其他 CLI。模型依赖走现有固定版本/哈希校验下载路径，不绕过安全规则。

- `node --test --test-concurrency=4 'src/main/runtime/*.test.ts'`
- `node scripts/verify-resource-queue.mjs`（先单独跑；会临时注入并恢复源码）
- `npm run build` 后 `node scripts/verify-memory-soak.mjs`
- 同轮 `node scripts/verify-memory-window.mjs`，等待 final-idle 后操作唯一所属窗口。
- `node scripts/report-memory-soak.mjs [项目内HTML目标路径]` 生成自包含进度页；有界轮询，测试结束退出。

最终全量 `npm run check`：3829 项，3810 通过、19 跳过、0 失败。构建由排队 verifier 恢复后完成。测试截图/结果、内存评估及最终 HTML 均放本目录。报告 preset 原文件本机缺失，沿用已有诊断报告的样式，不另造主题。`.local*` 日志/运行锁/内部 PID 表仅本机保留，不纳入交付。
