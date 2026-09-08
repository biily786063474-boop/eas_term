# 0.4.85-diag.1 私发诊断版验收

基线 v0.4.85 (0cec8d9)，独立分支 diagnostic/windows-0.4.85。用户批准独立 appId/数据目录、不发官网或 Release、本人确认后回传、服务器14天留存。

## 当前证据

- 干净基线：2752项，2740通过、12跳过、0失败。
- 修改后完整回归：2761项，2749通过、12跳过、0失败。类型检查及构建通过。
- 9项诊断单测：白名单/异常清洗、硬限额、启动标记、gzip、拒绝无网络、回执/超时/重定向、持久重试、身份/接线。主进程VM测试加了真实 diagnostic sink 依赖，原断言保留。
- 接收端5项测试，本机Python3.9和服务器Python3.6.8均通过；包含真实HTTP、幂等/冲突、权限、大小/压缩炸弹、存储上限和清理。
- Mac实际构建运行：独立数据目录、PTY真实启动/退出、诊断导出、隐私入口；仅使用 inspector 替代原生确认按钮的返回值，不替代业务链路。确认发送后真实 HTTPS 返回编号1b4fc7db-8ac2-49e1-b92c-e02ef8f8f2eb。无账号模型调用。
- 通过SIGKILL只终止测试脚本自己启动的Electron主进程，磁盘运行标记保留，第二次启动提示未正常退出；正常退出删除标记。没有全局杀任何Computer Use服务。
- 接收端 /var/lib/eas-diagnostics 报告落盘0600，loopback服务约10MiB内存；官网HTTPS五站200，HTTP六站状态前后相同。latest.json SHA256仍为512235157534c4cb31f0653bbfcb97ae5af78b07921b3f3df7b8a91307584f0f。

## 未验与使用注意

Windows CI与运行验收已通过（见下）；原用户闪退根因尚未确认，不能称修复。原生dump不采集，瞬间native崩溃只能据上次运行阶段缩小范围。

诊断版与正式版可以并存安装，但系统CLI及其工作台接入配置仍是共享的，测试时先退出正式版，不要同时运行两版；测试结束后重新启动正式版。独立数据目录不自动复制聊天/项目，测试者需在诊断版重新添加项目并使用原本CLI登录；不要删除正式版数据。

Computer Use生命周期问题仍开放，不作为本测试包已修复项。

## 首次 Windows CI（34252378073）

d5e70cb 的类型检查、NSIS构建、9项诊断单测及实际启动/PTY/OMP冒烟均通过。诊断扩展验收在首个 Runtime.evaluate 超时，checks为空、未进入业务断言，不能算验收通过。调整仅在测试脚本：不在Electron bootstrap realm求值，改在真实out/main/index.js入口断点的CommonJS call frame中注入原生按钮返回值；应用代码和验收断言不删不改。修订脚本在Mac实跑再次全通过，待Windows复跑。

## 第二次 Windows CI（34253167577）

应用入口断点已工作：独立身份、数据目录及桥接检查通过；随后仍有 Runtime.evaluate 超时。构建/单测/普通冒烟继续全通过。为区分具体IPC/原生对话步骤，下一次只增加验证脚本逐步EVAL跟踪与失败时最后30条结构化事件，不改应用、不延长超时、不跳过断言。

## 第三次 Windows CI（34254123277）与工作假设

逐步跟踪已确认超时发生在 `pty.create`，不是回传请求或同意弹窗；同一个包在无主进程调试器的普通冒烟中正常开终端和回显。node-pty 的 Windows ConPTY 会创建真实 Worker 来读取管道；测试启动带 --inspect-brk，工作假设是 Worker 等待调试器导致同步创建等待管道。下一轮在验收脚本启用 NodeWorker 调试协议并明确释放 waiting debugger 的 Worker，增加真实 Worker ready 断言，不改应用和PTY实现。Mac 同脚本再次通过；Windows结果待核实。此假设不等同于用户原始闪退根因。

## 验收拆成两个真实运行阶段（第四轮34255072126后）

NodeWorker协议下独立Worker能ready，但ConPTY仍在pty.create超时，没有pty-started；不能把Worker等待假设写成已定位根因。移除该实验性调试干预。改用同一exe、同一userData、同一cwd分阶段验证：先不带主进程调试器真实起PTY、等回显、关闭并确认IPC可用；SIGKILL该测试实例后，再通过主进程调试器只代答原生确认，报告必须含前一阶段实际PTY日志。原有PTY/导出/回传/异常退出/正常退出断言全部保留，并新增真实回显断言；应用源码不变。Mac新流程已通过，Windows待复核。带调试器下的ConPTY阻塞作为测试环境限制保留，不等于用户闪退原因。


## 最终 Windows 验收通过（2026-09-08）

- Run 34256071566 / job 102162093453 全部成功，源提交 c7d1c327dd60efb308fe2e6a556cf991a3c54a63。
- 同一实际打包exe：无主调试器PTY启动/回显/关闭、独立数据、正式更新禁用、取消、导出、真实HTTPS回传、异常退出下次提示、设置入口截图、正常退出清标记全部通过。原生按钮由测试调试器代答；未验证登录后的模型对话或用户原闪退复现。Windows无人值守CI没有执行NSIS交互安装，仅构建安装器和验证其win-unpacked应用。
- Windows报告编号 3e7e3631-0d9f-46fa-9907-9453a6ddca22，服务器确认文件877字节、0600，接收服务active。
- Windows截图已人工查看，证据见 windows/result.json 和 windows/runtime.png。
- 安装器artifact 10068104727 外层zip SHA256 a36c7a842152b8d02fea2de767a1219198dbb951574142bf14d5f5f81320e294。
- 验收artifact 10068100098 外层zip SHA256 a9de57cbf080de5c08eaa63f524ed5c96f0234f34ea190f7cc2b2121abfdc79b（本机校验一致）。
- 仅工作流artifact，不建Release、不打标签、不更新官网；保留独立分支与worktree，不合并正式版。

## 本地交付文件
安装包已下载并核对外层zip及内层exe，均一致。内层exe SHA256：
ab5b9925aff1ed774c886305c7d51fd6165a02d8a90666ae8aadca096d9054d9
大小190059412字节（约181.3 MiB）。SHA256SUMS.txt为Windows CRLF，Mac校验时临时去CR，不修改原始校验文件。
交付目录：~/Downloads/Eas-Term-Windows-Diagnostic-0.4.85-diag.1/，含exe、SHA256SUMS.txt、测试说明.txt。

下一步：等测试者复现后发报告编号；在自有服务器 /var/lib/eas-diagnostics/<编号>.json 核对（14天留存），结合步骤与时间分析，勿称原闪退已修复。服务维护/回滚见 deploy/diagnostics/README.md。
