# 独立全新 macOS 测试环境 · 2026-09-22
用户要求真正没有旧数据的新电脑环境，不能只隔离 Electron userData（仍会探测宿主 CLI/auth）。

已安装 Homebrew openai/tools/tart 2.37.0 + softnet 0.23.0（仅 trust 指定 softnet formula），创建 Apple 官方 macOS 26.6.2（25G83）VM `eas-clean-macos-20260922`，位于 `~/.tart/vms/`，4CPU/8GiB/50GB虚拟磁盘/1440×900。不带 --dir，启动带 --no-clipboard --no-audio，不复制任何宿主数据。

已完成：恢复安装退出0，启动running，Computer Use截到首次欢迎页。随后窗口关闭、run退出0、tart list stopped；不反复抢用户窗口。未进入桌面、未创建本地账号、未安装 Eas-Term 或真实 CLI，下一步是用户在 VM 里设置本地测试账号（不在聊天里收集密码、不登录AppleID、不Migration），之后保留基线再验收。

可双击 `docs/verification/clean-machine/打开全新测试电脑.command` 重开。文档与日志 README.md/create.log/run.log/first-boot.png 同目录。画布进度报告 docs/prototype/2026-09-22-clean-machine.html，frame-9-pd0nj 节点 cnode-91-0y69e。轮询结束，无残留下载任务；VM当前停止。

下载曾约1MB/s走Clash代理：按全局playbook，仅 updates.cdn-apple.com 精确DIRECT + DNS定向，源rules/merge/运行配置三处同步并HTTP204热重载。原件旁0600 .eas-ipsw-20260922.bak，敏感配置不入仓库。验证DIRECT后约14MB/s。经验已追加 ~/.claude/playbook/网络排障-代理卡死.md。没有改宿主全局代理/DHCP。

宿主剩余约73GiB；VM实际约23GB，IPSW缓存约19GB保留，不自动删除。所有工程改动未提交，本任务没有更改 src，不碰已有脏工作树。

## 13:47 更新（任务仍在进行）
实际根因已改判：先前几次 Tart stopped 与受管 exec 前台 session 在用户新消息时被中断有关，非用户关窗。VM 现由用户 LaunchAgent `com.biily.eas-clean-vm` 独立运行，PID 78679，RunAtLoad=false/KeepAlive=false，已跨工具调用稳定；临时包服务 `com.biily.eas-test-package` PID79141 仅绑定192.168.64.1:8765。两服务完成后精确 bootout，不碰全局进程。客体 FileVault 锁屏，等待用户在虚拟机内输入密码；不可读/索取密码。
测试包来自待验 worktree、signed+notarized，zip SHA256 cfa5cf030de49ba1d69ec916e0ec4e79d24aa7a993fd70257d4479f92f5924ee。客体尚未安装应用、无CLI未验证、基线尚不存在。脚本 `docs/verification/clean-machine/trial_manager.py` + `.command` 本地mock测试5/5，不能冒称真实reset验证。完整日志 README.md，计划 docs/superpowers/plans/2026-09-22-repeatable-logged-out-vm.md。

## 14:02 再更新
VM LaunchAgent 稳定运行，用户解锁。用户自己在客体从官网下载并启动常规发布版 Eas-Term 0.4.105；待验构建尚未传入/安装。源客体已被 app 首次运行污染，不得直接封未登录基线。已通过选项卡询问基线要待验构建（推荐）还是发布版0.4.105，等待回答。客体中文输入法使Sky type_text输入URL错误；不要用未证实的HTTP传输当成功。临时测试包服务与VM LaunchAgent均仍运行；完成/取消后精确bootout和清理，不全局kill。

14:25 更新：待验 ZIP 已通过客体 Safari 下载并解压，用户同意后公证构建已在隔离 VM 启动。旧版曾先运行，首次引导没弹，源 VM 不能直接封干净基线。新构建设置/AI 对话页面实测 Claude/Codex 均未安装且各有安装弹窗、命令透明；安装执行尚待用户对 Computer Use 安装行为的当时确认。全量 npm check 3514 pass/18 skip/0 fail。证据及详情见 docs/verification/clean-machine/README.md。
