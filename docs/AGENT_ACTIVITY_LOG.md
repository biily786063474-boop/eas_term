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

## 2026-09-18 插件市场统一接入 · 阶段 A 开始
用户批准原 Demo 32 项及统一能力设计，分支 feat/plugin-market-unified-20260918（沿用隔离 worktree）。已新增宿主要求校验/目录透传，安装前与 commit 前接线；21项相关测试及 typecheck通过，build通过，完整测试进行中。远程 MCP/OAuth/v2目录和32项尚未实现，隔离应用未验，未发布、不动正式应用。见 memory/plugin-market-unified-2026-09-18.md。
后续结果：全测试3265项，3247通过/18跳过/0失败；build与typecheck通过。隔离UI仍未验证，代码保留未提交状态。

## 2026-09-18 03:00 可见轮询与兼容性验收
已挂当前Frame进度HTML节点 cnode-81-o6swz，长命令每5秒更新，终态明确停止。打包requirements限v2、安装真实IPC边界3测试通过；全check3251通过/18跳过。隔离UI显示明确版本错误且不下载测试包，截图已查看。远程连接/OAuth/32项接入未完成，未上线。

## 2026-09-18 远程MCP协议基础
锁SDK1.30.0；endpointPolicy 4测试+真实本地HTTP协议测试通过，包含并发connect合并/不重放写请求。全check3256通过/18跳过/0失败、build通过。还未生产接线/真实供应商授权，不声明mcp.remote能力。审计18项告警逐节点比对旧lock均已存在（含tar critical），风险记录于dependency-audit-2026-09-18.md，未强制升级。

## 2026-09-18 03:19 远程插件网络适配
真实TLS与HTTP CONNECT隧道测试通过：目标固定IP、原域名证书校验、拒绝未信任证书、16MB流限额。系统代理策略/发包前策略共6测试通过。全check/build继续由同一画布进度节点汇报。尚未生产接线，OAuth与元数据阶段总超时待补，fake-IP默认拒绝；不宣称完整远程接入。

2026-09-18 插件统一接入：DNS/PAC取消和15秒准备期限，2项红测转绿；不混称CONNECT总超时，远程宿主/OAuth仍未接线。
同轮续：响应头60秒期限覆盖CONNECT/TLS；真实不响应代理测试从红到绿并验证socket关闭，取消不只停Promise。完整回归重新覆盖最终代码。

2026-09-18 插件OAuth本地回调基础：3项HTTP集成测试与typecheck通过，完整检查进行中；没有接入真实供应商或读取现有用户凭证。必须继续provider/密钥柜/宿主接线，不能以此报OAuth完成。

2026-09-18 OAuth SDK授权码编排：PKCE统一SDK单一来源，隔离回调与token服务器验证，取消后迟到token拒绝；未接生产账号/密钥柜/宿主。完整回归在原节点运行。

2026-09-18 持续执行：专属加密凭证与锁定租约、授权单飞/取消晚到防复活、no-auth远程宿主和shared shim接线、普通升级失败回退、确认后manifest防变更、v2不可安装原因与离线缓存状态。最终npm run check：3313项/3295通过/18跳过/0失败，build通过；隔离应用4项验收通过，截图已亲眼查看待接入无安装按钮和999版本门禁。尚无32插件/真实平台授权全量完成结论，继续推进；不发版、不改正式app。

2026-09-18继续：补token持久有效期扣减与同账号SDK刷新单飞，取消/断开晚到refresh不得落盘，专项15项及typecheck通过；持续目标active，后续不再等用户逐条说继续。完整检查仍按可见节点运行。

2026-09-18 OAuth宿主链路：显式public-client descriptor、exact-resource Bearer、过期刷新不重放、锁定关闭所属连接、main-owned runtime。新增8项回归；check 3324项/3306通过/18跳过/0失败，build通过，隔离市场4项眼验通过。OAuth登录IPC/UI及真实账号未完成；正式app/凭证未触碰，未发布。继续既有active目标。

2026-09-18：账号状态/连接/断开已接guarded IPC及完整市场UI；native确认后校验已装清单未改变，renderer无凭证。3327项检查3309通过/18skip，build通过，隔离应用6项及截图眼验通过（锁定状态与三按钮；非真实账号成功授权）。截图已交Frame，目标仍在进行，未发布。

2026-09-18：测试连接走共享宿主资源准入，临时引用finally释放，只读工具列表；状态/清单变化不报迟到成功。全量3329项/3311通过/18skip，构建和隔离UI7项通过，截图已眼验并更新Frame。真实账号、32插件及独立更新验收仍未完成。

