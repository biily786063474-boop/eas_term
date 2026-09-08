# OMP 原生登录 UI 与输入光标 · 2026-09-08

状态：实现已落地，未发版、未替换 `/Applications/Eas-Term.app`。

## 已确认并修复

- 用户确认 UI 原型后实现供应商选择、原生浏览器授权、手动备用、API 密钥、成功、失败与取消；供应商列表不再截断 60 项。
- Google 的原生浏览器回调仍由随包 OMP 创建；Eas-Term 未自建回调服务，也未复制 token 交换/刷新逻辑。
- 解析器跨 chunk 更新快捷链接、`https:` 分块误报 prompt、重复问句消失、stdout/stderr 混合半行等问题。
- 旧进程迟到输出/error/close 不串到新登录；提交/取消按发起窗口隔离；窗口销毁收所属进程；stdin 异步错误明确失败。
- 成功判据为保存标记 + close(code=0)，不在 exit 时抢先判定；终态清授权地址/指令/输入。
- 登录原始输出不再进 console/IPC 历史，只保留错误类别。浏览器链接只允许 HTTPS/本机 HTTP；手动内容保持文本，不做 HTTP URL 强制校验。
- CodeMirror 原来沿用默认黑色绘制光标；现在亮暗主题分别近黑/近白，2 px，另加强聚焦边框，不重挂编辑器。

## 实际调用证据

- `native-callback.json`：正式应用内 OMP 18.1.2，两个 Google 分支分别创建 `/oauth2callback` 与 `/oauth-callback` 本机入口，得到 Google 授权 URL 和本机 launch 快捷入口。均会同时提供手动输入，UI 将其折叠。
- 注入**故意错误的 state/假 code**只打到所属本机回调：原生返回 HTTP 500。错误页无 state 特定说明，因此不能宣称完成 state 校验验收，更没有完成真实 OAuth。两笔隔离进程已结束，临时目录已清理。
- 已核对上游 tag v18.1.2 的 `packages/coding-agent/src/cli/auth-broker-cli.ts`：无可依赖的结构化 login JSON 事件接口；保持原生进程，不杜撰新协议。**源码文本与随包二进制的手动回填表现不完全一致，实际二进制为本次运行证据。**
- `ui-login.json` 与 `google-native-{dark,light}.png`：构建后的隔离 Eas-Term 真窗口，Google 登录保持等待回调，备用可展开，取消后明确显示已取消。
- `ui-cursor.json` 与 `cursor-{dark,light}.png`：真实 CodeMirror 接受 CDP IME 组合并提交“你好”，输入 @ 后候选仍出现；主题切换保留文字。光标实际计算样式：暗色 rgb(245,245,245)，亮色 rgb(23,23,25)，均 2 px。
- `providers-dark.png`：实际动态供应商列表界面，不是原型截图。

## 测试

- 新增解析器分块、重复提示、协议安全、设备指令、错误脱敏回归；遍历授权文本的每个切分点。
- 控制器 fake-process 测试覆盖旧进程竞态、窗口所有权、提交阶段、close 排空、错误退出、EPIPE、多行输入；真实随包 MiniMax 原生输入/取消测试。
- React 实际组件 SSR 检查原生回调+手动并存、设备码、密钥遮挡、未知提示和终态隐私。
- typecheck、全量单测、build、CSS 括号/动画/强调色检查。最终数字见 `test-summary.txt`。

## 尚未通过的完整验收

未替用户登录 Google 或其他供应商账号；未做真实 token 交换、保存、续期、模型请求。不能宣称“所有供应商已验证可登录”或“Google 账号登录失败根因已全部解决”。无 Windows 交互真机验收。没有自动升级/修改 OMP 依赖，也没有触碰用户已有凭证。

## 回退

代码、契约、样式和架构说明作为同一变更回退；无新数据库格式，无迁移和凭证搬运。正式包保持 0.4.85，只有明确发版/安装授权后才替换。现有用户规则、第三方插件、权限和未提交改动保留。
