# Computer Use 收尾核查 · 2026-09-22

用户在0.4.105发布后要求收尾残留。状态仍未修复，切勿重复承诺已完成。

新的关键发现：官方 unified-computer-use26.903.61454 manifest有Stop/Interrupt/SubagentStop → cua_repl.turn_ended(session_id,turn_id)；legacy客户端也有turn-ended且用户已配置notify。旧记录「完全没有释放入口」过于笼统，应区分内部hook与当前可调用公开API。当前公开CUA无native释放接口；sky service RPC无turn_ended分支，不代表native内部无处理。不能猜payload或伪造真实会话结束。

本机外部原生服务由ChatGPT拉起，并有多个Codex客户端，不归Eas-Term独占。没有杀进程、改用户配置/插件缓存、关闭其他会话。自带computer插件不绘制叠加箭头，改它不等于修外部服务。真实重新复现、多会话、失败/取消/退出/崩溃分发验收均未做完。

证据docs/verification/computer-use/2026-09-22/audit.json；完整门槛docs/verification/releases/computer-use-lifecycle.md。需官方会话级释放契约与真实隔离验收，或另经确认改用自有后端；不要写无作用cleanup类凑完成。
