# 画布平移优化第一阶段 · 2026-09-21
用户确认优先优化事件合并和内容隔离。
- 独立工作区 /tmp/eas-canvas-pan-20260921，perf/canvas-pan-20260921，基于main471456f；未提交/合并/发布，勿删除工作区。
- CanvasStage beginPan 按RAF最新位置合并，松手/失焦/卸载flush并清帧；PaneView对TerminalView和AgentChatView默认memo，内部状态更新仍保留。不改进程/安全/裁剪余量。
- 类型、前后build通过；全量3282通过19跳过0失败（含最初3测试），随后补2测试定向5/5通过。
- 实机未完成：隔离Electron监听CDP端口但HTTP/WebSocket均无响应；CUA读取同一路径Electron也timeoutReached。已关闭本次2个测试应用和脚本，不影响其他进程。不能宣称性能提升或卡顿已解决。
- scripts/verify-canvas-pan.mjs保留12闲置对话、480移动事件、位置和实例保持验收，已给发现阶段加超时。下一步恢复本机应用控制后跑before/after，观察截图/进程次数/帧耗时；当前仅鼠标拖拽合并，滚轮/缩放保持原语义，直接DOM移动/分批预热未实施。
- 计划和证据在该worktree docs/superpowers/plans/2026-09-21-canvas-pan.md 与 docs/verification/canvas-pan/README.md。

## 继续验收结果
调试连接间歇恢复，12闲置对话场景前后对照通过：480移动事件产生的实际视口变化479→60（约减少87.5%），最终坐标一致、面板身份保持、AI启动0。两版p95约9.4ms，无明显帧率提升，不宣称重负载卡顿解决。扩展测试松手/失焦/视图切换通过（after-lifecycle.json）；失焦脚本最初400ms短于既有500ms防抖，改为650ms后通过，未改生产逻辑。全量最终3284通过19跳过0失败。新增纯测5/5。实机截图已读；未验证运行中模型/终端与重媒体。代码仍在独立worktree，未提交合并发布。

## 长历史及活动对话续验
12模块各20段Markdown历史A/B通过，479→60次坐标更新，p95 10.5→10.6ms，没有证明帧率提升；保留实例和位置。真实Codex+本地模型夹具的两轮回复/普通resume/停止回归通过，证明memo后内部状态不冻结（不是在线模型或边输出边拖动压测）。截图已查看。第一阶段按边界可收尾；没有再叠生产补丁，未提交/合并/发布。证据在独立worktree docs/verification/canvas-pan/。

## 24模块压力样本（2026-09-21）
24模块各40段历史，明确appRoot的最终A/B都通过：视口更新479→60；ScriptDuration504.11→95.23ms，样式279.16→116.73ms，布局7.28→7.57ms（未改善）；p95帧间隔19.5→16.3ms，>50ms长帧1→0。短样本，不保证通用比例。实例/位置/失焦/松手/切换均通过，无AI启动，截图已读。中途CDP超时/Promise collected/基线一次失焦坐标失败记录保留，未叠生产补丁或放宽断言。证据stress-before.json与stress-after.json；新增脚本参数EAS_VERIFY_APP_ROOT/EAS_PAN_NODES/EAS_PAN_TURNS和CPU采样。当前可提交第一阶段，仍未提交合并发布。

## 2026-09-21 画布平移第一阶段本地集成完成
用户明确授权审查、提交并合入本地 main。最终只读审查无阻断项；仅本次改动提交 6500b85，已在 /tmp/eas-timeline-integrate 快进合入本地 main。合并前后 npm run check 均 3284 通过、19 跳过、0 失败；合并后日志 /tmp/pan-postmerge-check.log。未推送、未发布、未替换安装版。其他 agent 修改未纳入。压力样本及实机验证见 main 的 docs/verification/canvas-pan/；持续终端输出与平移并行、重媒体、真实用户画布、Windows 未验证。隔离工作树保留。

