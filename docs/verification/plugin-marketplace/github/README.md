# GitHub（只读）插件验收 · 2026-09-30

分支 `feat/github-plugin-readonly-20260930`，基线 main `d9f506bd`。用户决定：先上只读版；验收用用户自己的细粒度只读令牌（经 Eas-Term 密钥柜录入，没进对话）；同意隔离实例使用系统加密；同意放宽宿主对代理 fake-ip 的拦截。

## 1. 只读模式在真实账号上生效（`/tmp` 探测脚本，令牌只进请求头）

| 地址 | 工具数 | 服务端标为非只读（`readOnlyHint:false`） |
|---|---|---|
| `https://api.githubcopilot.com/mcp/readonly` | 27 | **0** |
| `https://api.githubcopilot.com/mcp/`（默认） | 45 | 18：`create_pull_request` `push_files` `delete_file` `merge_pull_request` `create_or_update_file` `issue_write` 等 |

只读地址下 `get_me` 真实调用成功。注：不带令牌时服务端对任何路径都回 401（先查认证再路由），所以只读是否生效只能用真实令牌验。

## 2. 市场全流程（`scripts/verify-github-plugin.mjs`，结果 `result.json`，17 项全过）

真实：隔离 Electron（sandbox-exec 拒读 `~/.claude` `~/.codex` `~/.eas` 等）、真实市场 UI 两段式安装、真实配置表单 + 系统加密、真实 shim 子进程 → 宿主 → GitHub 官方远程 MCP（真实 TLS、真实账号）。
替身：包下载地址重定向到本地候选目录；原生确认框自动确认。

1. 隔离密钥柜建立并解锁
2. 候选市场列出「GitHub（只读）」（宿主已声明 `mcp.remote` / `auth.bearer`）
3. 安装确认列出网络权限 `api.githubcopilot.com`（`install-confirm.png`）
4. 确认前没有落入插件目录
5. 两段式安装完成，装的是只读地址
6. 令牌经系统加密落盘，文件里没有明文
7. 保存后密码框不回显
8. 测试连接通过（真实服务，27 个工具）
9. 经宿主列出的工具没有一个被标为写操作
10. 工具里没有 create / update / delete / merge / push 类
11. AI 调用路径（shim）`get_me` 成功
12. 关掉插件后已绑定会话调用被拒
13. 重新打开后重新连上可以调用
14–16. 卸载成功、插件目录删除、本机保存的 GitHub 令牌文件清除
17. 应用日志里没有令牌

## 2b. 替用户验收：按真实用法走一遍（`scripts/verify-github-plugin-chat.mjs`，结果 `chat-result.json`，全过）

用户要求「你替我验收」。按用户真实用法操作，真实鼠标点击、真实 Claude Code 对话、真实 GitHub 账号：
1. 从候选市场装上「GitHub（只读）」，保存令牌，测试连接 27 个工具。
2. **Frame 右键「插件」→ 点「GitHub（只读）」** 新开一个绑定 GitHub 的对话（`chat-0-plugin-picker.png`）。注意：输入框里 `@` 选插件**不能**接上插件（未绑定时是灰的），这是产品现有设计。
3. 让 AI「查令牌对应账号、能访问的仓库、最近更新的仓库最近 3 次提交」：AI 调用了 `mcp__github__get_me`、`mcp__github__search_repositories`、`mcp__github__list_commits`，
   列出了 eas_term 仓库 2026-09-30 22:39–22:55 的 3 次真实提交与提交信息（`chat-1-read.png`）。对话底部显示「GitHub（只读） · 本会话插件」。
4. 让 AI「在这个仓库建一个 Issue」：没有调用任何写工具，回答「插件只给了读取类工具，没有任何能创建 Issue 的工具」，且没有改用 gh / git / 网页绕过（`chat-2-write-refused.png`）。
5. 应用日志里没有令牌。全程没有出现审批卡片。两轮对话约 $0.65 Claude 额度。

观察到、未改：
- AI 在第 4 步末尾建议「在插件配置里打开写入类工具」——插件没有这个开关，是 AI 自己推断的说法。
- 只调了几次查询工具的回答下面也显示「已执行但未建清单 · 让 AI 补建」：执行清单把 MCP 工具调用算作「执行过」，对纯查询略显多余（执行清单的判断规则，与本插件无关）。

## 3. 验收中发现并修复：代理 fake-ip 被当内网拦

第一次跑到第 8 项报「DNS 包含非公开地址」：本机 Clash TUN 用 fake-ip，把 `api.githubcopilot.com` 解析成 `198.18.0.240`，宿主屏蔽 `198.18.0.0/15`；
走系统代理时宿主也先校验本地解析，并用解析出的 IP 去 CONNECT。国内开代理的用户因此一律连不上。按用户拍板：
- `endpointPolicy` 放行 `198.18.0.0/15`；其余内网段照拦（新增测试逐段列出：10/8、172.16/12、192.168/16、127/8、169.254/16、100.64/10、保留与文档段、组播、IPv6 本机/唯一本地/链路本地、IPv4 映射的内网地址），fake-ip 段两侧的公网地址不受影响。
- `networkPlan` 走系统代理时按域名 CONNECT，本地 DNS 结果不参与连接、不再校验；直连照旧校验；代理不会绕过 origin 白名单。
- TLS 按域名校验证书不变。

## 检查

- `npm run check`：4301 项，4282 通过、19 跳过、0 失败（typecheck、check-i18n、图纸体量等全过）。
- 插件连接层 + 远程宿主 + 各插件测试 147 项全过。

## 未验证 / 另记

- 真实对话只验了 Claude Code；Codex、omp 走同一个 shim，未在真实对话里验。
- Windows 未验。
- 安装确认弹窗的通用文案「插件可运行本地程序」对纯远程插件不准确（它不在本机运行程序），未改。
- `plugins-store/wikipedia`、`web-fetch` 自带的地址策略仍拦 fake-ip（均未上架；Wikipedia 策略生成脚本自 i18n 迁移后已坏，见 13 号图纸）。
- 未发布到线上市场；需随含 `mcp.remote` / `auth.bearer` 能力声明的宿主版本（0.4.120）一起上。
- 测试令牌仍在用户密钥柜「GitHub 只读测试令牌」，7 天到期。
