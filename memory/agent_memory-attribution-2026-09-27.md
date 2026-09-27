# 内存追查交接 · 2026-09-27
用户原问「继续追查」。固定53f2334a，工作树/private/tmp/eas-first-claude-audit、分支test/memory-soak-20260926。没有产品源码修改/提交/合并/发版。

已做9组独立冷启动、41次组件循环，以及纯Electron37.10.3最小样例40轮。自然/诊断GC分开。同布局混合10轮基线560.4→648.9MiB，+88.5；role delta主界面37.5、GPU27.7、主进程22.3、utility1.0MiB（不同采样时点不可精确加总）。最终均4进程1target；混合诊断GC后691nodes/271listeners，堆7.6MiB，但总RSS仍643.0，高82.6，不得宣布都是缓存/零泄漏。

可解释的驻留：插件宿主约50MiB为pluginHost.ts GRACE_MS=30_000；宽限期到确实退出，不改策略。Widget Message2在不含业务代码纯Electron样例40轮中第8/27轮打开时复现2次，业务代码不是必要条件；另82条task_policy_set ERROR，无崩溃。旧WidgetHost Message7未单独复现；不可合并成全修复。

证据 docs/verification/memory-attribution/README.md、assessment.json、initial/repeat各组JSON、minimal-widget.json、截图、progress.html。报告放Frame；仅根目录同步自身证据/本memory，不碰根脏源码。所有隔离实例/已记录后代已退出；原始*.local*日志不复制/不提交。未强杀生产、未发送LLM、未填充物理内存。

下一步：最小样例做Electron候选版本A/B；native allocations跟踪主界面/GPU/主进程，区分缓存/分配器/真实泄漏；单独查WidgetHost7。避免再跑整套然后以没有崩溃宣布没问题。真实16GB、Claude、Windows仍未验。当前没有充分依据给产品叠回收补丁。
