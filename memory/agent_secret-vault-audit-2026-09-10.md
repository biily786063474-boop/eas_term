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
