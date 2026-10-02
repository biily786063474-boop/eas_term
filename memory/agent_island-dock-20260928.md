# 2026-09-28 Dock / 灵动岛隔离（未完成）
独立树 /private/tmp/eas-island-dock-20260928，分支 fix/island-dock-20260928，base 1cbbc1c2。未提交/合并/发布，正式应用未替换。
根因：Electron42.11.8 spaces visibleOnFullScreen 默认 DockHide，安装版变Accessory。
候选：skipTransformProcessType:true。构建、静态2项、全量3945pass19skip0fail。但真实CGEvent点击知道了导致前台PID变宿主，已用独立SwiftAppKit前台窗口排除同bundle假阳性。点击链JS无focus；普通通知出现不抢焦点，Dock可保持。
这是阻断，不许将候选合入发版。证据 docs/verification/island-dock-20260928/native-dismiss-failure.json、notification.png；方案PLAN.md；脚本scripts/verify-island-dock.mjs。
原版和roundedCorners变量追加对照卡在CDP初始化，未得到结果；out已还原候选构建。下一步最小原生空白面板mousedown前后对比；若确认Electron限制，再评估独立原生NSPanel宿主。不得用事后切回前台补偿抢焦点。

## 01:50 后续诊断（取代上轮未完成基线）
新增 scripts/probe-island-native-click.mjs，不涉及生产接线。构造带独立 bundle id 的 Swift .app 前台助手、预编译 CGEvent 点击器并泵 RunLoop 读取真实前台。5组：Electron regular/accessory/rounded 都在mouseup激活宿主；真正NSPanel普通桌面与原生全屏均保留助手前台且窗口在屏可见。截图已看。结果 docs/diagnostics/island-native-click/。旧配置也失败，故不属于skipTransform参数新引入的业务回归。
已写新增原生宿主架构 spec docs/specs/2026-09-28-island-native-host.md，待用户审阅，再写实施计划。不允许此时将参数候选合并为完整修复。

## 02:01 用户批准架构分支/独立测试 App
已在原隔离工作树 git switch -c refactor/island-native-host-20260928，保留已有本次诊断和候选；旧fix分支仍存在，未提交。新实施计划 docs/superpowers/plans/2026-09-28-island-native-host.md，5阶段：协议、原生宿主、三条闭环、全能力回归、独立Lab应用。Lab独立名称/id/profile，不覆盖正式，不走正式更新，用户尚未审阅新实施计划，尚未生产接线。当前静态2测试通过，diff check通过（不代表行为已修复）。

## 当前会话顺序实施：首个实验包落地
用户批准计划后完成受限 stdio 原生 NSPanel/WKWebView 宿主、generation 校验、资源白名单/CSP、所属进程清理、主进程适配及独立 Lab 打包。分支为 refactor/island-native-host-20260928。原有 Electron 默认路径保留。
最终全量 3957 通过/18 跳过/0 失败；打包 App 9 项真实交互验收通过（含外部原生全屏），真实进程异常帧和 EOF 清理通过。详见 docs/verification/island-native-host-20260928/README.md。
审查发现审批请求缺少稳定版本绑定；实验版关闭岛内直接批准，仅返回终端确认。此项及多屏/休眠/macOS12等完整矩阵尚未完成，不可称架构全面交付。
独立 arm64 ad-hoc App 在 release-island-lab/mac-arm64/Eas-Term Island Lab.app；不是公证发行包。正式应用未动；无提交、合并、推送或正式发布。

## 架构/功能验收：暂不通过
主进程HOME导致默认钥匙串Security只读A/B为0对-25307；通知sharedServices否决闲置恢复。旧packaged verifier临时profile被固定Lab目录覆盖，用户使用后不可直接重跑。本轮临时开发实例8项交互通过；全量3954pass/3fail/18skip，相关两文件17+6专项通过，不冒充全量绿。报告docs/verification/island-native-host-20260928/acceptance.html。未改产品代码/未替换已安装Lab/未动正式版。待修HOME边界、idle判据、验证profile隔离。