2026-09-18：活动宿主/启动准入期间禁止包替换与卸载；失效该插件pending授权；按插件前缀清理所有配置/账号密文，不解锁、不碰其他插件。3331项检查3313通过/18skip，build及7项隔离市场回归通过。实际安装IPC与临时FS测试通过，真实用户升级卸载/账号未验，未发布。

2026-09-18：独立双目录构建接入，legacy/requirements隔离、严格清单校验、同版本字节不可变、目录分别原子落盘；全量3334项/3316通过/18skip，build通过，真实CLI两次构建及zip哈希/大小复核通过。只本地，不发布；默认仍两已有包、不是32接入完成。

### 2026-09-18 插件市场：独立双目录发布安全链
- 新发布入口必须 --publish；本地先校验快照，远端互斥/不可变版本/逐文件SCP大小hash核对，保留旧目录后分别原子晋升。
- 8项本地专项通过；只在临时文件系统演练生产POSIX命令，未连接生产机，未更新正式app。
- 目录两文件非事务、未知SSH结果不重试、残留锁人工核对，运行边界落盘 publishing.md。全量检查/构建进行中。
- 最终check/build退出0：3342项，3324通过/18跳过/0失败；进度节点已落真实终态。未发布。

### 2026-09-18 独立更新：补真实用户入口
- 隔离同PID验证暴露市场没有刷新/更新入口，已接版本元数据、数字版本比较、刷新目录、确认更新；不提供内置包/未知版本/降级更新。
- fixture使用临时homedir适配+受控网络和OS沙箱；原生HOME隔离导致的CDP超时另有日志，不冒充UI通过。
- 全量check/build/UI验收1609进行中，未发布。
- 最终22531退出0：3344测试/3326通过/18skip；build通过；同进程更新UI13项+旧授权兼容UI7项通过。截图亲眼核对，右列溢出红测已绿，Frame cnode-106-hn6rb展示。没有生产发布。

### 2026-09-18 Wikipedia 候选 + 版本真实性
- 新增实际stdio搜索/导言候选包、零第三方运行依赖，官方API出处/署名/许可说明落盘；自写适配器非官方MCP。
- 包→解包→实际宿主McpClient→子进程工具列表通过，实际查询因DNS返回Clash fake-IP 198.18.0.76被公共地址策略拒绝（19631退出2，livePassed=false）；未放宽安全规则、未计已可用、未上默认目录。
- installStage拒绝包内版本与目录版本不一致；实际IPC红绿测试+构建应用UI版本谎报拒绝/旧版保持通过。
- 85554最终check/build/UI退出0：3349项/3331通过/18skip；UI14项；随后新增网络边界专项再跑5项全部通过。未上线。

## 2026-09-18 插件目录路径对齐（开发分支）
- 按已批准方案把builder/publisher/test/说明对齐`/plugins/v2/registry.json`；两个同名目录的暂存/备份分离，首次v2目录创建和本地符号链接拒绝。
- 专项13项通过，实际CLI连续两次构建并逐包size/SHA256核验通过；全量check/build退出0，3352项/3334通过/18skip/0失败。
- 隔离应用热更新回归进行中；未上传生产、未切在线源、未改正式app，32插件/APIkey配置/真实账号仍未完成。
- 最终隔离app回归14项通过（fixture同样使用`/plugins/v2/registry.json`），截图已眼验并刷新Frame原节点；全部监测结束。生产HTTPS/CDN、真实账号、32连接器不在此通过结论内。

## 2026-09-18 统一配置声明第一阶段
- 实际pluginManifest保留严格config字段声明，config.fields能力门禁；宿主对尚未接通配置运行时的手动安装包失败关闭，不带默认/空配置静默启动。
- 两处类型检查失败已记录并修正，完整check/build/隔离应用回归正在监测8261；不提前标通过。
- APIkey存储/软件表单/目录授权/安全注入仍待实现，32插件未完成，未发布。
- 最终完整重跑通过：3357项/3339pass/18skip/0fail，build成功，隔离热更新14项通过并眼验截图。配置UI尚无，不能把旧市场回归当配置体验完成；无生产发布。

## 2026-09-18 配置密文存储层
- 配置与OAuth独立密文类型/文件命名空间，复用加密租约、原子写、固定目录，卸载同插件清理覆盖两类。
- 专项先红后绿；完整检查构建与旧热更新回归监测43254在跑。
- 尚无配置控制器/IPC/UI/注入，仍不算用户功能完成；未访问真实密钥、未发布。
- 最终3360项/3342通过/18skip/0fail；build及隔离热更新14项通过，已眼验截图。没有配置UI验收或新增真实连接器可用证据。

