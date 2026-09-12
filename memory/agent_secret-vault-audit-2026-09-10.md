# 2026-09-10 密钥调用链审查恢复

- 实际工作树：`.worktrees/voice-regression`，分支 `fix/background-render-budget`，基线 `ae8392d`。根目录 main 的其他改动未触碰。
- 用户目标：保存后模型能用密钥完成任务；值不进入模型/聊天/普通日志；确实缺失才弹窗创建；检查模型如何获知用法。
- 本轮完成：15 组源码发现；`docs/verification/secret-vault/audit-repro.mjs` 12 项隔离观察符合预期（含 1 个正常撤销对照）。这些断言确认当前缺陷/边界，不是安全验收通过。
- 复现全部使用假 Electron、临时假库和 localhost 假服务；包装器用真实 eas-secret.mjs。无真实密钥、无外部服务/模型调用。
- 已证实重点：无会话身份无法授权；已有变量新建冲突；名字授权导致改名失权/同名及重建串权；缺部分变量仍成功；通用 save 丢失文件类型且可变成文本注入；坏库被当空库并可被 setup 覆盖；wrapper 转发打印出的值；锁不能回收已注入环境。显式 forgetPty 正常撤销。
- 静态待端测：原生 Claude/Codex/OMP 端到端；OMP 指导禁用工具；显式注入与默认授权不一致；多组修正只授权首组；无身份取消共用计数；文件强杀清理与错误回显。
- 报告：`docs/reports/2026-09-10-secret-vault-sequence.html`，保留原 6 节、4 张 SVG，加审查、指导入口和多视角方案评审。已在当前 Frame 打开，节点 `cnode-90-ozwww`；多余旧预览已收，不动其他用户模块。
- HTML UTF-8、无外部依赖、锚点/唯一 ID 校验通过，结果 `docs/verification/secret-vault/audit/report-check.json`。AX 确认正文；截图时用户已切到其他 Frame，未完成全页/640px 眼验。不要声称应用修复或全量测试通过。
- 未改业务源码、未提交、未发版。本轮没有重跑应用构建和全量测试（审查交付，不是实现）。
- 下一步待确认架构方向：推荐严格受控业务操作；先 P0 数据/授权止损，再统一会话与状态/仅授权，最后可信执行。仅给原生 Agent 发取明文 token 不满足目标；无限制同用户 shell 与强隔离不能无条件同时承诺。应限定凭证引用、目标/操作/输出，禁止静默降级为任意 shell。
- 报告生成器首次直接执行仍报 Non-UTF-8（Python 3.9.6；完整 read_text 解码及 Unicode compile 成功），改成 ASCII 源码加 Unicode 字符串转义后执行成功，不把错误诊断成真实资料损坏。首次静态校验发现旧 SVG 共用 arrow ID，已按节加唯一 ID 后通过。
- Chrome headless 路径不存在（exit 127），未装新依赖。画布 snapshot 因没有用户选中工作区被拒，没有伪造选择；改用只读 CUA 检查。未全局杀 Computer Use 服务。

## 下次命令

在此工作树运行 `node docs/verification/secret-vault/audit-repro.mjs` 可再次确认旧缺陷。实施修复后需把“确认缺陷”的断言改成正式回归门槛，不能把此脚本直接当修复验收。

## 2026-09-10 20:55 用户补充狼人杀现场交接，覆盖此前待选方向

