# 多 CLI 全局错峰首版

默认2个活动轮次，宿主派发至少间隔1秒。设置→系统管理→运行与资源，可选1–8。调小不终止正在运行的任务。Claude/Codex资源准备后、OMP握手后统一准入。

验证结果与首次失败记录见 ledger.md。result.json 为真实主进程队列/设置的隔离应用证据；chat-ui.json 为三家事件夹具驱动真实对话组件的验证，不是在线模型测试。

截图：two-running-two-waiting.png、changed-limit.png、light.png、claude-waiting.png、codex-waiting.png、omp-waiting.png。

限制：普通终端自行启动的进程与CLI内部子请求不逐请求限速；同项目托管父轮次活动时嵌套team派发明确拒绝，避免父子等待名额死锁；授权等待仍占名额。真实在线三家、Windows、极窄窗口未验收。2026-09-27 按用户要求整合主线；本次不发版。