## 2026-09-18 配置主进程接口与软件表单
- guarded plugins:configuration / preload / 原生默认取消确认 / 配置控制器 / 主进程scope hash与密钥柜存储已连接；只返回字段已保存状态，密钥不回显。保存前检查活动宿主和确认期间描述变更，目录文本授权拒绝。
- 软件内配置按钮、密码输入、保存/刷新与锁定提示已构建打开。第一次截图截掉表单，滚动同卡片重截图后眼验；发现锁定读取失败不能显示“未配置”，改为状态未知，最后类型/构建/UI监测21307在跑。
- 5414全量通过3362项/3344pass/18skip/0fail，构建和10项UI通过；期间额外确认变更测试单独3项通过。真实解锁保存/目录picker/宿主注入与32插件仍缺，未发布。
- 最终21307退出0，类型/构建及11项隔离UI通过，截图眼验状态未知和锁定提示并更新Frame；所有监测结束，未生产发布。

## 2026-09-18 本地文件实际纵向接入
原生目录选择/确认、grant加密、stdio专属配置注入、锁定关闭，接自写local-files list/read/write。实际市场安装→真实safeStorage→实际宿主→三真实shim→临时文件读写/越界拒绝/锁定后禁止调用，13项通过；原生对话框返回值与下载目的地受控，非实际模型CLI或生产验收。默认v2新增本地文件，v1保留两包。
全量两个Codex时序夹具失败已保留，专项23项复跑通过，build/local-files13/compat11通过，全量待重跑；未生产发布。无凭据复制或修改正式app。
- 最后全量复核通过3367项/3349pass/18skip/0fail；保留上一次两项Codex夹具失败及专项复跑23通过记录。看板/番茄钟真实子进程业务回归成功，证据existing-business.json。无生产发布，完整32目标未达成。

## 2026-09-18 插件配置确认代次与敏感日志保护
- 两个红测复现后补 lease 覆盖 native await，以及配置插件 stderr/握手诊断隐藏。
- 实际隔离app（17项本地文件、11项兼容UI）和完整check（3369项，3351通过/18skip）通过。已构建并眼验；不是32插件全部接入，也不代表真实模型、上游账号、Windows或生产上线通过。
- 校正13号图纸仍称目录授权未接的过时说明，天气/钉钉来源条件落原清单；目标active，无后台残留命令。

## 2026-09-18 远程Bearer与GitHub候选
- 已接secret引用清单、密文scope+lease、exact-resource Bearer到真实共享宿主，三实际shim/受控HTTP测试通过；GitHub官方远程候选包打包通过但未上架/未真实账号验收。
- 初轮类型检查失败已记录于memory；修正后build+隔离兼容UI11项通过，完整check3374项/3356通过/18skip。
- 用户要求完成再汇报；后续只执行与可见轮询，不在每个增量后发送阶段性总结。目标active，配置连接测试/清除UI仍待补。

## 2026-09-18：配置测试与清除接线
配置卡片增加共享宿主测试连接、原生确认断开清除；插件级租约同时撤销runtime与pending确认，重新授权独立。实际隔离app本地文件23项/兼容UI11项通过并眼验；全量首次PTY夹具native CLI not ready失败，未改断言，专项12项与完整3377项复跑通过（3359通过/18skip）。证据local-files/result.json；远程Bearer实际app/真实上游/模型CLI/Windows仍未完成，无生产发布。

## 2026-09-18：Bearer软件配置纵向验收
新增真实隔离应用脚本verify-bearer-plugin，13项通过并眼验：密码保存密文、共享宿主三shim、清除/重新配置/锁定。仅自有网络fixture/原生确认适配，非GitHub真实账号/TLS/模型CLI证明；未发布，未改生产代码。

## 2026-09-18：Word真实连接器候选
新增离线独立Word包与锁定构建链、22依赖许可；创建/读取/跟踪修订真实pack子进程通过。隔离应用真实市场安装、加密目录、三shim生成DOCX和清除/锁定23项通过并眼验。复杂Word排版/Word渲染/真实模型/Windows未验，未纳入默认市场。全量3380初过；后续解压流量防护4专项过，最终全量7518正在跑。中间许可收集及旧stream不支持async iterator失败已如实记录并修正。

## 2026-09-18 插件设置面板最终验收

