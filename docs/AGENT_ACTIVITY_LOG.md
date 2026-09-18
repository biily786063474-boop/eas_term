# Agent 协作活动日志

## 2026-09-07：AI 对话模块源码调查与计划

- 基线：main / 62f993f；原有 AGENTS.md 修改与未跟踪 .agents/、.codex/ 未触碰。
- 任务：Codex 多轮续聊、动态模型、回复样式、链接与插件读取展示、公共协议。
- 确认：本机 codex-cli 0.147.0 不接受当前 adapter 拼出的 exec resume … --sandbox 参数，帮助模式复现 exit 2；未调用真实模型、未完成应用端复现。
- 模型下拉、动态探测、缓存以及 Markdown/链接/插件面板已有实现；计划以修正现有链路为主。
- 验证：模型、状态机、adapter、工具栏相关 180 项测试全过；未执行全量检查或应用眼验。
- 交付：docs/superpowers/plans/2026-09-07-agent-chat-codex.md。
- 状态：仅新增计划和本日志，业务代码未改，未提交、未发版。实现按计划 P0 开始；留意 roles-workflow-p3 独立工作树的并行改动。

## 2026-09-07：Codex 对话实现与兼容验证

- 独立工作树 `/private/tmp/eas-agent-chat-codex`，分支 `codex/agent-chat-codex`。修正 resume 沙箱参数位置；强化动态模型握手/分页/超时/缓存与刷新；按模型显示推理档位；公共工具资源和插件状态、阅读排版。
- 新字段都走公共能力/事件；Codex、Claude、omp 前端事件回放通过。HTTP 链接回同 Frame，ui 资源仅映射当前插件声明面板。
- 全量测试 2452 通过、1 跳过；类型和构建通过。真实 CLI + 假服务三轮上下文验证通过；真实 model/list 读取成功。
- npm run check 仍受原有 canvas.css cframe-sweep 动画规则阻止。真实外部插件、Claude/omp 后端对话及完整停止/切模型时序未验证；详见 docs/verification/agent-chat/README.md。
- 没有发版、安装、合并或推送，保留独立分支供审查。

## 2026-09-07：模型选择前移至首条消息之前

按用户反馈，选择 CLI 即读取目录，启动页显示模型、强度及首条消息使用模型；首轮和 resume 失效重试均传递用户选择。复用公共探测，不创建对话，不按 CLI 名称分支。真实目录 + 假 start 的隔离 UI 验证通过；全量 2454 通过/1 跳过。开发窗口已更新，留给用户查看。

## 2026-09-09：浏览器收藏整轮开发验收
在`.worktrees/browser-favorites`/`feat/browser-favorites`完成正式收藏数据与受限IPC、本地授权缩略图、五默认目录和自定义贴纸、横排大卡+边缘提示、HTML表单/内部路由与browser_routes MCP。保留persist:browser，隔离profile跨进程Cookie/收藏回归通过。四最大化宿主保留隐藏几何，共享收回期间恒定内容布局；20轮模块身份回归与trace证据在docs/verification/browser-wave。蓝图hover同位置复验。无OGL、无外部截图服务、无真实账号导入、未发版；两条未确认网址仍pending，Windows仍待后续实机门槛。

## 2026-09-09 Eas-Term 0.4.88 发布
浏览器收藏、本地授权预览、横排大卡、Agent HTML路由及词典hover/缩回优化正式发布。Mac两架构签名公证及打包UI通过，Windows CI34325720098含新增35+19项通过；五包逐个SHA256校验后切换官网/latest，八站状态一致，无重启，0.4.87回退保留。原始Windows闪退与外部Computer Use指针不冒充已修复。详见docs/verification/releases/0.4.88.md。

### 2026-09-09 语音输入完整实现与回归
本地VAD、四类编辑入口按光标插入、跨框片段路由、IME/撤销与发送取消；多轮只读review闭环。17组Electron UI与两档各12真实ASR样本通过，全套2820测试2808pass12skip；Windows专用CI及开发验收实例见docs/verification/voice/README.md。未发版，实麦现场边界保留。

