# 发布加固验收 · 2026-09-27

基线1c3f452d，隔离树/private/tmp/eas-release-hardening-20260927。用户要求继续处理未解决项，明确排除Computer Use。未发布，未改正式应用。

## 已实施
- Electron37.10.3→官方维护版本42.11.8，rebuild4.2.0，更新锁文件中可兼容的安全修补版本，不运行audit fix --force。Node最低22.12，Windows构建Node24/npm ci。
- 新独立node_modules安装与node-pty rebuild成功；干净安装暴露间接类型依赖消失，显式补@types/yauzl，未放宽TS检查。
- npm audit全依赖零告警（非仅omit dev）。弃用包警告仍有，不等于已知安全告警，未声称永久安全。
- GC5秒超时/自有调试器清理与替换保护。不是整窗重建。
- 画布保存屏障：修复发送保存前清dirty导致失败不重试；成功ACK才确认，合并连续异步保存。不是所有组件的保存屏障。
- 官方Electron版本来源：https://releases.electronjs.org/release?channel=stable

## 实验与失败记录
- 新测试先缺模块失败，随后通过；Windows Node版本契约先失败后改为24通过。
- 初次typecheck缺yauzl类型，补显式依赖后通过；新GC测试EventEmitter的this类型曾失败，改闭包引用后通过。
- Electron下载走Clash代理但字节持续增长，未改用户代理。
- mac arm64本地ad-hoc验证包在/private/tmp/eas-hardening-candidate-20260927，非正式签名公证包、非最新主线发布包。

## 验收（以追加记录为准）
- 新Electron下50项实际预览UI、DPR2极端像素/滚动取景、加速真实GC通过，草稿保留。
- 本地ad-hoc打包及50项实际包UI通过（发生在追加画布保存屏障之前；需最终重包复验）。
- 开启原跳过项：真实OMP/clangd/Codex配置16项、真实ASR/VAD/streaming3项通过，均隔离夹具，不是付费在线模型E2E。
- 全量首轮3877pass19skip；加环境及本地模型资源后3892pass10skip，0fail。后续保存屏障纳入后的结果待补。
- 模型目录只引用本机已下载资源，不读取密钥，不新增下载，不提交symlink。

## 完整闲置恢复仍未完成：禁止误报
原计划的prepare/flush/recheck/commit与新窗口ready后替换尚未接通。
调查发现：App只保存canvas；AgentChatView/ChatToolbar文本和图片草稿存在本地React state；split tabs本来不跨重启保存；设计/编辑/插件面板没有统一保存确认；index.ts did-navigate会杀会话。
当前只完善非破坏性GC与画布保存前置。不能把没有运行CLI等同于没有未保存内容，不能用强制定时reload实现用户目标。
下一阶段必须逐模块登记可恢复状态/明确否决未知状态，再接新工作准入门闩和替换失败保留旧窗口；不允许为了提高触发率绕过PT Y/插件/网页保护。

## 未验证
Windows实际ABI/打包smoke（待CI）；mac x64和签名公证；真实一小时及跨实体屏幕；三CLI在线模型。Computer Use按用户要求不处理。

## 本地最终复验
完整check：3909项，3899通过、10跳过、0失败；额外Node/版本契约2项通过。
真实UI增加保存故障与重试后52项通过，保留frame ID及viewMode。首轮故障测试未产生编辑（setViewMode与默认canvas相同），等待诊断超时；改为先split再canvas并加入真实frame，不修改产品逻辑。
保存单测7项通过，独立复审无阻断；补旧异步ACK晚到及保存中新编辑失败回归。
剩余10项全是Windows平台条件，留给真实Windows CI，不删除skip或假装在mac通过。

## 兼容性边界（需用户确认）
Electron38起停止支持macOS11；本次42.11.8实际候选Info.plist要求macOS12.0。已询问用户是否接受新版12+、macOS11保留旧版，未默认批准范围变化。
Electron42取消npm postinstall自动下载，require/CLI按需下载或install-electron显式下载，这是官方行为，不是安装损坏。42还改变mac通知签名要求；本次未验证通知投递，不用ad-hoc启动通过替代正式签名验收。
来源：https://www.electronjs.org/docs/latest/breaking-changes
最终Mac arm64 ad-hoc包：52项UI及真实PTY/IPC/OMP启动冒烟通过。Windows run36341891514跟踪中。

## Windows最终结果
run36341891514，head474a3205116d6a29d81bed62ed126e1d89a27143，成功，6分15秒。npm ci、node-pty原生编译、安装包打包、实际包启动/PTY回显/IPC/OMP冒烟，插件与浏览器实际包回归通过。Windows CLI专项25/25、0skip，包含本机因平台跳过的10个测试。发布步骤因非tag跳过，未创建公开Release。
注意：这是Windows runner启动打包产物，不冒充手工NSIS完整安装升级/卸载或所有Windows硬件验收；在线模型、跨实体屏幕与真实长时仍未验。

## 2026-09-27 最新确认（取代前文待确认状态）
用户明确批准新版 macOS 12+，macOS 11 保留旧版。build.mac.minimumSystemVersion 显式设为12.0；候选包Info.plist已是12.0。Windows run36341891514已成功。旧客户端updater只提示和下载、不自动安装，也不识别最低OS字段：正式发布前须在下载页及latest.json notes提示最低macOS12并保留旧包；本轮未部署，不宣称已对旧客户端自动分流。完整闲置窗口重建仍未完成。