- 最终轮询任务 33796 退出 0：npm run check 共 3381 项，3363 通过、18 跳过、0 失败。真实隔离应用回归：本地文件 28、兼容与授权界面 11、Bearer 13、Word 23、热更新 14 项全部通过。
- 已亲眼查看最终紧凑市场、独立设置面板暗色与亮色截图：卡片图标/标题顶对齐，不再因配置表单拉伸同排卡片；Esc 仅关设置并将焦点还原到入口，保留键盘焦点环。
- 中途热更新首次卡片等待超时已保留失败证据；增加诊断后连续两次完整热更新通过，不能据此宣称瞬态原因已根治。
- 此批为开发工作树落地与隔离应用验证，未替换正式 app、未上传发布；32 项全量供应商接入、真实三 CLI 模型调用、Windows 及正式目录迁移仍不计完成。

2026-09-18 hover rail: 68592 exited 0. Local-files 32, compatibility 11, Bearer 13, Word 23, hot-update 14 checks passed. Actual pointer hide/reveal, purpose tooltip, unchanged geometry and keyboard focus restoration verified. Built isolated app screenshot inspected and refreshed in current Frame. No formal app replacement or release. Full 32-provider goal remains incomplete.

2026-09-18 full-height hover panel: 68209 build passed but immediate tooltip assertion failed (pointer hover reveals purpose tooltip). Verifier now waits for actual browser tooltip visibility, not a fixed sleep. 6563 exited 0: local-files 34, compatibility 11, hot-update 14. Idle/hover screenshots inspected: default full content width, hover end-cap full height/right corners, centered entry, unchanged card bounds. Current Frame screenshot refreshed. No formal app replacement/release.

2026-09-18 v2 source acceptance: 49895 exited 0; full check 3386 total / 3368 pass / 18 skip / 0 fail. Built actual isolated app hot-update 17 checks passed, including source-bound cache persistence, offline rejection of unbound legacy cache, old cache preserved. Screenshot of offline market inspected. Production catalog endpoint not deployed or verified; no app replacement/release. Initial 6 VM import failures fixed by loading actual source helper into test harness.

2026-09-18 更新前声明权限/目标差异已接 stage->preload->确认框，旧manifest未知不报无变化。全量3388/3370pass/18skip；实际旧manifest边界9项过；构建并实际app增强热更新18项过，截图已验。期间fixture误用canvas_snapshot导致安装被拒/等待超时，修正为允许的canvas_open_url，无生产安全放宽。32项接入未完成，未发布。

2026-09-18 Word表格增量验收：初始红灯“参数无效”；实现矩形表格生成/顶层单元格读取、修订保留表格。28586 可见轮询退出0：全量3391/3373通过/18跳过/0失败，构建成功，实际隔离应用市场安装→加密目录→三shim表格往返/撤销锁定26项通过。后补两项边界与复杂表格测试，专项7/7通过（不冒充已包含在此前全量统计）。已查看配置面板截图；真实Word渲染、模型CLI、Windows、32项全量接入仍未完成，未替换正式app或发布。

2026-09-18 远程插件输入框分类：全局搜索唯一旧判定遗漏remote，专项先红(app !== plugin)后绿，三CLI禁用/绑定边界保持。81278全量3394/3376通过/18跳过/0失败；UI脚本旧preload锚点因usage字段插入而失败，恢复源码和构建成功。锚点收窄至const api后10501完整真实隔离应用160项通过（受控清单/发送，无真实推理）；远程插件chip截图已亲眼核验，脚本退出时已恢复源码且重建成功。32项仍未完成，未发布或替换正式app。

2026-09-18 OAuth发现基础：上一轮d1de829属于实质进展，当前继续已批准远程授权方案。核验Notion/Sentry官方AS元数据均支持S256/none/注册端点/CIMD；PRM根路径网页工具未取到，不推定不存在。新增oauthDiscovery显式资源/issuer绑定、预批准origins、64KB流式限制、15秒总时限、无凭证/禁止重定向、path-aware OAuth/OIDC与404回退。先模块缺失红，专项4项绿，后补2项共6项绿。35429全量检查退出0（统计见本次日志）；未接manifest或授权按钮，不冒充Notion/Sentry已接入。下一步：401 metadata解析、客户端身份策略与存储、实际宿主接线及账号验收；仍无发布。参考文件 docs/verification/plugin-marketplace/oauth/discovery-2026-09-18.md。