- 用户明确现有产品决策：Agent 可以经 eas-secret 使用密钥；这次是直接 Agent spawn 漏配，不要求新建受控业务代理。不要再把严格代理作为本次前置条件。
- 原文已当场保存到 docs/2026-09-10-werewolf-agent-secret-handoff.md。
- 本次限定修复：会话通行证 + 共享 shim/PATH；ctx.agentSessionId 优先归属；hasCredential 与真实 next；按 sessionKey 审计；正常/异常/关闭撤销；OMP 在 scrub 后注入且同步其禁用三工具的旧指导。
- 不允许业务 key 直接注入 Agent env、不允许 secret_check 回值、不允许主进程 secret_run(vars,cmd)。保留现有 Bash/cwd/沙箱/审批执行面。
- 实施前已核对：ensureSecretShim/prependPath 当前是 pty.ts 私有函数，需抽共享文件避免 session import pty 循环；OMP planOmpLaunch 确实先 ompBaseEnv 再 input.mcpEnv；session.ts 多处已有 revokeCapabilitySession，应逐一补取密钥票据撤销，不移除代次守卫。
- 必须额外防：旧进程延迟 exit 不能撤销新进程票据；同 session 重发票据须使旧票据立即失效；请求弹窗等待期间进程已换/死不能误授权新代次。OMP killAll/window close 不能漏 ACP（live.proc 不一定有值）。
- 已有密钥的仅授权表单仍必须补，否则 grantToPty 接 agentSessionId 后仍会在 save 重名处失败。hasCredential 不能混同 granted 或 unlocked。
- 3 条用户 e2e：Agent 节点 wrapper 只输出长度；已有未授权组经 GUI 批准后能用；关闭节点后旧 token 被拒。另需检查 Agent 初始 env 不含测试业务值、跨节点不能共享授权、旧 exit 不伤新票据。
- 当前仅接收交接与核对调用点，业务代码仍未修改。下一步直接按此限定范围写失败测试/实现，不再问严格/兼容选择。

## 2026-09-10 21:04 补充首次引导与就地解锁
新增要求见 docs/2026-09-10-vault-onboarding-unlock-requirements.md：首次启用统一介绍并设解锁密码；之后锁定直接弹窗，成功接回原请求，不叫用户翻找标题栏。沿用已落地 UI。解锁不能代替凭证授权，取消/迟到确认保持会话代次保护。现有后端六位数字码，待确认是否保持或改自定义密码。尚未实现。

## 2026-09-10 21:06 亮色配色审查
用户要求检查近黑重量、灰阶层次与舒适度，参考 Codex 客户端亮色。初审报告 docs/reports/2026-09-10-light-theme-audit.html。声明色值计算：#0d0d0d/白19.44，#8f8f8f/白3.23，#c4b5fd/白1.85。多个表面同白、边框4.5%/7%偏弱；.sec-var.isfile残留暗色浅紫。建议试柔化正文到#2b2b2b、拉开背景/内容，保留深色按钮，非正式定稿。没有产品眼验、没有主题源码修改。本机/Applications未找到Codex.app，官方页面未取得可验证截图；不得把建议值称为Codex官方token。

## 2026-09-10 用户确认解锁码形式
沿用六位数字码，覆盖此前待明确项。不改自定义密码；首次设置与确认，之后直接弹窗解锁并续接原请求。需求文档已同步，业务代码尚未实现。

## 2026-09-10 亮色参考范围确认
用户选 ChatGPT 本地选型台语料，最终明确“只参考配色”。保留 Eas-Term 字体/圆角/间距/布局/动效，不整套套用；原始语料保存 docs/2026-09-10-light-theme-reference.md。主题尚未修改。

## 2026-09-10 亮色配色已进入实现
用户批准方案后修改 base.css 亮色令牌（bg fafafa、s1 f3f3f3、t3 737373、边框6%/8%、背景渐变同步）及 workspace.css 亮色文件标签。保留正文、品牌、暗色、布局等。新增 lightPalette.test.mjs，先观察2项失败再通过；CSS平衡与accent检查通过，构建通过。图纸10追加契约。
隔离验收启动于端口9457，exec session20742；CUA按Electron路径仍抓到疑似旧用量验收窗口（截图底部0.4.90 dev，与本次0.4.92不符），未操作该窗口。当前亮色实际视觉验收未完成，不能宣称最终完成。未发版、未提交。后续先可靠定位本次隔离窗口再验证画布/设置/密钥柜。

## 2026-09-10 22:03 会话节点固定标题
用户确认：画布AI/终端不要下拉胶囊，改成下方网页节点图标+名称。PaneView.tsx 的 PaneKindSelect 已添加 canvas terminal/agent 静态分支，复用cfile-badge/cfile-title；分屏仍可切换。新增paneHeading.test.mjs先失败后通过，build通过。尚未实际眼验，尤其须检查cfile-badge负margin在pane overflow裁剪边界、标题flex与重命名文本关系，不要宣称完成。没有关闭或重启用户会话。