## 两处验收阻断修正
主进程保留系统HOME；新增applicationHome可信bootstrap路径，配置读取模块改用它，PROBE_ENV/PTY/pluginHost子进程使用隔离HOME。app.getPath(home)仍是Lab目录，系统二进制候选可读真实安装位置。验收EAS_VERIFY模式可设置独立EAS_ISLAND_LAB_VERIFY_ROOT。sharedServices.blocksIdle排除纯notification但仍跟踪、清理；hasAny语义不变，其他任务否决不变。
红测试2项已复现后修正。首次全量17项失败是源码注入式测试未供应applicationHome符号（session+pluginMarket），补同等临时目录依赖后专项及最终全量3960通过18跳过0失败。新打包App9项实机通过，包括safeStorage测试文字加密/解密、HOME未改、profile为新临时目录、原生全屏交互。真实一小时闲置/多屏/在线账号仍未验；直接审批仍禁用。
新包在release-island-lab/mac-arm64/Eas-Term Island Lab.app，deep签名通过。/Applications旧Lab仍运行，未擅自退出或替换；正式版未动。无提交/合并/发布。

## 03:10 本机Lab已替换
用户确认可退出后通过正常quit退出旧Lab；旧包保留~/Applications/Eas-Term-Island-Lab-backup-20260928-0309。新包/Applications/Eas-Term Island Lab.app，asar SHA256 8a69270d781465f9c0315caa0a83a4ece82b2bd247f4999756a7dc95e7ad6d54；deep签名通过。PID1215启动，实际截图未见钥匙串弹窗。正式PID86316未动。真实账号登录/在线任务验收仍待用户在Lab内登录，不能迁移正式凭证来冒充通过。

## 03:15 CLI点击无响应：测试残留数据
实机复现：dock-frame引用虚构dock-project，用户Lab无projects.json，addAgentNode/openAgentPane找不到项目直接返回。不是CLI按钮丢事件。通过原生目录选择器添加~/Applications/Island-Lab-Verification-Project；实际点击Codex已出现AI输入框。通过右键删除自己创建的失效Dock焦点验收Frame（没有删除用户目录）。当前模型清单仍显示读取失败，真实登录和发任务未完成，不能称CLI完整通过。无产品代码补丁，正式版未动。

## 03:19 真实CLI验收：等待登录
直接用Lab HOME/CODEX_HOME执行codex login status复现明确错误：CODEX_HOME不存在。mkdir Lab isolated-home/.codex后变为Not logged in；实际GUI刷新模型列表成功显示模型。首次目录初始化仍需补入islandLabMode，当前仅修本机目录，不可称安装包已修。发出无工具最小测试消息后停留处理中，已按停止生成结束。设置→AI对话→Codex登录弹窗已打开（截图见CUA），停在登录并继续；等待用户授权。不复制真实凭证，正式版未动。发现Lab灵动岛偏好为关闭（前次旧验证污染），在线通知验收前需明确开启。

## 03:23 用户登录后的真实链路
Lab HOME/CODEX_HOME下codex login status返回Logged in using ChatGPT；设置显示已就绪。实际GUI发送“Reply only OK. Do not use tools or modify files.”，约42秒后返回OK，界面1轮/输入10K/输出5（含宿主提示词，并非仅这句字数）。先前未登录请求已停止，不混算通过。
恢复Lab“显示灵动岛”开关后最小化；实际原生Host显示任务完成1条，展开显示Island-Lab-Verification-Project/42秒。点击任务后Lab恢复并定位该会话，完成徽标消失。CUA实际操作，非注入通知。正式版未动。仍需把缺失.codex目录自动初始化补进代码；仅Codex在线链路通过，Claude/OMP、真实一小时、多屏、岛内审批未通过此验收。