## 2026-09-10 密钥调用链审查恢复（尚未修复）
在 voice-regression 工作树 ae8392d 核查 15 组问题/边界，12 项假库隔离观察含 1 正常撤销对照。发现名字授权串权、文件类型保存丢失、损坏库被空库覆盖、部分变量缺失仍成功，以及原生身份/仅授权和 wrapper 明文输出边界。未改业务代码、未动真实凭证、未发版。报告 docs/reports/2026-09-10-secret-vault-sequence.html 已进 Frame；交接 memory/agent_secret-vault-audit-2026-09-10.md。建议严格受控执行方向待确认；不以接 token 冒充强隔离。

### 2026-09-10 20:55 狼人杀现场交接：明确本次修复路线
用户确认直接 Agent spawn 漏配，要求沿用 wrapper/会话授权，不新增主进程 secret_run 或受控业务代理。原文 docs/2026-09-10-werewolf-agent-secret-handoff.md；覆盖上条严格路线待确认。已核对共享 shim 提取点、OMP scrub 后 env 合并及撤销位置。尚未修改业务代码，下一步按三条 e2e 和代次隔离写失败测试。

### 2026-09-10 密钥柜解锁形式确认
用户选择沿用六位数字解锁码；已同步首次引导需求与任务 memory，未改业务代码。

### 2026-09-10 亮色配色实现（待视觉验收）
只调亮色灰阶/边框/文件标签，保留产品造型。2项新增测试红转绿，CSS及accent检查、构建通过。CUA窗口归属存在歧义，未完成实际亮色眼验；未发版。

### 2026-09-10 22:27 会话标题角标裁切
局部取消pane-header内网页角标负margin，保留面板内容裁剪；两项测试/构建通过，CUA刷新对应实例并亲眼核验AI与终端角标完整。未提交/发版。

### 2026-09-10 23:30 共用节点外壳与角标反馈
移除内缩特例，画布会话接cfile-node/head/body共用逻辑；测试2项与构建通过，实际窗口已验证外悬不裁切及整节点触发角标抬起边光。其余交互回归未完。

### 2026-09-10 发布前检查
提交53700d0已推送fix/background-render-budget，未合并main/未打tag。npm run check：2873项，2859pass、13skip、1fail；capabilityPtyLauncher.test.mjs 的真实POSIX Ctrl-C测试报 RuntimeError: native CLI not ready。暂缓公开发布，不跳过失败项。原始日志 /tmp/eas-release-check.log。

### 2026-09-11 修复发布测试资源竞争
固定测试文件并发4；对照全量与修改后完整check均2860通过/13跳过/0失败。未放宽Ctrl-C断言或超时，不影响产品会话并行；未发安装包。

### 2026-09-11 0.4.93 正式发布完成
Mac双架构签名公证和smoke通过，Windows34573939599全部通过；五包官网与GitHub size/SHA256一致，官网/latest和GitHub Release已正式切换，八站状态一致，无重启/删除。密钥柜会话凭证与首次解锁功能仍待实现。

- 2026-09-11：voice-regression worktree 接收验收 B1–B4，完成代码与回归测试；真实UI已核验编辑器正文、clean/dirty编辑保护、原AI回复空格路径图片。B1根因是旧构建动态chunk缺失导致await阻塞编辑器。密钥弹窗9分钟真实超时仍观察中。check 2890 pass/13 skip/0 fail，build通过。未提交发版，详见 docs/verification/2026-09-11-acceptance/fix-followup.md。
- B2补充：真实9分钟弹窗生命周期通过，调用记录有明确超时文案；超时后新secret_check可立即弹窗，取消后正常返回。测试脚本fetch的5分钟HeadersTimeout已如实记录并改node:http，不是产品shim失败。

- 2026-09-12：落实辞典设计选型台 V2，新增本地307套参考、检索、范围提示词、composerAddChip确认；构建+暗色开发实例验收通过，详细边界见 design-picker-implementation.md。未提交/发版。