## 2026-09-10 22:27 角标裁切修复与眼验
用户截图确认AI角标被圆角裁切。根因网页cfile-badge负margin(-9/-18)与pane overflow:hidden冲突，未放开整个pane；限定pane-header角标margin0/居中22px，类型标题flex不吃满整行。2项测试通过，build通过。通过CUA在对应voice-regression out/renderer测试窗口Cmd+R刷新，截图已确认亮色AI与下方终端角标均完整、无下拉，节点名称回到类型旁。该实例0.4.92 dev，非正式发版。此前“点击无响应”未继续诊断，用户已成功创建测试节点。

## 2026-09-10 23:30 真正共用画布外壳
用户要求交互也相同并开始改。已撤销角标内缩补丁，PaneView画布非看板terminal/agent接cfile-node/cfile-head/cfile-body；直接命中canvas.css的整节点hover角标抬起、950ms边光，不另写动效。pane.cfile-node只开放外壳，body继续裁剪。测试更新先失败后2项通过，build通过，diff检查通过。CUA Cmd+R刷新正确测试实例，截图确认AI/终端角标外悬且不截断；点击AI内容空白，截图确认角标向左上抬起及边光。尚未完整验证拖动/缩放/暗色/减弱动效以及右侧按钮显隐；不能笼统声称所有交互全完成。未提交发版。

## 发布请求
用户要求提交发版。53700d0已commit并push origin fix/background-render-budget。未发布：全量check2873/2859通过/13跳过/1失败，真实POSIX Ctrl-C报native CLI not ready；定向重查日志/tmp/eas-release-pty-recheck.log。官网版本仍0.4.92，未改version/tag/latest或上传包。服务器只读df确认可用12GB，之前1.9GB记录过时。下一步排查测试并完成节点交互回归，再继续0.4.93准备，注意不要覆盖main其它工作。

## 2026-09-11 发布测试修复
全量默认并发失败、单文件12/12通过；并发4对照全量通过。package.json test固化--test-concurrency=4，不修改断言/超时/产品运行逻辑。修改后npm run check再次完整通过2873/2860pass/13skip/0fail。证据docs/verification/releases/2026-09-11-test-concurrency.md。公开发版尚未执行。

## 2026-09-11 0.4.93 官网已发布，镜像待收尾
产品b67eabd；main快进c32fabc，tag v0.4.93。五包目录~/Eas-Term-release/0.4.93-prep；Mac签名公证/stapler/Gatekeeper/双架构smoke通过，Windows34573939599成功。服务器五包与页面/latest已完成并核验，八站未变化。GitHub draft五包上传仍运行exec74141（functions cell34等待），uploads.github.com经过Clash但字节仍增长，未擅改代理。上传完核对资产digest再gh release edit v0.4.93 --draft=false --latest，然后记录。不要重复上传已有资产，不要提前称GitHub完成。

0.4.93发布收尾完成：GitHub五包上传完成，逐个size/digest与本地和官网一致，Release正式发布并设latest。没有遗留上传任务。官网/latest、Windows、Mac双架构均完成发布。密钥柜功能修复仍未实现，不因发版而变为完成。

## 2026-09-11 甘特图新任务
用户批准默认隐藏aborted并提供记忆开关。已实现GanttStage筛选及localStorage、主图/导航异常结束不再延伸now，保留记录及清空接口语义。新增taskVisibility工具与2测试，连同阶段测试17通过，typecheck通过。构建日志/tmp/eas-gantt-build.log。尚未实际UI验收、未提交/发版；0.4.93不含此改动。

## 2026-09-11 终端吸顶对比度
用户新增截图问题，TerminalView补minimumContrastRatio4.5，配置测试红绿通过，typecheck/build通过。已用隔离应用实际printf验证顶部深灰条+深灰字自动浅化；原Claude确切ANSI/滚动未验，dim仍遵循xterm弱化。未提交/发版。详情docs/verification/2026-09-11-terminal-sticky-contrast.md。词典选型台交互稿已开Frame，尚未接入正式产品。

## 2026-09-11 19:29后 · 密钥柜正式落地进行中
用户要求先做完密钥柜再排词典化。已实际改agent spawn/OMP/secrets授权/解锁UI/审计/长等待，非仅报告。详细文件及验收见docs/verification/secret-vault/2026-09-11-implementation.md。全量第3轮2879/2866pass/13skip/0fail，假柜+真实wrapper acceptance通过；实际建柜弹窗已看见，已异步请用户自行输入测试六位码，等待继续UI验收，未发版。测试当前verify-app --port9463，日志/tmp/eas-vault-final-verify.log，/invoke secret_check等待exec20780；不要读/打印码或生产柜。词典化P1记入docs/superpowers/plans/2026-09-11-secret-vault-completion.md，依赖密钥柜验收，不自动实施。原Gantt/终端contrast未提交改动仍保留。