## 当前补验（新目录 / 回归）
用户同意开始自主验收。新增 initializeLabHome，固定目录700，保留主进程HOME和已有配置；先红后绿。真实空目录 Codex login status = Not logged in，GUI首次引导为两家已安装未登录，未继承用户账号。npm run check 3979总/3961通过/18跳过，后追加多项目目标失效测试单独6通过。四类真实原生宿主故障退出通过。独立包重建成功，新测试实例使用 /tmp/island-accept-next-root 中记录的临时profile；没有替换 /Applications 的用户Lab或正式应用。当前测试实例PID62392（退出前须核身份）。用户正在使用的Lab登录不动。
注意本轮未进行多任务通知真实界面点击、崩溃后界面恢复、重复焦点循环；只有协议/子进程层测试，不能称完整架构验收通过。计划7be28524-90eb-4b2f-a529-72fc491eb401第三步继续待实测。原真实Codex单任务返回OK与通知跳回证据保留，不冒充本轮。

## 04:30 真实双任务 / 恢复 / 退出验收
两独立Codex模块发无工具请求ALPHA/BRAVO，真实返回，岛显示2条，点击BRAVO定位下方模块，ALPHA保留1条；再点ALPHA定位上方模块，清零。旧安装版通知进程97666(父1215)被精确SIGKILL后超过5秒未重建，确认代码onError/onClose无重新调度、最小化renderer无更新触发。没有全局杀进程。
修复：islandRecovery.ts单次3秒重算，island.ts原生onError调用，destroyIsland取消，现有shouldShow/节流/权限不变。两测试先红后绿。新包构建签名成功，正常退出安装Lab后直接运行工作树新包，沿用Lab profile不拷凭证、不覆盖安装包。真实RECOVERED任务结束后杀所属进程11172(父8273)，3.27秒自动重建12369，UI结果保留、点击返回对应模块。再发CLEANUP完成后带通知正常quit，8273与14894都消失，退出清理实测通过。
首次check两个失败：real POSIX terminal Ctrl-C reaches native CLI once and leaves it interactive；native package pipeline checks integrity... timeout。package专项2通过；完整复跑3982总3964通过18跳过0失败。日志在docs/verification/island-native-host-20260928/recovery。未提交合并发布，正式App未动。当前新包是工作树release-island-lab，/Applications安装包尚未含本轮修复。
覆盖有限次数后台收起/展开/任务跳回，不声称连续输入焦点压力/多屏/休眠/跨平台/ClaudeOMP在线全部通过。报告acceptance.html已追加最新结论，历史块保留。

## 05:00 扩展验收
用户要求继续所有可验项。新增脚本verify-island-lifecycle-stress.mjs、verify-island-parent-death.mjs，打包宿主29项真实进程检查通过（20启动退出+5非法消息+双宿主隔离+2资源清单错误+父进程消失清理101ms）。专项41通过；新完整check3964通过18跳过0失败，日志extended/。
CUA工作树新包真实Codex返回FOCUS，TextEdit新测试草稿连续5次岛展开/收起均保持编辑焦点，前后四行输入完整。原生全屏下展开/继续输入/忽略通知AX通过；截图报SCStream -3811，不称截图验证通过。草稿本地extended/focus-input-proof.rtf，原生保存框曾把绝对路径当文件名存入TextEdit iCloud目录，已将本次自建文件移回本地证据目录；没有删除任何其他文稿。退出全屏且关闭测试文稿。
实验App PID33255正常quit，所属进程无残留。无安装包替换/提交/合并/发布。更新页手动check显示“已经是最新版本”，代码Lab gate实际禁用正式更新，作为低优先级文案缺口记录未修。其余需要受控时间/硬件/账号：真实一小时+长时RSS、休眠锁屏、多屏、ClaudeOMP在线、macOS12/Intel/Windows；直接审批禁用和ComputerUse外部生命周期问题仍保留。报告acceptance.html和extended/README.md已更新。
