# Eas-Term 0.4.113 发布验收

## 源码与审查
- 最新主线产品/构建/tag：`9cb85bb3002b872262d723e32094724e2d94a9dd`，tag `v0.4.113`。
- 两项发布审查发现已修复：真实 Claude 错误终态释放并发槽；派发前重新检查资源准入，critical 时归还预算和槽再等待，未投递消息不丢失。
- Windows验收脚本先等待所属进程close，再有限重试删除自己的临时profile；所有主错误、清理错误和日志错误聚合保留，收尾成功才输出passed。
- 0.4.112是未公开候选，tag保持不变；原因及失败CI见previous-candidate.md。

## 本轮验证
- 发布树全量check：3860测试，3842通过、18跳过、0失败；脚本专项9/9；build通过。无临时脚本/报告/memory混入app.asar，包版本0.4.113。
- Mac arm64 / x64 Developer ID签名、Apple公证、staple、Gatekeeper接受；DMG/ZIP中的app.asar与正式app一致，两架构同hash，见mac-verification.json。
- 两个正式app在隔离userData下真实启动：渲染、58组preload、PTY回显、IPC、代码图谱实际分析、OMP18.1.2及JS错误检查通过；运行与资源页面前台亲眼核对，截图随记录。
- Mac执行临时smoke副本仅移除既有--no-sandbox并bringToFront，没有放宽沙箱。既有双重sandbox的验收脚本本地失败日志仍保留，不冒充通过。
- Windows tag CI `36312457524` 同源码完整success；内置能力6项GUI/IPC断言和清理均通过，settings-cleanup为true。Windows安装包取该tag release，不复用112/其他main产物。
- 五包大小与SHA256见artifacts.json。分发结果待最终写入distribution.md。

## 边界
- Intel包是在Rosetta下验收，非实体Intel；Windows为CI，不是用户现场；真实16GB设备、OS真实critical压力联动、三家在线模型本轮未做。
- 资源严重压力闸门仅在已校准平台启用；本轮x64界面显示“仅监测”，不宣传其已具备ARM同样的资源拦截。CLI并发调度与该闸门是不同机制。
- 不承诺固定百分比内存下降，不宣称零泄漏。
- Computer Use指针生命周期仍开放；Windows未代码签名可能SmartScreen提醒。
- 依赖审计存量16告警含Electron运行时，未在本版消除；详见security-review.md。
- 没有替换或关闭用户正在运行的 /Applications/Eas-Term.app。