## 2026-09-11 19:44 密钥柜弹窗视觉重做
用户认为当前UI丑，要求重新设计稿，popup时弱化下方画布。新稿docs/prototypes/secret-vault-popup-v2.html：首次介绍/六位码确认分步、日常解锁简化、已有密钥只授权；中性亮暗双主题，遮罩+4px blur+saturate(.6)，可切换对照。纯视觉不收密码，不改正式逻辑。等待用户审稿，旧UI验收不再当定稿。

## 2026-09-11 用户确认Popup V2后落地
新增VaultGate.tsx，手动SecretsPanel与AI SecretRequestModal共用两步六位码建柜/解锁，去掉旧重复介绍；vault-backdrop统一亮暗遮罩+4px模糊。build/typecheck、CSS balance、两个定向测试、fake-vault wrapper acceptance通过。CUA已在隔离应用验证手动暗色、手动亮色、AI触发亮色新弹窗，内容完整；关闭AI弹窗后背景恢复，/invoke返回用户取消。未输入新凭证，创建确认/解锁成功提交仍未实测，整体密钥柜验收未完成，未提交/发版。新样式与原稿对齐，管理器解锁后内容布局沿用原有。当前测试实例9463仍在，无密钥请求等待（89826已取消返回）。

## 2026-09-11 19:54 新增排期：暗色终端吸顶对比度
用户截图paste-20260911-195313.png，要求当前工作完成后修暗色吸顶看不清问题。不得把亮色minimumContrastRatio4.5及合成样例验证当暗色已验收。接手时检查真实ANSI前景/背景、dim弱化与canvas renderer，按用户截图位置前后对比；先排旧逻辑冲突，不叠颜色补丁。优先级：当前密钥柜收尾后处理，词典化后续。

## 2026-09-11 续落：异步提交与请求隔离
- VaultGate 增加同一渲染周期防重复提交与卸载后不续接，组件 handler harness 3 项通过（不是真实浏览器 E2E）。
- 复现并修复旧弹窗异步保存回调消费新请求：Host 绑定请求对象，resolve 校验身份。新增回归先红后绿。
- session-acceptance 再次通过：真实 wrapper + 隔离 fake vault，长度、授权、缺变量拒绝、轮换、关闭撤销及审计。
- 修改请求身份之前全量 check：2883 tests / 2870 pass / 13 skip / 0 fail；build 成功。最后修改后另跑 final-check/build，结果待日志核对。
- 未接触用户真实柜，未提交发版。真实 UI 六位码创建与提交仍需用户在隔离实例亲自完成，不能把组件测试称为真实 agent E2E。
- 最终结果：check 2884 / 2870 pass / 13 skip / 1 fail（codexCapabilityLauncher owned IPC config child 5 秒未就绪）；该文件未改，单测复跑 6/6 通过。独立 build 成功。已刷新隔离 Electron，亲眼看到最新首次建柜页与灰化模糊画布，留在该页供用户亲自输入六位测试码。不可称全量绿或真实 agent E2E 完成。

## 验收反馈：预设名称不随切换
- 根因 SecretsPanel 新增预设 handler 使用 `draft.name || p.label`；改为选择时同步 `p.label` 和变量列表。
- 新增 secretPreset.test.mjs 执行实际 handler，先复现 Lovart !== 阿里云，再通过；typecheck/build 成功。
- 最新隔离实例实际点击 Lovart → 阿里云，AX 确认名称及两项变量同步变化。未输入/保存任何密钥。
- 另观察到重载后审计区占较大空白，可滚动到表单；非本次名称修复范围，待后续检查布局。

## 对话图片 popup（用户确认后新增）
- ImagePopup 共享原生 dialog，MessageList 用户图/回复 Markdown 图点击打开，ChatNavView 同步复用。
- typecheck/build + 2 项组件 harness 通过。独立 Electron 测试历史中实际点两类图片、Esc、遮罩关闭通过；未调用模型。
- 图片专项实例 PID 67345，数据目录 /tmp/eas-image-verify-dir 记录。旧 verify launcher 31599 已结束、旧 app 退出；原隔离柜目录 eas-verify-Tn07Pu 保留，可重启继续验收。

