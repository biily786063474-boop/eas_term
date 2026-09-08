# Codex 调整方向实测 · 2026-09-08
最新构建隔离实例 9447，独立 Codex 节点 cnode-10-pphkc。
通过界面输入只读 printf/sleep 命令，在工具运行中点击“调整方向”，要求两次新 shell 调用。
生命周期日志：17:23:09.130Z 启动 ac-3；17:24:40.022Z 同一 ac-3 resume。
实际界面可见三条工具；落盘旧 item_1 为 failed，新 codex-resume-1:item_0 / item_1 为 ok，
分别返回 STEER_AFTER_ONE 与正确项目目录。新结果未覆盖旧工具结果，按钮恢复发送状态。
未修改项目文件的测试任务；证据见同目录 JSON。不代表工具列表排序或所有中断时序均已验收。
