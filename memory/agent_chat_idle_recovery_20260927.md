# 2026-09-27 当前工作（未完成、未提交）

独立工作树 /private/tmp/eas-idle-recovery-20260927，分支 fix/chat-scroll-idle-recovery-20260927，从 ade2c89c 创建；不要动主工作区其他 agent 修改。
执行计划 d71f7837-d649-462d-82e2-b7f70080ecd0。先 plan_get 取版本再更新。用户要求继续，不需要重复询问许可。

已实现并隔离应用验收：消息晚到布局贴底/手动上翻保留；首轮图片粘贴、预览、删除、纯图片载荷、失败保留和显式重试；历史图片缺 URL 时重新读取。发现并修了 failed 状态按钮锁死与历史图片空白。在线 CLI 未验证，Codex 测试 transport + 真实图片/历史 IPC 已验证。最终全量 check 3848 通过19跳过0失败；生产构建通过。详见 docs/verification/startup-images 和 message-scroll。

本轮新增 idleRecoveryPolicy.ts/test.ts：只是一小时连续后台空闲判据，未接运行时、未回收任何资源。3 测试通过（时长/休眠间隔/未知/活动代次），类型检查正在复核。政策强制 activity generation 非负整数，捕捉采样之间的短任务。不能将此模块当产品功能完成。

闲置恢复未完成：见 docs/superpowers/specs/2026-09-27-idle-recovery-design.md 和 plans/2026-09-27-idle-recovery.md。用户已确认方案并要求执行。下一步应接主进程全局活动来源和安全回收，不要又只汇报图片。主要限制：did-navigate 会 kill PTY/AI；没有覆盖所有编辑模块的落盘确认；runtimeMonitor 仅窗口投影不足以判断全局空闲；manager 的服务持有和队列都要算忙。Electron webFrame.clearCache 文档警告盲清会变慢，既有 Markdown cache 也是关键性能修复，不得定时清空蒙混。

新增最后任务：AI 选项卡位于同次回复所有文字下方，流式新文字在其上方，不移动历史轮选项；用户指定排在当前任务之后，尚未改。

验证脚本 verify-agent-chat-ui.mjs 会临时修改 preload，finally 还原并重建；不要与 typecheck/check 并行，否则会撞临时 fixture TS2554。当前没有应保持的隔离应用进程。
existing fs.readImageFile 有格式/50MB限制，但无 guardPath；新 historyImageSource 使用该既有接口，不能对外声称项目路径授权。

执行衔接教训：前几轮在局部验证后反复结束，造成用户反复催。不能说“后台继续”而实际无进程。未实现项保留，不标 reported_done。

## 2026-09-27 后续推进（未提交、未合并、未发布）
- 工作树仍为 /private/tmp/eas-idle-recovery-20260927，分支fix/chat-scroll-idle-recovery-20260927。所有本会话改动未提交，别混入主工作区其他agent修改。
- 队列用户纠正为仅首次宿主发送FIFO错峰，不限制整轮运行数量；旧2并发已取消。自适应离线等待/2–30s退让/新代次成功恢复已验证。未知结果不重发、不探测外部域名。docs/verification/cli-dispatch/adaptive-20260927.md。
- 汇报webview display:block导致150px视口已恢复flex；调试BrowserWindow viewport跟随布局，限制最大边2048，非裁切。独立脚本已验证。
- 选项卡移到同用户提问后连续assistant组末尾，保留历史分组；WeakMap按Turn+text缓存，不能按mutable turns引用memo。隔离UI先选项后工具后补充文字验证通过。
- 闲置恢复目前只实现非破坏性Chromium GC+开关，并非原需求的整窗恢复。明确向用户说明差异；完整flush/重建协议仍未完成，不得标全部完成。默认连续后台1小时、无任何已知服务/任务/guest/调试器才执行；一般有空闲终端也会跳过。真实一小时/性能收益未验证，仅纯策略与加速真实Chromium+未保存DOM保留。
- 独立只读审查发现共享服务短生命周期漏记及全历史选项解析；已加sharedServices独立代次和WeakMap修复，复审通过。全量/隔离最终日志在/tmp/idle-options-final-check.log与/tmp/options-final-ui.log。

## 新建AI尺寸 2026-09-27
用户批准宽高各+20%，已有节点和字体不变，小屏可视区封顶。已实现agentNodeSize 768×456及两处新建入口；隔离验收发现PaneView旧挂载修正强撑640，移除自动改写、手动resize下限保留。验收脚本verify-node-size经verify-agent-chat-ui --node-size运行；前两轮分别因脚本selector错误、生产旧自动拓宽冲突失败，第三轮运行中。未提交/发布。
此前预览全屏高DPI改动构建类型检查、47项真实预览UI验收通过；超4K/跨屏DPI/Windows及长期性能未测。全量检查最后记录仍为3862通过19跳过（高DPI改动之前）。
最终尺寸验收：第四轮隔离应用通过，1440/700宽及200%缩放、已有节点保持验证通过；重构建通过。全量check 3867通过19跳过0失败（尺寸边距末次微调另有纯函数及最终UI覆盖）。截图已眼验，仍未提交发布。

## 用户请求提交安全合并
2026-09-27：用户明确提交并安全合并，默认push、不发版。独立premerge_chat_review 32项专项通过，P2 agentChat.css后置nowrap覆盖窄屏规则已修复（宽屏规则前移）；真实UI修前失败、修后452px模型/强度/按钮边界通过。main工作树/private/tmp/eas-perf-main-merge-20260925干净，origin/main ebe1df4e；主工作区仍别人的feat分支，不碰。准备提交全部本隔离树会话成果（包括有明确缺口的GC阶段），再合并验证。

安全整合结果：功能50dee996已push；整合树/private/tmp/eas-chat-runtime-integrate-20260927分支integrate/chat-runtime-20260927，最新main ebe1df4e无冲突合并32c1ef8c。合并后check3886总计/3867通过/19跳过/0失败、build通过；窄屏startup最终回执通过，reviewer复审通过。仅补结果文档后快进本地main并push，不发版。原主工作区不改；隔离工作树保留。