## 第二轮扩展验收未完成
用户同意先补边输出边平移/重媒体，不直接增加生产补丁。在 /tmp/eas-canvas-pan-20260921 修改 verify-canvas-pan.mjs，未提交。真实PTY后台输出一次通过（streaming-trace-2，494字节与平移重叠，60更新，位置/生命周期通过），但截图终端在视口外，不算可见终端压力验收；前一次坐标生命周期失败根因仍未确认。已调整夹具终端位置，后续CDP连接失败。12张3840×2160既有截图缩放夹具已准备，大图片面板初始化或CDP连接失败，未通过；视频未执行。详细记录见该worktree docs/verification/canvas-pan/README.md。没有生产代码变动，没有新提交/合并/发布。没有后台验收仍在运行。

## 坐标异常定向调查
coordinates-3全链路trace通过，未发现松手后拖拽回调残留；主动注入滚轮coordinates-wheel确实使原稳定性断言失败，61次wheel对应61次onWheel写入。原始失败未记事件/堆栈，不能认定其根因就是滚轮；生产代码不改。完整trace及调查在隔离worktree docs/verification/canvas-pan/README.md。脚本加入诊断与EAS_PAN_INTERFERE可控干扰，未提交。基线尝试结果见coordinates-wheel-baseline-failure.json，不算已通过。

## 21:42 有限复测
3次bounded-coordinate均在连接前阻断（1socket、2HTTP超时），不计功能失败/通过。Node自环3/3与最小Electron CDP3/3通过；完整应用空profile首次CDP成功随后两次超时，问题不需压力夹具即可出现。主进程sample存隔离worktree docs/verification/canvas-pan/cdp-app-sample.txt，尚无明确源码阻塞点。仅关闭自己的诊断应用13859；未改生产代码。

## 21:45 调试超时原生阻塞点
已读sample关键行86-97：863采样全在SecKeychainAddGenericPassword→AuthorizationCopyRights→同步XPC等待，明确卡在macOS钥匙串授权，不是平移计算。具体JS入口未确认（secrets.status的safeStorage.isEncryptionAvailable为候选，亦需排除Chromium初始化）。临时方法名/栈诊断入口被hook Bad substitution语法错误阻断未执行；安全机制没有修改。详见隔离worktree README。

## 21:54 恢复原任务
测试保留系统HOME，仅ZDOTDIR/CLI目录/profile隔离，可见终端+平移system-home-stream通过（494字节、60更新、坐标/生命周期全部通过），截图无钥匙串提示。大图片12张4K加载，平移身份/坐标/松手失焦通过；整套image-identity-final在split/canvas图片身份retained断言失败，CanvasStage本来按viewMode挂卸（App446），需补正确恢复断言而非修生产逻辑。视频未验收。只有脚本/证据变更未提交。

## 21:59 图片恢复/视频夹具
images-restored通过12图切换恢复（src集合+加载尺寸）；video-pan通过1080p静态画面H264夹具播放时钟与合成平移并行（+0.538秒、paused=false、60更新、p95 9.5ms），截图已看。不是动态高码率压力，也没覆盖原生pointerdown外部点击暂停策略；切视图视频卸载/回0既有行为不改。仅验收脚本证据未提交。原始偶发坐标仍未定因，Windows/真实画布未验证。

## 22:02 扩展验收收尾
video-pause-policy通过合成节点外pointerdown暂停策略及视频实例保持，未覆盖原生设备输入。脚本修正failedExpression采集；最终全量check 3284通过19跳过0失败（/tmp/pan-extended-final-check.log）。生产代码未动，本轮脚本/证据未提交，可按用户授权后单独审查提交。原始坐标偶发未定因，动态高码率多视频/Windows/真实用户画布未覆盖；不继续无证据叠性能补丁。

## 本轮验收已提交
用户“OK继续”承接审查提交建议，独立审查修正夹具数量与视频计时两漏洞，三模式重新实机脚本通过，最终复核无阻断。提交ffe7022，仅scripts/verify-canvas-pan.mjs与docs/verification/canvas-pan证据，位于perf/canvas-pan-20260921。未合并本轮到main、未推送发布；生产6500b85早已在本地main。原偶发坐标仍未定因，平台边界不变。