- 2026-09-13：用户指定 runtime-governor 灾难回退基线，已建立 checkpoint/runtime-governor-baseline-20260913（2d884c2），未回退。继续接入 VAD 启动/驻留预算与取消生命周期，types/build通过，全量3083通过/15跳过/0失败；真实Worker通过，运行中心显示已验证，录音交互整链未验收。详见 memory/project_progress.md 与架构17；整体任务未完成，未提交/发布。
- 2026-09-13：ASR共享模型驻留预算与独立解码接线；真实模型及3102项全量（3087通过/15跳过）通过。隔离46704实际文件排队→恢复准入→非空逐字稿→空闲服务→确认关闭已亲眼验证。最后补正未知项目确认提示，最终回归38359进行中，详见memory/project_progress.md。
- ASR收尾：38359最终验证exit0；51113最终构建中未知项目确认提示、真实样本模型驻留及关闭已亲眼核验。报告与摘要更新到acceptance/transcription-handoff.html和asr-resident/，未提交/发布。
- 2026-09-13晚：流式模型加载准入、取消完成边界与初始化去重已接；3105测试3090通过/15跳过、types/build通过；隔离43056实际高压加载排队→取消→按钮恢复已核验，未采麦。完整流式驻留/解码仍待Worker迁移；详情见memory/project_progress.md。

- 2026-09-13 20:07：流式recognizer/decode迁到单录音Worker，有界FIFO/迟到partial隔离/驻留预算/运行中心关闭已接。专项17/17及真实模型通过，types/build通过；最新全量3096通过/3失败/15跳过（launcher配置等待，单独6/6通过，根因未确认）。隔离84898亲眼验排队取消、模型驻留与确认关闭，不采麦。未提交/发版，整体未完，详memory与acceptance/preview-resident。

### 2026-09-13 20:25 PDT · 详细交接存档
- 交接主入口：docs/handoff/2026-09-13-runtime-governor-2013/index.html，已由MCP打开在terminal Frame，CUA确认页面内容加载；截图确认画布内渲染，未做整页/移动端视觉验收。
- 包含背景、覆盖矩阵、关键代码契约、失败证据、隔离实例、3类恢复材料及下一轮顺序；9份/tmp原始验证日志已复制到evidence，附tracked.patch、状态、工作树和SHA256清单。不是完整源码备份，untracked内容不在patch内。
- 实际工作树仍voice-regression，分支fix/background-render-budget，HEAD/tag仍2d884c2。最新全量3096通过/3失败/15跳过，根因未确认；专项17/17、types/build通过，实麦未验，整体未完。
- 本轮只写交接文档，无业务改动、无commit/push/发布/恢复。12:51检查点不含晚间新增源码；恢复前必须保全混合脏树，优先新目录，不reset/clean。下一轮先查全量launcher失败，再补录音及全入口覆盖。

