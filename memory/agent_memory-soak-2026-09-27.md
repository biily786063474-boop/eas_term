# 无账号内存测试交接 · 2026-09-27
用户原问：没有16GB设备且Claude未登录，能测哪些；确认先测不发版，随后要求“测试”。

工作树 /private/tmp/eas-first-claude-audit，分支 test/memory-soak-20260926，固定主线53f2334a。仅新增测试脚本/证据，不修改生产逻辑，不影响正式实例，未提交/合并/发版。

已完成：runtime178通过/3跳过；真实排队70秒/取消/恢复单次执行；3空闲AI Frame最大化切换；10轮PNG/2万面GLB/本地HTML/执行清单插件开关；原生最小化/恢复；5分钟末段观察。48GiB，17分37秒200样本；每轮关闭回到4进程1target，640–649MiB，末轮比首轮+5MiB。最后646.8MiB比稳定冷空闲551.4MiB高95.4MiB，不能断言泄漏或已优化。Chromium另有2条Widget/WidgetHost消息拒绝ERROR，未引发断言失败，根因待查。

全量check3810通过/19跳过/0失败；排队临时源码恢复并构建成功。所属启动器及7个已采集后代均退出、测试夹具清理。原生窗口CDP接口不支持，精确PID的System Events AX fallback通过。最终截图亲眼核对。

新增 scripts/verify-memory-soak.mjs、verify-memory-window.mjs、report-memory-soak.mjs。结果 docs/verification/memory-soak/；progress.html已放所属Frame。根工作区仅同步本任务证据和本文件，不碰既有脏源码。

下一步：逐组件冷启动/预热对照定位+95MiB及2条Chromium ERROR，再按证据决定优化；实体16GB、真实Claude、并行推理、跨平台/安装包/过夜仍未验。没有20%节省结论。不要重复整体循环冒充热点定位。
