# 2026-09-08 Git 历史与分屏修复交接

用户先批准交互原型，后说「OK刚才的修改直接执行吧」。已按版本管理原型落地源码；不应把此话误解成在真实用户仓库执行 Checkout。

## 本轮源码（根工作区，尚未提交/打包）
- `src/main/gitHistory.ts`：真实 Git checkout/branch/tag/switch，脏工作区拒绝切换；historyFiles 支持双提交、根提交、重命名、二进制行数为空。
- git.ts 的新 IPC 写入口验证 cwd/root/git-dir/common-dir 均过 guardDir；preload 同步；commitDiff 支持 base/origPath。
- HistoryView 右键检出/分支/比较/标签/复制，确认、错误与返回分支；文件 A绿 D红 M黄 R蓝，增删行数；旧 Reset 保留原确认。
- gitExec 加 windowsHide 防新 Git 命令弹控制台；Windows 本轮 UI 尚未真机验证。
- tabsSlice 分屏 agent 只复制 kind/cwd，回到新启动页，不带 session/resume/initialMessage/draft/owner 等。4 个回归测试；构建并隔离 Electron 截图验证通过，证据此前在 /tmp/eas-split-start-proof。
- docs/architecture/10、13 同步。本轮没有触碰根工作区其它原有 dirty 文件。

## 验证入口
`npm run check`；`npm run build`；`node scripts/verify-git-history.mjs`。
真实临时 Git 仓库与真实 Electron/preload/IPC，绝不检出用户仓库；截图/结果在 docs/verification/git-history/。
交互原型仍在 docs/prototype/2026-09-08-git-history.html，不要当作真实软件功能页。

## 重要：之前正式发版仍未结束
0.4.87 冻结 worktree `.worktrees/release-0.4.87`，branch release/0.4.87，commit 3b5f1a5（source84d6a98）。包含可选笔纵容错、OMP登录、图片FIFO、badge边缘光，不含本轮 Git/分屏、不含私测日志回传。
Windows Actions34305247596成功，exe在 ~/Eas-Term-release/；Mac 两架构第二轮打包、公证、smoke已通过（/tmp/release87-dist2.log、/tmp/release87-smoke-*-final.log）。第一轮symlink node_modules漏safe-regex已通过真实APFS克隆目录解决。
发布 worktree 的最后一次全check曾失败codexCapabilityLauncher时序测试（/tmp/release87-finalcheck.log），必须核对/重跑，不能引用更早绿色结果掩盖。
线上还未更新；server仅有隐藏目录 /www/wwwroot/eas-dl/.stage-0.4.87/ 下 Windows exe。未上传Mac、未更新官网/latest、未打tag/main合并。
下一次发布操作前先读 ~/.Codex/servers/INDEX.md 再读相关机器档案；逐文件scp与大小/hash核验，包先落地、feed最后切换、不删除旧版、不无必要重启服务。
私测容错最早在0.4.85-diag.2；正式首个计划版本0.4.87。不要把0.4.86写成已含该修复。

最终验证：npm run check 2791项，2779通过、12跳过、0失败；最新构建成功；隔离Electron 15项断言通过。未执行Windows UI与新安装包构建，未commit/push。本轮实际截图预览 docs/verification/git-history/preview.html。

## 21:30 PDT 正式发布进行中（仍未上官网）
用户再次说「发版」，已将根源码50163de提交，并合并至release/0.4.87。冻结产品源更新为9e3af6bbb16d30ae95305b471986b649d6ea2ca4：Windows实际CI发现fs.realpathSync保留RUNNER~1短名而Git返回runneradmin长名，目录guard误拦。独立Windows只读探针34311024303/job102337544007确认；仅Windows改fsGuard.realResolve为realpathSync.native，保留symlink/junction与授权根检查，新增回归红→绿。
最新完整check：2794项/2782通过/12跳过/0失败，/tmp/release87-native-check.log。
Windows最新构建34311214941在跑；前两次34309925243（EBUSY遮住错误）、34310496797（真实检出被guard拒）均不可发布。测试脚本3af36c9以后保留原始错误、条件等待UI、只taskkill所属进程树、异步重试清理。旧code产品b756e62的Mac虽已全部通过签名公证smoke/GitUI/badge但已过期，输出移至~/Eas-Term-release/.superseded-0.4.87-before-native；最新Mac重打日志/tmp/release87-native-dist.log。
服务器当前0.4.86。旧候选隐藏stage .stage-0.4.87-b756e62里四Mac包已核hash但现在过期；发布必须用新stage .stage-0.4.87-9e3af6b。/tmp/eas-stage87.py逐文件scp+hash+size，新记录/tmp/release87-current-uploaded.json；/tmp/eas-promote87.py五包核验+备份四live文件+先包后页面/feed，尚未运行。旧hash前置条件仍0.4.86；新manifest路径是eas-dl/latest.json不是eas/latest.json。
服务器路由~/ .Codex/servers此前缺失，已补~/.Codex/servers/INDEX.md与39.105档案链接既有~/.claude/servers；已读旧档案并补8.4G磁盘/0.4.86现状。操作完必须补发布记录。未经额外确认不替换本机/Applications/Eas-Term.app。
