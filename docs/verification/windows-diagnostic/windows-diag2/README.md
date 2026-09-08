# 0.4.85-diag.2
在diag.1冻结基线上只加入 b6d1ced 的可选笔纵发现容错，保留独立身份/日志回传，不含main上其他0.4.86功能或并行登录UI改动。
Windows run34262389800 / job102183321981成功，构建源码0a1350d8e808c59f741d10be6f17df5cc86b0361。
类型检查、9项日志单测、25项笔纵/宿主/真实Windows OMP回归、实际打包应用冒烟、诊断运行8项验收均通过。
OMP使用本机loopback固定模型响应，缺失笔纵为测试注入，不使用真实账户或付费生成。
诊断回传编号1fdc5d07-c1ac-4a46-a169-63bd64c0b42c，正常退出code0且清标记，异常退出保留标记。截图已人工查看。

失败留档：34261004424因测试在OMP退出前同步删临时cwd触发Windows EBUSY；修正为等所属进程退出后异步有限重试。
34261624937在日志验收的正常退出后标记仍在；原脚本发Runtime.evaluate(app.quit)后立即关闭调试连接，缺少执行确认。改为确认定时退出已排入后再断开，增加退出码断言；应用退出业务代码没有因此修改。最后完整重跑通过，不把这次测试异常称作用户原始闪退根因。

未执行Windows NSIS交互安装向导；测试实际win-unpacked应用。原始用户闪退/Computer Use生命周期仍未宣称修复。
不发布官网/Release/标签/更新源。旧diag.1安装文件不覆盖，交付新目录diag.2。
artifact10070738097外层zip SHA256 7748fe44b32b539b0bfeb6738d252ca158232cd0205fc2d6b58713dba871ac8e。
下载zip与exe校验均一致，exe SHA256 3e8d3d0caa9fb7fdd4d088a732841e66e5eea85ca1676d3c270521dd90c66f54。
交付 ~/Downloads/Eas-Term-Windows-Diagnostic-0.4.85-diag.2/，含exe、校验文件、测试说明；已在访达选中。
服务器回执文件0600、877字节，服务active。