## 22:08 本轮验收合入main
用户明确授权合并后检查。/tmp/eas-timeline-integrate本地main由6500b85快进到ffe7022，合并前后工作区干净。合并后npm run check通过：3284通过、19跳过、0失败，日志/tmp/pan-evidence-postmerge-check.log。未推送、未发版。原始偶发坐标未定因边界保留。

## 23:13 主工作区定向整合完成
用户选择只整合6500b85/ffe7022。基于主工作区bdeb08d在/tmp/eas-pan-root-integrate定向cherry-pick为3c00849/feb549c，仅两架构文档冲突，保留主分支并追加本次段落。主目录feat/global-timeline-20260918已快进到feb549c。两份未提交架构文档三方合并恢复，其余22个tracked未提交文件hash完全保持；备份路径记录/tmp/pan-root-preserve-location。没有整合整个main。
隔离整合检查2879pass14skip1fail（capabilityPtyLauncher.test.mjs native CLI not ready），专项复跑12/12通过；主工作区完整check2887pass13skip0fail，日志/tmp/pan-primary-workspace-check.log。两个基线测试数量不同，不能沿用main3284数字。未push、未发版、未在新主工作区构建打开GUI，原有6500b85实机证据仍有其原基线范围。

## 2026-09-22 05:31 正式版长时间平移卡顿现场诊断
- 用户报告开越久平移越卡。正式0.4.103主PID75222/renderer75314，运行近3小时；asar确认frameLatest优化已在安装版，不能再归因没发布。
- 用户05:20:10–23平移，flicker.log有17条101–201ms长任务，共2293ms。此前25秒OS采样没覆盖该操作，不冒充全程CPU。
- CUA打开正式版DevTools原生Performance，真实鼠标4次往返录制。console脚本粘贴被安全警告阻止，没有绕过；误入聊天框的未发送短诊断文字已清空，未发送。没有执行注入脚本。
- live最长RunTask221.7ms含Commit197ms；另106.9ms为Profiler启动自身开销，应排除。主线程PrePaint854.6ms/Layerize895.4ms，布局本身6.1ms。
- DevTools模拟prefers-reduced-motion:reduce后4次短拖，16.64秒RunTask1376.8ms；恢复不模拟后相同路线4次短拖，20.00秒RunTask4225.8ms。约83ms/s vs211ms/s，绘制负担有明显相关变化，但工具开销/其他对话输出/非严格恒时输入仍存在，不能声称产品帧率提升60%。第一份live与后两份之间用户缩放119%→87%，不能直接用第一份算A/B。
- reduce/restored PrePaint176.2/713.5ms、Layerize176.0/674.0ms；FunctionCall284.9/362.9ms。归一化后更支持动画/合成持续负担，不支持单纯拖拽JS过重。
- trace计数约89k DOM nodes、13k listeners（含浏览器保留节点，非可见DOM），短样本不构成泄漏证据。内存约1GB短时稳定，不可宣称泄漏或已找全长期退化原因。
- 所有原始trace本地压缩保存docs/diagnostics/canvas-pan-20260922/{live,reduced,restored}.json.gz（含真实画面/路径，私有诊断，不上传git）。结束已恢复不模拟reduced-motion，关闭DevTools；未重启、未杀进程、未改正式代码或对话数据。
- 下一步：基于安装版对应release/0.4.103独立工作树，先证明离屏动画暂停/可见保持的回归，再做大画布、长会话、重复来回平移持续压测。不要仅全局删除视觉效果，不卸载活动会话，不扩大结论。

## 2026-09-22 05:40 离屏漏洞修复接续位置
修复与证据位于/tmp/eas-offscreen-decor-20260922（fix/offscreen-decor-20260922，基于release/0.4.103 eda14a4），未提交/合并/发布。正式版已有离屏observer，观察整个Frame会误把离屏按钮判为可见；新实现观察按钮行。真实旧版红测、新版进出屏240循环通过、DOM身份保持，typecheck/build+3308项测试（3289pass19skip）通过。详见该worktree docs/verification/offscreen-decor/与memory。纠正：先前idleWatchdog枚举动画没区分playState，不能单凭那份日志说12个仍在运行；本轮是computedStyle和几何的独立复现。长期3小时退化仍未全覆盖，不再重复堆observer。
