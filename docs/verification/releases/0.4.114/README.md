# Eas-Term 0.4.114

## 源码
- 干净主线基线 `d840885b4874f8e5d934d852ba070ee0481cfe35`。
- Mac/Windows/tag/main构建提交 `527b0bc17413143721297ae6feb6acf1d5e1c56d`，tag `v0.4.114`。不包含主工作树未提交文件。
- 新增任务清单锚定、两项UI遗漏，及上版后的对话/预览/首次发送调度/安全闲置恢复/依赖升级；详见release-notes.md。

## 验证
- check 3919通过、19跳过、0失败；build、renderer/helper/OMP自检通过；npm audit 0。
- 独立审查无剩余代码阻断；获取密钥改为设置modal内复用浏览器，不切视图、不丢草稿。
- 开发版实际验证：合并后闲置重建17项及技能库明暗主题；Jev45项、市场28项、抽屉15项见omitted-ui-20260927。
- Mac ARM/Intel正式包签名、Apple公证、staple和Gatekeeper接受；DMG/ZIP内app.asar与签名应用一致，两架构app.asar一致。应用和Electron Framework声明最低macOS12。
- 两架构正式应用隔离userData真实启动，60组preload、PTY回显、IPC、图谱分析、OMP18.1.2和JS错误检查通过；运行资源页面截图已核对。脚本临时副本移除既有--no-sandbox，不放宽正式包沙箱。
- Windows tag CI `36349081488` success，同SHA；安装包smoke、回收协议与系统/浏览器回归通过。settings-cleanup=true，Windows EXE本地SHA256与GitHub asset digest一致。

## 分发
官网五包逐个scp并检查size/SHA256，网页之后latest最后切换；公开页面hash、manifest、5包Range及113旧版入口通过。生产五服务PID/状态/重启数和七站HTTP均未变化，无reload/重启/删旧包。完整哈希见artifacts.json；回退备份见server-publish.json。
GitHub五包digest/size均与本地一致，Release已正式发布并设latest；双渠道结果见distribution.md。

## 边界与失败记录
- macOS12+；macOS11保持113，旧updater不会自动拦系统不兼容下载，首条更新说明已提醒。未做macOS12实体机验收。
- Intel为Rosetta，Windows为CI，不是实体用户机器；真实挂机一小时、多显示器、三家在线付费模型/TypeSafe真实登录未验收。
- 闲置策略保留不安全状态，必要时只GC；不是主进程全重启，不承诺固定RSS下降或零泄漏。
- Computer Use外部指针生命周期仍未解决；Windows未签名可能SmartScreen提醒。
- 初次开发启动缺Electron二进制，显式官方install后重跑成功；OMP切到同版本缓存并验证manifest SHA；Windows证据首次下载TLS超时，重试成功。临时验证脚本遇旧Python缺file_digest，改成流式等价SHA后完整重跑通过，不改产品逻辑/哈希标准。
- 未替换或关闭 `/Applications/Eas-Term.app`。
