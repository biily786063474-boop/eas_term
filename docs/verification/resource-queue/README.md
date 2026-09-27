# 资源排队期限排查 · 2026-09-26

用户原始问题：资源紧张进入排队后不应短时间自动失败；等待的意义是资源恢复时有序执行。

源码基线 da985454，独立分支 fix/low-memory-adaptive-20260926；不合并、不发版、不改正式实例。

## 排查结果
| 路径 | 等待/执行时钟 | 处理 |
|---|---|---|
| scheduler → manager → startup/task | 原默认60秒等待后reject；启动前没有进程可杀 | 默认无期限，显式有限期限仍支持；队列容量128/并发/公平性不变 |
| AI Claude/Codex、PTY | 等待在startManagedSession；主对话IPC立即回启动中，实际spawn在准入回调 | 不加外层等待截止；保留主动取消/所属窗口销毁，不自动重发 |
| OMP | openAsync准入后才open/handshake，RPC自己的超时在call开始后 | 保留实际握手/执行超时；opening期间不被idle reaper当空闲回收 |
| AI idle reaper | alive+静默达到既有阈值后回收，之前未区分资源等待 | runtimeStartupId/ACP opening跳过；实际运行/空闲回收规则不改 |
| LSP | 等准入后client.start，再发initialize/request及各自超时 | 保留握手/查询超时；共享窗口引用归零取消仍有效 |
| ASR模型/文件转录 | 模型准入后open/ready；解码start后pending.begin(timeoutMs) | 等待不计入20秒解码；交互语音绕过队列的既有路径不改 |
| 符号图/wiki扫描 | runOneShotWorker的createWorker在start里 | 排队不创建线程，无外层总等待计时器；取消归属和exit计账不改 |
| 软件更新下载 | runManagedTask的start内建立下载请求/网络计时 | 继续保留网络超时/取消；等待不发请求 |
| CLI自动更新 | managedStage到runAppTask后才stage网络/解包/校验 | 补owner AbortSignal穿透排队：关闭更新立刻取消待办；已运行仍等真实completed释放账本 |
| 插件面板/shim tools/call | 当前toolActivity使用immediate，不进入资源队列；requestTracked在actual start之后 | 不删除10分钟工具执行和shim通信超时；没有让排队假装运行的改动 |
| runManagedMcp | requestTracked仅在manager准入run内创建 | 新测试验证等待24小时后才启动执行计时，执行超时不提前释放占用 |
| preload / renderer | runtime/上述IPC Promise无独立排队总时限；设置每3秒刷新仅用于显示 | 沿用排队时长、原因、取消；不新增渲染层常驻轮询 |

## 行为边界
默认排队可以一直等，但不是磁盘持久任务：应用退出、用户主动取消、所属会话失效按既有生命周期清理。不会自动重试已经执行/结果未知的任务。显式waitTimeoutMs仅给确实需要截止的内部调用方；当前生产manager调用没有传有限期限，兼容测试仍覆盖到期先拒绝后放行。

## 回归
- scheduler跨24h：交互+后台均等待，资源恢复每项只执行一次、保持项目轮转；取消/dispose后无晚启动。
- appTaskCancellation：已取消信号不入队；CLI managedStage真实接线在等待阶段取消；运行取消不提前释放真实完成占用。
- queuedReaper：真实函数抽取，pending启动/ACP opening保护，其他符合条件的会话仍回收。
- managedMcp：实际执行超时从准入后开始，超时后仍保留资源到completed。
- 定向33项通过；全量 `npm run check`：3795通过、19跳过、0失败（类型检查与静态门禁通过）。

## 环境问题（不掩饰）
恢复临时工作树后借用旧主目录node_modules导致SDK缺失/typecheck失败，已改独立npm ci。npm ci的electron-rebuild CLI在Node26触发yargs require/ESM异常；改用同包rebuild API完成node-pty重建。Electron包已有正确37.10.3 binary但path.txt缺失，前两次隔离UI启动失败；按安装器平台路径恢复仅该依赖的path.txt后重试。未改包版本、源码依赖或正式应用。

脚本 `scripts/verify-resource-queue.mjs` 仅临时注入资源门与两个无副作用任务；真实调度器、真实IPC、真实GUI鼠标点击和真实70秒墙钟等待。它不是内存压力或LLM真实请求测试。finally恢复源码并重建，无测试门进入发布代码。

环境复查补充：不仅path.txt，Electron dist中的Framework也未完整解压（第三次启动dyld报 Library not loaded）。停止继续修补单文件，改用本机缓存的同版官方Electron ZIP完整解压到隔离node_modules；直接运行37.10.3 --version成功后重新执行UI验收。这是恢复的开发依赖问题，不改产品安全逻辑。

## 最终验收
- 隔离 Electron 真实界面：70.4秒仍有2项queued且starts均为0；鼠标取消B后释放测试门，A恰好启动1次、B为0。result.json及两张PNG为本次证据，已亲眼检查；没有发LLM请求。
- 测试源码已逐字恢复，重新生产构建通过，`git diff -- src/main/runtime/ipc.ts`为空。
- 独立最终代码审查无Critical/Important。两项Minor已补：运行取消采用真实enforcement预算断言（取消后CPU/内存预留仍为1/1，completed后归零）；验收脚本SIGINT/SIGTERM触发finally恢复及重建，落盘原文备份供不可捕获退出恢复。
- 已在真实排队开始后发送SIGTERM验收：脚本预期AbortError非零退出，但源码逐字一致、生产重建成功、备份删除。SIGKILL/断电无法运行finally，若有ipc-source-backup.local会阻止再次验收；先检查并恢复原文后重建，禁止带fixture提交/发布。
- 仍未验证：物理16GB设备、真实登录Claude请求与并行模型压力。本批验证的是排队生命周期，不是这些场景的性能结论。

## 合并前复审 · 2026-09-26
审查整个f34bd0b8..c14f389c（5提交），发现1项Important：ACP interrupt返回false时，ready/空opening的UI补偿turn.done没有interrupted标记，会误通知成功。已以主进程内部uiOnlyRepair参数显式区分补偿；dead/ready不消费保留用量FIFO，opening仍按原规则中断清理其队列。dead/ready/opening真实函数抽取回归：修前ready/opening失败，修后通过，并验证后续真实用量归属不串轮次。

测试补强曾直接从main测试import renderer collector，触发TS6307（跨tsconfig项目范围）；已移除跨域import，主进程测试断言真实输出标记与UsageBook，renderer既有islandResults回归独立验证通知行为，不放宽tsconfig边界。

最终复验：`npm run check` 3797通过/19跳过/0失败；低内存恢复UI专项9检查通过（事件回放、不发真实模型请求），还原preload后build通过。资源队列70秒真实UI复验通过，runtime/ipc.ts无fixture残留。截图与JSON刷新为本轮证据。用户已授权合入main，不发版；主线f34bd0b8为本批祖先，无源码冲突。
