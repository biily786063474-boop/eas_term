# 代码审查（2d884c2..HEAD）修复 · 隔离验收（2026-09-14 02:30–03:30 PDT）

`/code-review high` 十个角度对 8 个提交的审查，证实的问题与修法：

| 严重度 | 问题 | 修法 | 验证 |
|---|---|---|---|
| 发版拦截 | 资源采样只在 Darwin 25 arm64 标"已校准"，其他平台闸门永久关死 → 终端/AI/插件全部排队 60s 后失败 | 未校准平台闸门**失效而非关死**（`manager.setEnforcement(false)`，空租约放行，UI 显示"仅监测"） | controller/manager 单测；本机无法模拟其他平台 |
| 发版拦截 | 终端、AI、插件、录音这类用户亲手发起的启动被塞进重任务闸门：节能模式内存 61% 起就开不了终端 | 调度器新增交互通道：`interactive:true` 不受 80/50 阈值与 maxRunning 限制，只在严重压力（critical）下等；五处启动标记 | 隔离实例：节能模式、内存 71%，`pty.create` 5ms 返回、无排队 |
| 高 | 空闲终端/会话终身占着 CPU 预留，8 核机器第 6 个终端永远被拒 | 服务启动完成 `ledger.settleCpu`，只留内存预留 | manager 单测 |
| 高 | `git:describe` / `git:commitFiles` 把 hash 原样给 git，`--output=` 可覆盖任意文件 | `gitHash.isCommitHash` 校验三处 | 隔离实例：`--output=/tmp/x` 被拒、文件未落 |
| 高 | 主窗口无导航守卫：拖链接进来即把工作台导航到远程页并拿到 window.api | `navigationGuard.isAppNavigation`：非应用内 URL 阻止并交系统浏览器；`window.open` 一律 deny | 隔离实例：`location.href=file:///etc/passwd` 被拦；`window.open` 返回 null，窗口数不变 |
| 高 | 归档：追问消息没带序号，每次保存复制一份；旧档读失败时用窗口覆盖全量 | 追问赋号 + 无序号消息按邻居中点定序去重；读失败拒绝保存 | shared/main 单测（含权限 000 与半截 JSON） |
| 中 | S4 只守 8 个文件，其余 ~170 处裸 `ipcMain` | 守卫改为默认：src/main 除 ipcGuard.ts 外 45 文件 166 处全换；结构守卫断言全局零裸用 | 隔离实例：密钥柜、终端创建/写入/回显正常 |
| 中 | `wiki:addToInbox(move=true)` 可搬走任意文件 | 只接受 `wiki:pickFiles` 返回过的或 guardPath 允许的 | 隔离实例：`/etc/hosts` 被拒 |
| 中 | webview 加固漏 `nodeIntegrationInWorker`/`webviewTag`/`experimentalFeatures`/`sandbox` | 补齐 | 单测 |
| 中 | 运行中心关闭 AI 会话后渲染层 busy 卡死（selfKilled 跳过 turn.done） | exit 判据只看"退出时还 busy"；归约器 fatal 直接收整轮（三支一起） | processHandoff / reduce 单测 |
| 中 | 插件崩溃后 acquire 绕过准入重起；MCP 起不来不通知宿主摘表 | 准入后 acquire 的 create 只抛错；error 分支调 onExit | pluginHostAdmission / mcpClientLifecycle 单测 |
| 中 | 终端从运行中心关闭只 SIGHUP shell，子进程成孤儿 | stop 闭包走 `killTree` | 代码级；未真机（需原生确认框） |
| 低 | 启动失败 catch 清零 retries；代码地图 `../` id 逃出项目根；rootGate 归一化与符号链接不一致；采样每秒三次 fork 其一是常量；投影里每条重算调度器快照；面板 key 含 ageMs 每 3s 重挂 | 各自修复 | 单测 / 代码级 |
| 清理 | 未接线的 `serviceRegistry.ts` 及其测试 | 删除 | — |

未做（记入后续）：`wait timeout` 文案翻译五处重复、窗口生命周期监听三处重复、原子写两处重复 → 抽共用；`workerRequests` 挂死的 worker 永不回收；终端创建失败（严重压力下）渲染层无提示（需要 toast 基础设施）；`saveArchive` 每秒整份重写与 `historyListCache` 无上限（现在归档不裁剪了）；`adoptOrphan` 要求 resumeId（按已确认约束，不改）。
