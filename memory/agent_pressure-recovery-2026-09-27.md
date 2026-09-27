# 2026-09-27 压力后恢复验收收尾
用户“OK 按你建议来”，已完成6轮真实组件恢复交互 + 70.645秒受控队列。详细证据 docs/verification/pressure-recovery/README.md 与 progress.html。
工作树 /private/tmp/eas-first-claude-audit，test/memory-soak-20260926，53f2334a + 未提交CanvasImageViewer比例点击修复；不要把root脏旧分支的其他改动带入。
旧问题：zoom后的父级pointer capture吞掉比例点击；排除.civ-zoom、阻止比例doubleClick冒泡。2回归RED→GREEN；build与实机6轮通过；全量3812pass/19skip/0fail。
队列3任务等70.645秒，模拟moderate/critical；取消B，A/C按序一次，10秒无重复。临时IPC注入原文恢复并重建，media/queue所属进程残留0。
shared_images关闭后106.31–109.55MiB，冷99.30；无6轮单调增加但不是零泄漏；4 Widget/2 policy日志未解决。
真实16GB/OS压力联动/Claude登录调用/Windows未验。未commit/merge/release。下一步用户授权审查提交时须一并整理此前memory-soak/attribution/native-engine诊断，默认提交后推送；不能从root旧分支发版。

## 2026-09-27 用户授权提交推送并合入最新主线
独立审查4脚本阻断已修/复审无阻断，5安全测试及1轮媒体/70秒队列复验通过，首次队列UI定位失败原样存档，注入恢复重建。此次提交包含前序本人memory-soak/attribution/native-engine脚本证据，不含其他工作区。最新main2399bb13，整合后须重新check/build再非强推。