## AI 产物默认交付所属 Frame
- 用户确认采用 MCP 显式提交 + 代码展示，不扫描回复路径。现有 canvas_open_file/html/image 统一 openArtifact，去重/复用/刷新/所属 Frame 校验。
- 内置 guidance 与工具描述已要求最终回复前提交本次明确产物，不自动开输入素材/参考文件。
- typecheck/build、10 项针对性测试通过。实际隔离 /invoke 指定 cnode-image-test，图片/Markdown 两次提交均复用原 nodeId，画布2/5；CUA看到两个预览。
- 未实际测 HTML 更新、脏文档延迟刷新及变更图片字节缓存；全量 check 正在 /tmp/eas-artifact-full-check.log，未发版。
- 本次全量 npm run check 退出码 0；实际失效 agentNodeId 打 open_file 被拒绝，没有错开到同项目 Frame。

## 继续收尾：审计区大空白
- 全局搜索确认 details 错用 sec-lock，继承 min-height:350px；改独立 sec-audit 紧凑折叠区，展开限高滚动。
- 新增 vaultAuditLayout 回归先红后绿；build /tmp/eas-vault-audit-layout-build.log。
- 将恢复原隔离柜 eas-verify-Tn07Pu；重启需用户自行解锁，不能读取六位码。未声称真实agent授权E2E完成。

## 2026-09-11 21:51 新消息工具组跑到上面
- 用户截图 paste-20260911-215043.png：新图/提问下有处理中，但工具继续挂前一段。
- 根因 reduce.ensureAssistantTurn 无条件复用 turns 最后项；新请求工具先于文字时回写上轮，而且手机 user.message 也能误承载工具。
- 新增2项失败测试复现；turn.start 记录上轮尾引用，ensure 仅复用本轮assistant；exec.done 不改仍按ID找。
- 定向测试/typecheck/build日志 /tmp/eas-turn-boundary-{tests,types,build}.log。未重载用户正在验收的会话，真实UI效果尚未验证。

## 2026-09-11 22:58 用户转交外部验收
完整结论已存 docs/verification/2026-09-11-acceptance/user-handoff.md，现有acceptance-report.html。多数主体通过，但首次建柜/已有组纯授权/关闭旧token未验，不能全部打勾。待修B2孤儿密钥弹窗优先（请求生命周期）；B3干净编辑态被刷新退出；B1编辑空白先保留cnode-10现场和证据排查；B4空格路径Markdown图片。未清理测试数据，未提交发版。

## 2026-09-11 用户授权“开始”：验收缺陷 B1–B4
在 voice-regression worktree 落地四项。B1 通过 CUA 打开原开发窗口 DevTools 只读控制台，确认旧 hash index-D5zBNlgU.js ERR_FILE_NOT_FOUND，语言 chunk reject 阻止 EditorView 创建。改为同步正文编辑器 + 异步高亮 Compartment，失败纯文本可编辑。B2 secretRequest 增 9 分钟内部超时清 pending/emit/reject（外层10分钟/shim15分钟）；超时不计用户拒绝。B3 artifactRefresh gate 同时保护 editing/dirty，clean editing 重提不再被踢。B4 Markdown 图片目的路径支持空格/尖括号，实体还原后重新转义 URL，不改 easfile guard。
定向9测试通过，完整 npm run check 2903/2890pass/13skip/0fail，build通过。原开发窗口PID77931已通过Cmd+R加载新构建；同一cnode-7上实际确认正文可输入、clean/dirty重提不丢，测试文字已撤销，磁盘213字节原文不变。原AI回复带空格路径图片已在同位置看到色块图，未重复测图片popup。B2真实9分钟测试正在跑（/tmp/eas-b2-real-timeout.json），别把等待中标成通过。
未提交/未发版/未碰生产密钥；架构03/10追加边界，详细复核 docs/verification/2026-09-11-acceptance/fix-followup.md。原用户报告保留。
B2收尾：原测试探针误用fetch，5分钟 UND_ERR_HEADERS_TIMEOUT（产品shim已是node:http不受影响）；没有重试原请求。继续等到9分钟后实际看到弹窗/遮罩消失，MCP日志显示明确超时/已关闭/重新请求文案。node:http新探针再调secret_check立即弹窗，取消后返回并清理，闭环通过。未输入六位码/未授权。当前开发实例已加载本轮renderer改动，未发版。
收尾已打开原空白节点cnode-10-4d3ii并进入编辑，CUA截图正文/行号/高亮可见，留给用户查看。注意原安全未测项仍不随本轮修复自动通过。

