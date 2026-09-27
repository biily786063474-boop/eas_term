# 未发布候选：0.4.112

源码/tag 6b5ccb0af2f7e723c0f0889f9a85c23e765cf08e。
Windows tag CI 36311598447：真实内置能力GUI6项断言通过，但进程退出清理profile时 EBUSY (Network/Trust Tokens)，整个job失败，无发布EXE artifact。
旧 main af5f16f6 run36309927150 同类失败；不是忽略可用门禁。官网/GitHub/latest均未公开112。
为保持已推tag不可变，修复验收脚本后以0.4.113最新主线重新冻结与全平台构建。112 Mac包仅留本地候选，不复用为113。