- 2026-09-13 20:45：接手资源治理。交接指纹 0 漂移；全量复跑 3099 通过/0 失败（39.3s）+ 最小并发组合三轮 54/54，launcher 5 秒失败未复现，失败当时外部负载明显更高（另一项目 beauty_server 等），不下"机器忙"的定论；给 launcher 测试加失败诊断（不改超时）。移植 session.ts exit 路径补 turn.done（CLI 报错退出后面板卡死），单测 11/11、typecheck 通过。证据：docs/verification/runtime-governor/acceptance/flaky-launcher-20260913/。未提交/发版。
- 2026-09-13 21:05：P0/P3 启动点清点完成：launchCoverage.test.ts 评审闸门（36 文件 58 处全登记，先红后绿并验证能抓新增），架构 17 覆盖矩阵与 4 个缺口（MCP 服务器启动、packages 同步校验、CLI 安装、登录）。全量 3117/3102 通过/0 失败，typecheck 通过。未提交/发版。
- 2026-09-13 21:15：缺口 2 收口——CLI 更新下载/校验异步化并经 runAppTask 应用级任务准入（全窗口可见不可取消），排队超时文案改为资源紧张；隔离实例验收排队不下载。全量 3121/3106 通过/0 失败。未提交/发版。
- 2026-09-13 21:50：缺口 1 收口——插件 MCP 服务器进程启动经应用级 startManagedSession 准入（并发合并、预算随真实退出释放、超时资源文案），McpClient 增 exited；隔离实例验收排队→超时→放行→服务登记全过。全量 3124/3109 通过/0 失败。未提交/发版。
- 2026-09-13 22:05：缺口 3/4 收口——CLI 安装/登录进程登记为可停自有服务（一次确认，走既有取消函数），隔离验收安装路径通过，登录路径仅单测。launchCoverage 只剩 builtin-bizone 一个 gap。未提交/发版。
- 2026-09-13 22:30：笔纵连接器客户端进程创建前经应用级准入（admit 必填、completed=exited），launchCoverage 0 gap。单测通过，未真机验。未提交/发版。
- 2026-09-13 22:55：符号索引从主进程同步搬进 ?nodeWorker 线程并按窗口归属准入（取消 terminate、exit 释放）；隔离验收排队/取消通过，放行受本机内存迟滞未观察；打包 worker 独立跑通。未提交/发版。
- 2026-09-13 23:20：知识库全库扫描搬进 ?nodeWorker 并按窗口归属准入，抽出共用 oneShotWorker 编排（符号索引改用）；隔离验收排队/取消/普通模式真实放行通过。未提交/发版。
- 2026-09-13 23:45：更新包下载抽成可取消模块并经窗口归属任务准入；隔离验收排队/取消/下载中取消清 .part 全过。非进程消耗仅剩控制面定时器。未提交/发版。
- 2026-09-14 00:30：策略迟滞刻画测试；运行中心新增「最近结束」（任务四结局 + 自有服务退出）与「按项目筛选」；隔离验收通过，下拉套既有令牌。未提交/发版。
- 2026-09-14 00:55：最近结束补齐工具调用与共享服务退出；共享服务按项目释放挂到项目移除（单测，未真机）。未提交/发版。
- 2026-09-14 01:20：对话历史完整归档落地（稳定序号 + 主进程并集保存 + 读取窗口 + 列表缓存）；真实 IPC 验证合并；文件格式 v2 向后兼容旧档。
- 2026-09-14 02:10：安全边界评审 S1–S4 修复（安装命令查表、webview 加固钩子、知识库根路径门、敏感 IPC 发起方守卫），先红后绿 + 隔离验收全过。未发版。
- 2026-09-14 02:40：代码地图文件级视图点节点/文件列表即在同 Frame 打开代码预览（分屏走 openFile）；先红后绿 + 隔离验收。未发版。
- 2026-09-14 03:30：独立审查 8 个提交并修复：闸门失效替代关死、交互通道、CPU 预留释放、归档两条数据 bug、git hash/主窗口导航/S4 全局/收件箱等安全项、fatal 收整轮等健壮性项。隔离验收通过。未发版。
## 2026-09-16：时间线插件低 token 实现
分支 design/timeline-plugin-20260916；批准的月热力图/弧形拨轮/详情接入项目持久化与 MCP，选中插件会话短规则与下一轮补漏提醒。全套 2848 项：2835 通过、13 跳过、0 失败。真实隔离应用验证网关写入、刷新、幂等、越界拒绝、详情及重载；未调用付费模型，未改正式应用，未提交。交接见 memory/agent_timeline-plugin-2026-09-16.md。

2026-09-18：0.4.102发布隔离集成中；产品76e2a3e，Mac公证票据与GitHub查询遇DNS/代理故障，尚未发布；状态见memory/release-0.4.102-2026-09-18.md。

2026-09-18：0.4.102官网与GitHub五包发布完成，Mac双架构/Windows CI35322170095验收；三处镜像size/SHA256一致，生产服务未重启，临时网络设置已撤回。

