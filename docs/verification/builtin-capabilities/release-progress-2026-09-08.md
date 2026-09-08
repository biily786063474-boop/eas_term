# 顺序发布进行记录

用户已授权先发布笔纵、再发布 Eas-Term，并要求在笔纵仓库留痕。不能把本记录当作最终验收通过证明。

## 笔纵

- 实现提交 ff7ef7c；审查修复日志损坏拖垮旧 API、undefined 结果误判 unknown、跨进程半写记录问题。
- v1.21.30 的 Windows 门禁发现测试错误：误把 POSIX 0600 当作 Windows ACL 判据。未上传生产安装包或更新清单，标签保留。
- 修正提交 f0cc166；v1.21.31 发布提交 3f271bc，Windows run 34209466550 成功。
- 本机协议测试 19/19，原有报价 5/5、计费边界静态检查 33/33、模型模式兼容 30/30。
- v1.21.31 Mac 正式候选包隔离启动、旧接口调用和重启查询 3/3，codesign 校验通过。安装包、更新清单与官网入口已上线，完整服务器 SHA256 与本地一致，公网 HEAD 200 且长度正确。原脚本完整 GET 的 30 秒超时保留为网络观察，未把它当作下载成功。
- 家庭云未挂载；相同 DMG 已成功另存 GitHub Release，GitHub 返回的 SHA256 与本地一致。发布留痕提交 f9f2d17 已推送笔纵 main。
- 真实生成测试只取得报价：Z-Image Turbo 1K 单图 4 墨水，等待用户批准，未生成或扣费。测试项目 proj_1788860120369_phecu0，节点 node_1788860120602_nxpmtf；已恢复用户原项目。

## Eas-Term

- 候选版本 0.4.85，尚未发布。完整检查最近一次 2709/2709、0 跳过；后续审查修复待最终全量检查。
- Bizone 已通过同一个 HostRegistry 接入正式 MCP 客户端、运行探测与持久防重 guard；Windows 通过原生 bzone 协议路径发现安装，不执行注册命令字符串。
- AI 三端 selected stdio 使用同一规范化快照，静态凭证不进入 argv；远程业务插件保留原生兼容路径，不声称 HTTP/SSE 已跨三端统一。无法安全转换的原生 stdio 工具限制明确报错。
- 精确旧规则迁移已接到真实 workbench 成功调用；按 fsGuard 验证项目，完整备份并记录事件，失败不影响已成功工具结果。第三方全局 MCP 配置保留。
- 第一签名 Mac 候选包中 Claude/omp 新建、恢复、重启恢复均取得真实调用及正确 Frame。Codex 因通用文件工具需原生审批被拒；新增真实安全边界的 canvas_open_image 后重新打包验收，不降低审批策略。全局 .claude.json 并发哈希变化保留为归属不明观察，测试进程写禁止已实测。
- Computer Use 外部指针生命周期问题仍开放，本次不宣称修复。

## 冻结与后续验收

- 实现提交 52f1d93；OMP 终端配置修复 a17772d，已推送功能分支。尚未合并 Eas-Term main 或发布更新清单。
- 最新全套测试在并发 4 下 2722/2722 通过，0 跳过；先前无限并发的一次启动等待超时保留原记录，单项与受控全套复核均通过。
- 专用图片入口在签名候选包上已通过 Codex 新建、恢复、应用重启三轮实际调用与图片解码。随后新增 OMP 终端配置修复，当前产物需要重新冻结和构建；旧候选不能代替最终分发包。

## a17772d 正式包结果与 Windows 阻断

- Mac arm64/x64 签名、公证、staple、Gatekeeper、DMG/ZIP 完整性通过；139 out 文件与 18 MCP/bundle 资源逐项一致。哈希与实际证据见 frozen-a17772d-acceptance.md。
- arm64 三端 AI + PTY 新建/恢复/应用重启恢复 18 阶段通过。Claude 首次 PTY 在 init 后出现 api_retry 后超时，保留失败；同包重跑三阶段通过。Codex 一次运行无最终报告不计通过，完整重跑三阶段通过。
- Intel 包在 Rosetta 第二轮六项设置点击/IPC/持久化检查通过，首轮无调试端口的失败保留。
- Windows run 34216597763 构建、实际启动及内置设置六项检查通过，安装 artifact 摘要核对一致；没有真实登录模型调用。
- 独立审查确认 Windows npm-only CLI 被 .cmd 启动拒绝，且检测显示已安装；默认关闭的自动更新不能补救。该问题阻断 Eas-Term 发布，补充计划 2026-09-08-windows-cli-launch.md 正在执行。修复后必须重新冻结包。
- Eas-Term 线上仍未切换；笔纵发布完成不受此 Windows Eas-Term 启动器问题影响。

