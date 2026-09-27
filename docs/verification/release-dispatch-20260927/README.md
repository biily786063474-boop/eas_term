# 发布阻断修复：协议终态 / 陈旧启动许可

基线 `origin/main af5f16f6`；专属 worktree `/tmp/eas-term-release-dispatch-20260927`，分支 `fix/release-dispatch-terminal-20260927`。不修改 root/release 既有工作树，无提交推送。

## 根因与边界
- P1：Claude 的真实 `result.is_error=true` 翻译为 `turn.done interrupted:true`，旧释放条件 `!interrupted` 留住 dispatchKey；持久 stdin 进程不退出，后续消息被拒且占全局容量。修复将「事件来源」与「轮次结果」分开：只有当前协议流终态有资格释放；synthetic stop/UI repair 仍无资格，停止后等 close。
- P2：资源许可后等待全局 dispatch，等待期间进入 critical，原实现直接 spawn。最终 validate 同步复验同一交互资源门；尚未投递时延后通过类型化错误退还旧租约/dispatch，再进原资源队列。不是模型重试，不消费额度，无新增默认超时/出站/安全权限。

## TDD 证据
- `p1-red.txt`：4 项中 1 失败，`is_error=true` 后 dispatchKey 实际仍 `s:1`；其余停止保留测试已通过。
- `p1-green.txt`：4/4。
- `p2-red.txt`：critical 在 dispatch 等待中出现后，spawn 实际 1，期望 0。
- `p2-green.txt`：恢复 / 取消 / 会话销毁三条实际 manager+dispatch 路径通过；70 秒是受控 manager 时钟，非真实 OS 压力或墙钟浸泡。
- `targeted.txt`：首次联合回归 34/35，旧 AST 沙箱夹具未注入新增 SessionStartupDeferred 类，得到 ReferenceError，非生产错误；补齐该夹具依赖后重跑见 targeted-green。
- `check.txt`：首次 check 在 typecheck 阶段失败。复用 root 旧 node_modules 缺最新 MCP SDK shared/client 模块且有代理 agent 类型不匹配；未绕过门禁，待干净依赖复跑。

## 未验证
真实 Claude 在线账号/模型回执、真实 OS 内存压力、Windows，以及外部 Computer Use 指针清理均不能用本次测试声称通过。fixture 使用真实翻译器/会话函数/队列，进程边界为 EventEmitter；不冒充真实 Claude CLI E2E。

## 最终验证（Node 22.23.3 + 发布树 npm ci 干净依赖）
- `check-clean.txt`：`npm run check` exit 0；typecheck + 四项静态检查 + 全量 3860 tests：3841 pass、19 skip、0 fail。
- `build.txt`：`npm run build` exit 0（有项目既存的构建 warning，未隐藏）。
- `targeted-green.txt`：联合 35/35。
- GUI：`scripts/verify-app.mjs --port 9547` 无 seed、独立 userData，清除父会话 EAS_* 连接环境与 ELECTRON_RUN_AS_NODE；真实构建打开「设置→运行与资源」，见 `gui-runtime-focused.png`。并发选项 2、间隔至少 1 秒、CPU/内存读数、无虚假任务/服务可见。`gui-runtime.txt` 为 DOM 文本。首次后台截图 `gui-runtime.png` 合成器未刷出设置页，Page.bringToFront 后重拍且已亲眼查看；不以旧截图作验收。
- GUI 仅是构建/资源页面 smoke，**未覆盖真实 Claude 协议错误或 OS critical→dispatch**。启动日志明确 Claude loggedIn=false，未调用任何模型。两条缺陷靠前述真实生产函数行为回归证明，不把此页面 smoke 说成在线 E2E。
- GUI 未修改源码；收尾只向本轮 CDP 9547 所属 verify-app 父进程发送 SIGINT，使其清理自己创建的子进程/临时 userData，不影响外部服务或正式应用。

收尾复核：verify-app 36256、Electron wrapper 36259、Electron 36270 均已退出，9547 无监听；脚本先删目录后 Electron 退出时重建了少量本轮 userData，确认进程全退出后仅清除上述确切临时目录。独立 reviewer 已向父会话确认 P1/P2 无剩余代码阻断。原 `.log` 的完全相同副本已去重，只保留 `.txt` 证据。
