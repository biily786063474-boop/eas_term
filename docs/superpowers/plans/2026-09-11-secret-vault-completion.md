# 密钥柜落地与后续排期

执行方式：单会话，按 executing-plans / TDD 逐项执行，不委派。

目标：让直接创建的 agent 能在用户授权后通过 eas-secret 使用密钥；首次六位码建柜、锁定时直接弹窗，不要求用户找入口。

- [ ] P0 会话凭证：抽取共享 shim，agent spawn发票；OMP scrub之后注入；所有关闭/失败路径撤销，旧进程回调不能撤销新凭证。
- [ ] P0 授权闭环：ctx agentSessionId优先；已有组只授权，不要求重复输入；缺凭证/过期授权失败明确返回。
- [ ] P0 解锁闭环：复用六位码，首次介绍与确认；secret_check需要解锁时直接弹窗并继续原请求；解锁不等于授权。
- [ ] P0 元数据与审计：hasCredential、准确next、sessionKey审计，无明文工具回传。
- [ ] 验收：隔离假柜、真实wrapper长度、不授权拒绝/批准通过、关闭旧token拒绝；build、实际应用弹窗验证。真实柜不用于测试。
- [ ] P1 设计选型台词典化（依赖密钥柜验收）：先评审已有docs/prototypes/dictionary-design-picker.html；词典内入口、hover样式/系统预览、选择范围、提示词预览与目标会话发送；不将原型模拟发送当作真实功能。视觉沿用产品基因。

禁止：agent env直接注入业务密钥；secret_check回值；主进程代跑shell。包装子命令仍可能主动打印密钥，不承诺绝对无法泄露。