## Windows 启动补丁及取消复核

- b6f71a6 共享 Windows CLI 解析器：官方 npm 元数据与 native/JS 入口校验，AI/PTY/探测同源；a49643a 提交候选包实际证据和迁移验证器。Windows run 34221294425（a49643a）构建、正式包冒烟、Windows resolver 实际 fixture 子进程、设置检查全部成功，未执行 Publish to Release。
- 独立评审发现 Codex dispatcher 进程树取消与包来源环境问题；ace9020 修正 native 选择、来源根与互斥标记，本机2733通过/4Windows跳过/0失败。该提交首推发生 GitHub TLS 连接失败，后续须重推核实。
- 复核继续发现 Eas-Term 自有外层 launcher 在 Windows 取消时的 native 清理缺口，以及旧 vendor helper PATH 丢失；正在补明确所属的控制通道及旧布局资源路径，不采用全局杀服务。尚未满足发布门禁。
- b6f71a6 的另一次 arm64 包公证遇到 Apple HTTPClientError.connectTimeout，保留诊断；它本来也不是经过最终审查的包，不作发布产物。

## 9510ff2 独立复核与正式包重验

- ace9020 与 9510ff2 已成功推送；Windows Codex 直连原生入口、包来源与旧 vendor PATH、所属 launcher IPC 取消/断连清理经过两轮独立复核，无剩余重要审查项。
- 本机完整套件总计 2752：2742 通过、10 个 Windows 专用项跳过、0 失败；build/typecheck/renderer entry/computer helper/omp bundle 均通过，验证器另 6/6。
- 最新 Windows run 34235219068（9510ff2）成功；Mac arm64/x64 均完成 Developer ID 签名、公证及 staple。产物完整性及三个 Windows artifact ZIP 摘要均独立核对通过，安装 EXE 已安全提取并另算 SHA256。
- Claude 与 omp 的 AI/PTY 各三阶段全部通过；Codex AI 三阶段及迁移、重启幂等、确认应用退出后的离线回退通过。Codex PTY 随后三阶段也通过，最终 AI + PTY 共 18/18 阶段。
- Intel 包首次设置检查未取得调试端口，保留 /tmp/eas-reviewed-settings-x64.log；同包重新运行六项设置检查通过，并已人工查看截图。未修改产品或降低校验以得到通过。
- Eas-Term 尚未发布；真实付费断线防重测试的 4 墨水报价批准，以及 Windows 已登录 CLI 实机条件仍待用户回复。

- 9510ff2 完整证据已汇总至 reviewed-9510ff2-acceptance.md 与 releases/0.4.85.md；独立证据复核仅发现迁移文档旧待完成措辞，已改正。2026-09-08 再次只读核对线上：Bizone 1.21.31、Eas-Term 0.4.84。

## 真实付费断线测试

用户回复“好测试一下”批准既有4墨水单图报价。正式笔纵1.21.31隔离包实际收到生成后，代理断开响应；生产Eas guard认领同一request，重建guard后仍无第二次提交。生成服务最终error；账本1466 -4、1467 +4为匹配消费/退款，净0。付费测试未产图，保持部分通过/整体未通过。完整证据 paid-recovery-9510ff2/README.md；没有把源码宿主测试说成Eas GUI付费E2E。用户原应用未替换，隔离应用确认退出后删除复制的加密登录文件。

## 用户授权按当前范围发布

用户已获知失败部分为真实产图、Windows登录CLI为未测，随后明确回复“那就发版吧”。开始发布0.4.85，保留公开限制，不将缺项标为通过。使用9510ff2已验证的五个包，先上传并核验SHA256，再切换官网与更新清单；保留0.4.84回退。

## 0.4.85 生产已切换

发布提交0cec8d9已快进合并main并打v0.4.85标签；产品源码与9510ff2冻结包无差异。五包远端SHA256一致后才切换三个页面和latest.json；公网页面逐字节、包HEAD/Range验证通过，七站301保持，未reload/删旧包/替换用户本地实例。备份 /www/wwwroot/eas-release-backups/0.4.85-20260908T145135Z；完整证据 ../releases/0.4.85-live.json。GitHub五包备份正在进行。
