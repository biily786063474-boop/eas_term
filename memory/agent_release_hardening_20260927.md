# 发布加固（排除Computer Use）
2026-09-27 用户要求继续解决未解决项。隔离树/private/tmp/eas-release-hardening-20260927，分支fix/release-hardening-20260927，基线1c3f452d；474a3205已提交推送用于Windows CI，未合入main、未发版。
已做Electron42.11.8/rebuild4.2.0+锁文件安全更新，audit0；Node>=22.12，Windows Node24/npm ci；显式@types/yauzl。
已补GC5秒超时/替换debugger保护、App画布保存成功ACK屏障，写盘失败保留dirty重试。完整闲置新窗口替换仍未实现：组件草稿/split tabs/设计/插件保存协议未接全，不能宣称回到刚启动。
check3909总/3899pass/10skip/0fail（另契约2项），10skip全Windows；可选16项真实OMP/clangd/Codex配置与3项真实本地模型通过。非付费在线模型E2E。
Mac arm64 ad-hoc候选/private/tmp/eas-hardening-final-candidate-20260927，已52项实际UI+PTY/IPC/OMP真实冒烟通过，不是签名公证正式包。新Electron DPR2极端截图/滚动及加速GC通过，没测真实一小时。
Windows workflow_dispatch run36341891514，代码474a3205，正在跟踪到结果（不得忘记）。本地watch输出/tmp/hardening-windows-watch.log，exec session66128（若已结束则查gh run）。不打tag，不触发Release发布。
官方breaking changes确认Electron>=38不再支持macOS11；42需12+（候选Info.plist实测12.0），已通过异步选项卡问用户是否接受新版12+、macOS11保留旧版。尚未收到答复前，不把兼容范围变化当已批准合入。
Electron42不再postinstall下载二进制，这是官方变更；require('electron')/CLI会按需下载，install-electron可显式下载。不能误报为npm安装故障。
剩余：Windows结果及证据归档；mac x64/签名公证、真实长时/跨实体屏幕、三CLI在线；完整prepare/flush/recheck/commit重建协议。Computer Use明确不处理。
计划ffb85cf1-36ee-4c44-b04f-c2c6de2441f6 v217，步骤1已reported_done，2/3in_progress，4pending。报告尚未刷新本轮最终状态。不能将整计划勾完。
Windows已完成：run36341891514 success 6m15s，所有build-win步骤通过，publish skipped。Windows CLI25/25包含mac跳过的10项。Mac最终arm64 ad-hoc52项UI+PTY/OMP冒烟通过。完整重建与用户macOS12+选择仍未完；不合main、不发布。上述watch任务已结束，无后台Windows任务等待。

## 2026-09-27 最新确认（取代前文待确认状态）
用户明确批准新版 macOS 12+，macOS 11 保留旧版。build.mac.minimumSystemVersion 显式设为12.0；候选包Info.plist已是12.0。Windows run36341891514已成功。旧客户端updater只提示和下载、不自动安装，也不识别最低OS字段：正式发布前须在下载页及latest.json notes提示最低macOS12并保留旧包；本轮未部署，不宣称已对旧客户端自动分流。完整闲置窗口重建仍未完成。

2026-09-27 完整闲置恢复继续实施：新增 renderer recoveryRegistry（必需模块登记、保存ACK、代次失效、超时）与 main idleRebuildTransaction（prepare→hidden candidate ready→同步准入锁→重验→commit，失败只清候选）。目前均为未接线协议模块，绝不当自动重建已生效；20项协议+保存单测通过，typecheck通过。测试首轮模块缺失、随后索引类型错误与清理异常测试失败均已修正复跑。下一步必须接聊天history成功ACK/文本图片chips草稿、split tabs、编辑设计插件的登记或否决；再接全入口准入门闩、惰性候选窗口启动/恢复验证。AgentChatView现有pendingSaveRef在IPC成功前就置null，不能直接作为保存确认。未构建/实际应用验收本轮新协议，未提交，未合并发布。

2026-09-27 待接入模块续：草稿/chips/图片/retained所有权、history成功ACK、canvas ACK、工作区tabs及分屏树/画布撤销布局已接renderer检查点，未知编辑器网页插件及存活会话明确否决。实际Electron React卸载重建首轮9项通过，正在最终含真实历史显示11项复验及全量检查。独立审查2项修复并复审通过。BrowserWindow/新renderer/主进程准入闸门与一小时计时器尚未接，不把renderer remount冒充完整资源恢复。工作树未提交，正式应用未变。详见docs/verification/idle-recovery-adapters/README.md。

最终复验：构建成功；全量check 3929项，3914通过、15跳过、0失败（Windows及未开启opt-in，本轮未跑Windows CI）。27项恢复专项通过。真实Electron状态恢复11项通过并亲眼查看restored.png：历史、草稿、附件、两个分屏面板均可见。新增历史场景首跑因history异步布局未稳定，真实点击未命中输入框而失败；等待历史出现并滚动定位后复跑通过，未放宽产品保护。独立复审两项阻断已解除。没有后台测试遗留，未提交/合并/发布。剩余仍是主进程旧/新窗口归属、新窗口惰性启动与恢复就绪、所有任务准入门闩、生产一小时触发及真实长时验证；本轮不可宣称完整资源恢复已上线。

2026-09-27 最终接线：idleWindowRecovery + recoveryAdmission + preload/renderer bridge 已接生产一小时策略。隐藏候选默认拒绝未知操作，旧窗口同步seal交接；fail-closed明确覆盖未知pane/插件/编辑器、原生全屏最大化、灵动岛辅助窗，仅GC。不是全进程重启。实际新renderer13项已通过并眼验；增加关闭开关/未完成确认后正在最终15项回归。独立审查seal竞态、destroy回滚、ready后crash三项已修，最后3/3复核无剩余阻断。移除未用的idleRebuildTransaction原型，生产只保留单协议。尚待最终check及本次WindowsCI、提交合并；不要把旧474a3205的Windows证据当新恢复代码证明。

最终封口复核：sync seal不可预赋returnValue（会提前解除阻塞），已加setter顺序断言；抽屉/待归档/转录结果/语义弹窗全部否决，设置弹窗加入真实验收。独立审查复核均通过。本机opt-in真实OMP/Codex配置/clangd16项通过，不涉及付费模型。70e389f6已推分支；main本地468a555f尚未push，等封口提交合入及最终验证。Windows36346152466在跑70e389f6，不能当最终封口提交的CI。

封口后最终本机：3917pass15skip0fail，typecheck/build通过；真实Electron17项（含设置弹窗、MCP新窗口路由）通过并眼验。额外opt-in16/16。第一轮Windows70e389f6/run36346152466成功；最终主线仍需追踪新CI。准备提交封口并合并，不发版。