## 2026-09-12 设计选型台词典化 · 设计稿 V2
用户要求先设计稿，未授权真实功能开发。已新建 docs/prototypes/dictionary-design-picker-v2.html（独立内联HTML，不联网、不调用模型）；原稿保留。复用现有辞典“词条/蓝图”分段导航，新增同级选型台，左卡片右详情，默认只配色，提示词确认原生dialog与遮罩，亮暗切换。ChatGPT/Claude/Notion三套摘要来自 docs/design-system-picker/index.html，样机明确标为配色示意，次级表面补色标注，非产品截图/官方最新规范。真实发送和目标会话选择仍未接入。
已通过MCP打开当前frame-1-4s6wx并最大化 cnode-3-vygfd；新增时Frame满5项触发既有限额，自动移除最早1个内容预览（不删磁盘文件）。CUA实际验证卡片选择Claude更新详情、默认配色提示词、模拟发送不联网、亮暗切换，留亮色。初稿JS换行转义错误在node --check失败后修复，重新check通过并刷新同一节点，不以空稿交付。设计路由引用的 ~/.Codex/design-skills/visual-router 与 picker SKILL 路径不存在，因此按项目已有tokens/词典结构及本地语料落稿，未另装依赖。

## 2026-09-12 用户「落」：设计选型台 V2 已进源码
真实 DictView 第三页签 + 本地 307 套 JSON + DesignPicker；提示词复用 composerAddChip，不自动发消息。默认配色；完整范围是库摘要。开发版已构建打开、搜 Claude/选定/提示词/无目标禁用/实际 ChatGPT chip 附加验证；测试 chip 已清。dialog 居中问题现场修复并复验。check 2893 pass/13 skipped/0 fail，typecheck/build通过。亮色/窄屏/鼠标hover/真实模型发送未验。见验收 design-picker-implementation.md；未提交未发版。开发实例已停在真实选型台，正式版仍是旧代码与V2原型节点。

2026-09-12 02:50 用户要求选型更小、辞典三入口不能竖排：改760×540，卡片/间距缩小；共享头部搜索单独下一行，三个入口不收缩不换字。typecheck/build通过，开发实例实际截图确认词条360宽横排、选型缩小。未提交未发版。

2026-09-12 03:19 用户指出设计预览全是统一示意，要求实际选型台渲染封面。查明关键源在 ~/.claude/design-skills/design-system-picker（此前只找.Codex而漏掉）；完整 HTML 备份在 ~/Biily/cowork/设计规范/vechooool-backup。307条previewHtml全部存在，路径须相对备份/design-library。projects/<slug>/meta.json还有真实previewHtmlSrc和designKitSrc，原站入口应使用此映射而非只四个产品官网。见docs/design-system-picker/source-location.md。封面尚未渲染接入，不可说完成。

2026-09-12 03:24 真实干活：DesignPicker已用design-previews.json映射本地public/design-covers/*.jpg，不再统一Sample假图。307原HTML完成截图，304非空接入，3项vortex-gallery/aristidebenoist/three-html-to-canvas置cover空+reason，保留真实previewUrl。ChatGPT/ElevenLabs/Lime Remix原图人工看过对应。2测试通过/typecheck/build通过。离线renderer脚本scripts/design/render-covers.cjs；起初builtin require错误、窗口销毁SIGTRAP修复为复用窗口、mac恢复弹窗阻塞用单进程-ApplePersistenceIgnoreState YES解决。最后CUA两次120秒超时，没能刷新开发实例验收，不可称全部完成。未提交发版。

## 2026-09-12 设计类型筛选落地
在 voice-regression worktree 新增独立 interfaceTypes 分类及UI筛选，307条初分，9条待确认，桌面无确证暂空。typecheck/build及4项单测通过；CUA已恢复，实际刷新开发实例并验证手机端17/307及底部CTA可见。未提交发版。分类依据保存在数据 classificationNote，28条组件暂沿源标签，其余按原始封面人工初分。
