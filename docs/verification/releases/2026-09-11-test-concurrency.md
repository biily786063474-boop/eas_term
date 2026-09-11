# 2026-09-11 发布测试并发修复

原npm run check：2873项，2859通过、1失败、13跳过。失败在capabilityPtyLauncher.test.mjs的真实POSIX控制终端启动阶段：RuntimeError: native CLI not ready；尚未执行Ctrl-C断言。日志/tmp/eas-release-check.log。

对照：该文件单跑12/12通过；相同全量测试显式并发4，2860通过、0失败、13跳过。机器availableParallelism=15，原入口未设置并发。与既有0.4.92发布采用并发4的做法一致，将并发4固定到package.json test，不修改产品代码、测试断言、启动等待或信号次数。支持测试调度资源竞争判断，不声称修复了产品终端故障。

修改后npm run check再次成功：2873项，2860通过、0失败、13跳过。类型与静态检查同时通过。日志/tmp/eas-release-fixed-check.log。本改动仅测试运行配置，无新增UI，无安装包发布。
