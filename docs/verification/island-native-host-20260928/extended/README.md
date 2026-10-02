# 扩展验收 2026-09-28

## 实际通过
- 打包产物20次原生宿主 ready→EOF 退出，5类非法协议输入退出码2，两独立宿主中杀死一个不影响另一个：共26项，lifecycle.json。
- 缺失/损坏资源清单启动失败退出码2：2项，invalid-assets.json。
- 专属测试父进程异常退出后，通知子进程101ms后消失：parent-death.json。只操作验收进程，没有全局杀服务。
- 真实Codex会话续聊返回FOCUS，原有ALPHA/BRAVO/RECOVERED/CLEANUP重启后历史可读。
- 外部TextEdit输入焦点：展开收起5次，逐次AX确认焦点仍在文稿；前后输入完整。证据focus-input-proof.rtf含四行测试字符串，没有私人内容。测试草稿已移回本地证据目录，没有留在iCloud文稿目录。
- 外部TextEdit原生全屏：展开通知、继续输入、忽略通知后焦点仍在文稿；已退出全屏并关闭测试文稿。截图SCStreamErrorDomain -3811，只有AX交互证据，不声称全屏视觉截图验收通过。
- 更新页点击检查更新，无正式版本下载入口出现；代码Lab gate拒绝正式更新。界面提示“已经是最新版本”不准确，应提示实验版不参与正式更新（未修的低优先级体验项）。
- 打包codesign --verify --deep --strict通过；bundle ID com.biily.easterm.islandlab，主App arm64、helper arm64+x86_64，最低系统12.0。这不是Intel/macOS12实体运行验证，也不是DeveloperID公证发行。
- 资源清单仅4项，CSP connect-src none/frame-src none，未加入外部资源。源代码隔离门禁检查不冒充网络抓包验证。
- 本轮41项专项通过；完整check3982项，3964通过18跳过0失败。无产品代码新修改，无提交合并发布。

## 未覆盖 / 当前不能称全面通过
- 真实一小时连续闲置与长时间CPU/RSS曲线：需要受控长时窗口，不拿假时钟结果冒充。
- 休眠唤醒/锁屏会打断当前用户工作，未执行；实体多屏、Intel、macOS12、Windows需要对应环境。
- Claude/OMP真实登录后的模型任务未验；不复制其他配置或凭证。
- 岛内直接审批被有意禁用，尚不具备功能对等；需请求版本绑定后另行实现。
- Computer Use外部服务生命周期问题仍遵循项目发布限制，本轮未宣称修复。
- 五次通知开合和四行输入只是确定性回归，不是全天输入压力或无缺陷证明。