2026-09-18 动态客户端注册串联：上一轮476c11d为实质进展。新增authorizeDynamicPlugin，与既有PKCE/本地回调共用同一redirect URI，拒绝secret/回调变更/非none，注册POST不重试、晚返回取消丢弃。红灯TypeError后专项通过；78680全量3403项/3385通过/18跳过/0失败。62932构建与实际隔离市场/账号配置11项回归通过，截图亲眼查看（是旧UI回归，不是动态供应商登录）。动态身份持久化及manifest/按钮接线仍未完成，因此未启用或上架Notion/Sentry；下一步将clientId与tokens原子绑定到加密scope、刷新复用该clientId。未对真实服务商注册、未发布或替换正式app。

2026-09-18 动态身份原子存储：新增dynamic-oauth version3加密信封，clientId/tokens同文件保存，静态OAuth/config命名不变。新增3项真实临时文件+AES-GCM租约测试，验证重载/有效期扣减/作用域换密文/保存中锁定不覆盖旧文件/无临时残留/单scope与插件清除。先saveDynamicAuthorization缺失红，专项及57726全量检查退出0。存储方法尚未由动态runtime消费，撤销异步授权结果需后续manager接线验证；未宣称账号登录或32项完成。未发布、未修改正式应用。

2026-09-18 动态授权管理：上一轮fabc19f为实质进展。新增DynamicAuthorizationManager消费动态身份存储，配置hash绑定scope，登录single-flight/刷新复用存储clientId/保留旧refresh_token；主动登录取消旧刷新，close/disconnect/密钥失效阻止迟到落盘。先模块缺失红，5项专项纳入38650全量3411项/3393通过/18跳过/0失败。尚未接动态连接runtime、manifest和登录按钮，无供应商账号验证；下一步接createAuthenticatedFetch的动态凭证读取及撤销关闭，再接宿主工厂。无后台进程遗留，无发布或正式app修改。

2026-09-18 动态MCP连接runtime：上一轮e538c07是实质进展，本轮新增DynamicAuthorizationRuntime复用authenticatedFetch发送边界、动态manager与密文token读取。先模块缺失红后3项专项通过；4430全量3414/3396通过/18跳过/0失败。实测边界包含重建runtime从AES-GCM磁盘记录恢复clientId并刷新、不重新注册、精确URL拒绝、401不重放、disconnect/lock/close使全部活动连接失效。未接pluginAuthorization工厂/manifest/UI，非供应商账号或真实模型CLI证明；未修改正式app或发布。下一步显式dynamic manifest分支及工厂连接、发现与批准端点一致性，再实际隔离UI端到端。

## 2026-09-18：插件动态OAuth纵向与供应商候选
工作树 feat/plugin-market-unified-20260918：bd74793 将 dynamic manifest、发现校对、DCR、系统密文、共享宿主及账号UI串通。真实隔离app13项+旧兼容11项通过，截图已眼验，修复已连通仍说尚未测试。Notion/Sentry候选只保留官方公开地址，未上默认目录、未声称真实账号可用。两次检查失败（测试文件类型、启动器5秒夹具超时）均保留证据；未触碰正式app/其他会话进程或发布。

## 2026-09-18：优先补插件——网页抓取
按最新用户要求，不以用户登录阻塞工程。新增web-fetch真实stdio插件、离线解析bundle/许可证、安全网络和默认v2构建入口；实际隔离市场下载安装+三shim抓取7项通过，已眼验。98240全量3425项/3407通过/18skip/0失败，实际本地双目录构建v1=2/v2=4。公网DNS拒绝原样记录，不宣称公网成功；未动正式app/未发布。其余插件继续逐项推进。

## 2026-09-18 Excel基础包
新增离线XLSX读/创建/按SHA256更新，实际构建与市场安装→配置→三CLI shim→真实文件验收26项通过，专项6项通过。复杂表编辑拒绝、公式不计算边界明确。默认v2本地构建加入基础包，尚未发布；完整Demo图表/透视能力仍欠缺。

## 2026-09-21 PowerPoint基础接入
隔离工作树新增离线PPTX创建/读取/文本编辑包，三shim实际业务与撤权29项通过，5专项通过。
依赖audit首次2high原样保留，image-size覆盖版本后audit0，未修改根依赖。
实际构建打开验收并眼验截图；未发布、不宣称完整32项或视觉保真。
最终66918全量3437/3419通过/18skip/0fail+双目录2/6+实际PPT29项通过。
同版本归档防覆盖曾拦截Excel，按实际内容变化升Excel1.0.1；PPT补活动关系防改名绕过，
同步升1.0.1，未删旧包、未削弱校验。所有本轮子任务已结束。
