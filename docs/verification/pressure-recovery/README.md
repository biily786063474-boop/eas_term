# 压力回收后的恢复与排队验收 · 2026-09-27

## 范围与结论
- 工作树 `/private/tmp/eas-first-claude-audit`，分支 `test/memory-soak-20260926`，基线 `53f2334ad478b09c9ee4bd687c1e2c97ded9d995` **加未提交图片复位修复**，Electron 37.10.3，物理内存48GiB。
- 媒体6轮/333秒：PNG、3D GLB、离线HTML、执行清单插件关闭→模拟压力→重开→交互→关闭36秒。重开就绪171–522ms，整组交互3.17–3.39秒（含驱动等待，不是性能承诺）。
- 图片实际鼠标放大到140%、点击比例回100%、双击比例保持100%；3D鼠标拖拽相机角度变化；HTML输入与按钮计数；插件真实只读panel/list RPC。未验插件写入/登录/所有业务功能。
- 每轮关闭最终1个CDP target；5进程包含trace服务，不能拿来指认插件残留。第1/6轮截图已人工查看，图片底部100%、HTML输入和计数、3D/插件渲染正确。

## 发现并修复的旧问题
首轮pilot失败，未掩盖。冷启动排除压力后复现：比例控件pointerdown命中`.civ-zoom`，但pointerup/click被父级`.civ.zoomed`捕获，140%不能归100%。
`CanvasImageViewer.tsx`拖拽开始时排除比例控件，提示改为“点击复位”，阻止比例控件doubleClick冒泡再次放大。没有修改缩放公式、画布滚轮、资源调度或内存策略。
`imageResetInteraction.test.mjs`两项结构回归先RED(2失败)后GREEN(2通过)，并由真实GUI6轮补充验证。cold-reset诊断在完成其他3组件交互后主动停止，因此其result不是完整恢复通过，原样保留。

## 排队
真实调度器/真实GUI + 仅隔离构建临时受控准入门，0–70.645秒共8次采样均3任务等待、启动计数0。20秒moderate、40秒critical浏览器压力通知。
GUI取消B，GUI切普通模式放行：A=1、B=0、C=1，顺序A→C；追加10秒没有重复。没有调用模型或占用整机内存。
`runtime/ipc.ts`测试注入已恢复原文，git diff为空，恢复后build成功；临时备份清除。关闭实例后所属进程残留0。此门控测试不能替代真实OS采样/压力准入联动验收。

## 内存观测（MiB，不相加嵌套或共享分类）
- GPU shared_images冷基线99.299；关闭第1–6轮109.549、107.752、106.314、106.314、106.314、108.549。后5轮未单调累积，但最终仍比冷基线高9.25，**不等于零泄漏**。
- 3次critical通知后transfer_cache均约0.012MiB；moderate后仍约15.39MiB，通知不是立即/必然清空。重开后的关闭阶段可重新缓存至15.405MiB。
- UI malloc allocated_objects冷基线38.212，第1轮43.912，第6轮42.754；V8随GC波动。未强制GC，不能把暂存DOM/堆直接判定泄漏。
- trace期间关闭RSS从772.3升至900.2MiB，采集引入服务/缓冲开销，不作为生产内存基准，也不把全部增量武断归因trace。
- 导出24,789,081字节trace，4527 events；`allocation-summary.json`仅分类摘要，无分配调用栈。
- 记录4条blink Widget Message2拒绝与2条macOS task_policy_set错误；本轮未导致断言失败，仍未修复/未认定无害。

## 检查与清理
`npm run check`退出0：3831总数，3812通过、19跳过、0失败；包含两套TypeScript、hooks、颜色对比、CSS和动画检查。构建通过。媒体与队列launcher均退出、所属残留0；独立fixture清除，未杀正式版/其他会话。仅本地修改，未提交、推送、合并或发布。

## 未验证 / 下一步
真实16GB设备的OS压力、swap和长时体验；Claude登录后的真实会话；Windows；更长时间native分配栈。现有模拟证据不足以宣告全面完成低内存适配。下一步可审查并提交本轮修复和诊断记录，再把真实设备/账号场景纳入候选包验收；无依据升级Electron或加入生产强制GC。

## 证据与复跑
- `media-result.json`、`queue/result.json`、`allocation-summary.json`、`check-result.json`、PNG、RED/GREEN文本。
- `scripts/verify-pressure-recovery.mjs --cycles 6 --tag media`（先build）；`scripts/verify-pressure-queue.mjs`（禁止与build/编辑runtime ipc并发）；`scripts/analyze-pressure-recovery.py`；`scripts/report-pressure-recovery.mjs --once`。
- `.local*`日志/trace留本机且gitignored；HTML纯内联、可离线打开。图片中的AI错误文案是PNG测试素材内容，不是本轮模型调用。

## 2026-09-27 合并前脚本安全加固
独立审查最初阻断：固定CDP端口不能证明本次进程归属、报告隐式跨树输出、A/B中断链不完整、清理失败未阻止继续采样。均已修正并静态复审无剩余阻断。
新增 `scripts/lib/diagnostic-safety.mjs`（仅手动诊断使用）通过lsof+进程树验证端口所有权；启动前端口必须空闲，无法证明即拒绝；4个CDP诊断入口及窗口采样接入。报告默认只写cwd，native/pressure跨树输出须显式`--dest`。A/B必须显式`--candidate`，支持`--out`；中断逐层传递，失败和残留使验收失败。队列最低等待断言同步70秒。
`scripts/diagnostic-safety.test.mjs`独立手动执行，不加入常规npm test，避免CI意外启动GUI：端口拒绝、进程归属、报告路径、70秒断言、真实widget/A-B中断清理。
加固过程曾出现widget脚本语法检查失败（缺闭合括号）及信号测试驱动重复发SIGTERM导致退出码null；均修正后复跑，不把这些中间失败冒充首次通过。
此前6轮证据保持原始基线；加固后新增review标签单轮证据只做功能复核，不覆盖原6轮内存归因，不作优化率比较。

复验首次队列等待至71秒后取消按钮定位失败；截图显示设置已关闭（确切关闭来源未证明，不归因内存策略）。失败结果与截图保存在queue-review-failed。诊断鼠标驱动随后改为scrollIntoView instant、连续命中位置稳定且elementFromPoint验证后才点击，并断言资源页面从打开到等待期间持续存在，避免盲点坐标；再次复跑结果另存queue/result.json。
