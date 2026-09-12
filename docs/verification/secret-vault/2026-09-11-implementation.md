# 密钥柜会话接入落地进度

## 已修改源码
Claude/Codex直接spawn发会话token和共享shim PATH；OMP在scrub后注入并按原token回收；退出/失败/停止/窗口关闭撤销。授权按稳定组ID，带非秘密credentialEpoch防止重启后旧弹窗错授。已有变量只请求授权，无需重复保存。secret_check有hasCredential并主动唤起首次六位码建柜/解锁；解锁成功继续原调用，unlock不占ask冷却。首次介绍不在以后解锁显示。审计UI只显示会话ID与变量名。三个密钥工具延长等待至10分钟，shim15分钟。

## 验证
- session-acceptance.mjs通过：假柜+真实eas-secret wrapper，长度回显、先拒后批、轮换/关闭旧票失效、旧票回调不伤新票、缺失变量全部拒绝、无凭证拒授、sessionKey审计。
- targeted 46项、handoff/owned14项通过；unlock→request冷却测试通过。
- 全量第1次失败6项：现有VM抽取函数测试未注入新增forgetPty依赖；补测试依赖后定向14项通过。
- 全量第2次2878/2864pass/13skip/1fail：既有POSIX Ctrl-C测试native CLI not ready；原断言未改，独立12/12通过。
- 全量第3次2879/2866pass/13skip/0fail（/tmp/eas-vault-check3.log）。其后仅补secret_check空参hasCredential/重启立即撤票，typecheck和handoff10项再次通过。
- build通过。CUA实际打开隔离应用，调用测试实例/invoke的secret_check，看到自动出现的六位码首次建柜弹窗与首次说明，不需要用户寻找钥匙图标。

## 尚未完成的验收
用户需在隔离测试窗口自行输入测试六位码（不进聊天），才能继续实际解锁/原请求恢复交互验收。真实Claude/Codex/OMP进程全链路尚未逐家验收；Windows未实测。不能把上述假服务wrapper测试称为三家真实agent e2e。
未提交、未发版；0.4.93仍是旧功能。历史审计其他缺陷（坏库保护、文件修正等）未在这轮全部修复，不能宣称密钥柜所有安全缺陷已清零。

### 本次收尾追加
- VaultGate handler harness：确认码不一致不提交、同周期双 Enter 只调用一次、卸载后不续接，3 项通过。
- 请求身份回归：旧弹窗异步完成不得消费新请求，先红后绿；secretRequest 2 项通过。
- 最新全量 check：2884 tests，2870 pass / 13 skip / 1 fail。失败原文：`owned IPC cancel during config waits for the actual child to exit`，等待 5000ms 后 `assert.ok(f.read().some(r=>phase==='config'?r.pid:r.executed))` 为 false。该测试文件未修改；单独复跑 6/6 通过，但不将最新全量结果写成通过。
- 最新独立 build 成功，diff --check 通过。隔离实例刷新最新 renderer 后亲眼核对六位码首次弹窗，内容未截断、底层画布灰化模糊可见。
- 仍未完成：真实 UI 创建/解锁提交、实际 Claude/Codex/OMP 节点端到端验收。已停在隔离实例首次创建页，六位码须用户自行输入及提交，不在聊天收集。
