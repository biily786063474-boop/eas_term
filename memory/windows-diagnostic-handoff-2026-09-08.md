# Windows 诊断私发包（2026-09-08）
用户批准独立诊断Windows安装器，只给本人转测，不上官网/Release/正式更新。
已交付目录：~/Downloads/Eas-Term-Windows-Diagnostic-0.4.85-diag.1/
隔离源码：.worktrees/windows-diagnostic，分支 diagnostic/windows-0.4.85；基线v0.4.85。不要合并诊断身份配置到main。
详细验收、服务维护链接：.worktrees/windows-diagnostic/docs/verification/windows-diagnostic/README.md
CI 34256071566成功；应用源提交c7d1c327dd60efb308fe2e6a556cf991a3c54a63；内层exe SHA256 ab5b9925aff1ed774c886305c7d51fd6165a02d8a90666ae8aadca096d9054d9。
日志每次确认后发送至自有eas.biily.top；服务器SSH别名server，eas-diagnostics服务，数据/var/lib/eas-diagnostics/<编号>.json，14天留存。无聊天/命令/密钥/原始路径，上传<=256KiB，新增本地诊断<=10MiB。
下一步：等测试者复现及报告编号再排查。原始闪退尚未复现/未确认根因；不能称修复。CI检验真实win-unpacked运行和NSIS构建，未手动执行Windows安装向导或登录模型对话。测试前退出正式版（系统CLI配置共享），可并存安装。

## 11:34 PDT 更新：diag.2 已交付
用户要求把可选笔纵MCP不阻塞OMP的修复重新打exe。新目录 ~/Downloads/Eas-Term-Windows-Diagnostic-0.4.85-diag.2/（旧包保留）。
冻结基线不变，只cherry-pick b6d1ced；CI 34262389800全通过，源码0a1350d8e808c59f741d10be6f17df5cc86b0361。
Windows真实OMP+本地固定模型回复、诊断回传/启动退出均通过；不含main并行登录UI改动。
exe SHA256 3e8d3d0caa9fb7fdd4d088a732841e66e5eea85ca1676d3c270521dd90c66f54。
详情 .worktrees/windows-diagnostic/docs/verification/windows-diagnostic/windows-diag2/README.md。仍未发官网/Release。