## 2026-09-18 全局时间线改造 · 首批内核
用户批准全局记录/热力图/项目标签筛选/插件热启停。实现文档与计划已落盘；global 聚合、capture 候选、pluginEvents 可撤销总线核心共23项定向测试及typecheck通过。尚未接真实会话、授权配置、候选落盘或全局UI；不宣称可用、不改正式应用。分支 feat/global-timeline-20260918，详见 memory/agent_global-timeline-2026-09-18.md。

## 2026-09-18 全局时间线主链路
feat/global-timeline-20260918：宿主权限、全局项目聚合、零模型候选与项目筛选面板已接通。隔离应用验证截图 docs/verification/global-timeline；全量低并发2862通过13跳过。未发布；完整卸载/更新重握手和真实模型验收仍待完成。保留他人工作区改动。


# 全局时间线验收：未通过

2026-09-18，在隔离 macOS Electron 实例执行，未替换正式应用。

## 通过
- typecheck、build、本轮 28 项定向测试、21 项隔离 UI 检查。
- Codex 真实既有非时间线会话：开启后完成极小计算任务，回复“已完成：17 + 25 = 42。”，自动新增 1 条候选。
- 真实退出、重启应用：全局开启状态、排除项目、成果历史恢复。

## 实测失败
- 修改插件 server.mjs 后，旧进程仍返回旧内容，未加载新代码。
- 移除插件后，已打开面板仍能调用旧进程。
- 根因：pluginHost.acquire 按名称复用缓存进程；panelRpc 使用缓存 Hosted，没有更新/卸载失效回收链路。需要统一撤销事件订阅、回收旧进程、面板失效和新版本重新握手。

## 环境阻断与未验证
- Claude 返回：Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access。不是有效模型交付，不算验收通过。
- OMP：隔离验收环境未配置模型服务商；未复制正式版凭证或修改用户账号。
- Windows 未验证。完整三 CLI 实机取消、正式回执去重矩阵未验证。

## 证据
- ../global-timeline-live/failure.json：保留 Codex 成功、Claude 阻断及首次断言中止记录。
- ../global-timeline-live-omp/result.json
- ../global-timeline-lifecycle/result.json
- ../global-timeline-restart/result.json
- result.json：21 项隔离 UI 检查。

本轮只验收并记录缺陷，没有修复上述生命周期问题，没有提交、合并或发布。

## 2026-09-18 生命周期缺陷修复与复验
- 两项实测缺陷已修复：插件文件更新立即使旧面板/旧shim失效，关闭所属旧进程；卸载后旧面板拒绝调用。重新打开握手读取新代码，重新安装可恢复，不重启宿主。现有面板显示进程退出，用户点击重试，不宣称无感替换UI。
- 统一 retirePlugin：撤销旧事件generation与队列、摘registry、撤销旧连接、关闭所属进程。旧onExit/onNotification校验Hosted对象身份，不误删/污染替代进程；安装根变更也撤销。
- 增加pluginLifecycle目录监听。复测首次发现macOS FSEvents会向新监听器重放重装前事件，导致重装进程立刻退出；先补测试复现1!=0，再用真实文件状态快照过滤旧通知，测试转绿。根软链解析到实际插件目录，不遍历子软链；目录不可读则拒绝建立进程监听。
- 验证：typecheck/build通过；低并发全量2879项，2866通过、13跳过、0失败。随后根软链/不可读目录防护再次通过3项定向、typecheck/build及真实生命周期复验。原21项UI检查、实际重启恢复均通过。
- verify-global-timeline-lifecycle：更新新代码、旧PID真正退出、旧退出回调不移除新进程、卸载拒绝及PID退出、重装重新握手通过；截图invalidated-panel.png已亲眼查看。最初CDP向销毁iframe求值超时属验收脚本问题，保留earlier-probe-failure.json，改从主窗口RPC校验失效会话，不掩盖失败。
- 仍未完成：Claude账号权限恢复后的真实模型验收、OMP隔离provider配置后的真实模型验收、Windows、跨轮候选关联已有成果。之前Codex真实自动采集通过，本轮未重复付费模型调用。未提交/合并/发布，未动正式应用。
