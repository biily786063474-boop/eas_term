# 插件不进入等待队列
用户已批准启动和工具调用两层直接执行，保留运行记录/取消/权限/回收。
工作区 /private/tmp/eas-plugin-no-queue-20260922，分支 fix/plugin-no-queue-20260922，最初基线3546c13，集成时已移除无关词典提交，改基于远端main 61c890a；准备推送PR，未发布。
实现 immediate 主进程内部标记；只用于 pluginHost、bizoneHosted、toolActivity；scheduler直达running，manager仍记账。
验证日志 /tmp/plugin-queue-*.log。初次旧依赖报缺SDK，已使用plugin-update-release现有依赖纠正。
严重压力/队列满使用自动化测试模拟；真实Electron验证使用自有Bearer端点和真实shim，不代表真实上游/TLS或Windows验收。

集成基线复验：3501通过、19跳过、0失败；typecheck/build与隔离Bearer UI/真实shim验证通过。早期测试与改基线重叠导致已移除词典测试读取失败，以集成基线完整复验为准。
