# 运行资源闸门 · 源码复核与整改报告

2026-09-13｜范围：voice-regression 工作树当前源码 + 本轮验收证据｜仅报告，未修改业务代码。

## 一、结论

不是打包问题，也不是加一个设置入口就能修好。当前有五块独立基础模块，但缺少将采样、决策、资源预留、任务执行、服务租约串起来的主进程管理器。现有自动测试主要验证单模块，因此全绿不能证明产品满足80%/50%限制。

建议保留已验证的CPU计算/采样基础，重做服务停止契约和任务准入契约，然后以一个真实插件服务为端到端切片接入，最后扩到AI、终端和后台任务。不要一次性给所有spawn套wrapper，也不要先做看起来完整的服务清单冒充功能完成。

## 二、源码证据与问题分类

| 项目 | 实际位置 | 复核结论 | 类型 |
|---|---|---|---|
| 共享停止竞态 | serviceRegistry.ts:25、28–39 | setProjects可随时换归属；stop先检查，微任务稍后才requestStop，期间归属可变 | 已复现缺陷，高优先级 |
| 资源预算缺失 | scheduler.ts:1–11、31–41 | Work没有资源成本；allow不接收候选任务；running.set只预留并发槽，不是CPU/内存 | 已复现接口缺口，接入阻断 |
| 策略与执行未接 | policy.ts:allow 与 scheduler.ts:allow | policy可收预估参数，但调度器没有提供预估或持有账本 | 未实现集成 |
| 数据协议不足 | shared/runtimeResources.ts | 只有CPU快照，缺内存、服务、任务、能力与原因码 | 未实现 |
| 应用无入口 | 对src/main/index.ts、preload、renderer及main全局搜索 | createCpuSampler/Policy/Scheduler/ServiceRegistry仅定义与测试，无生产装配 | 未实现，不是构建漏包 |
| UI无功能 | SettingsPanel.tsx诊断区域；隔离实例实查 | 现有图形加速与日志，不存在运行中心/资源模式 | 未实现 |

以上runtime文件均在src/main/runtime/。验收原始复现见adversarial.json；测试日志见同目录tests.log。源码位置以本次未提交工作树为准。

## 三、B1如何修：停止权限绑定真实租约，而不是一个布尔值

### 根因链

登记A → stop(id,false)看见单项目并通过 → 设置stopping → Promise微任务尚未执行 → setProjects变为A+B → requestStop仍执行。

confirmedAllOwners=true同样有问题：它未绑定用户当时看见的项目集合，后面新增C时，旧确认仍可能覆盖新项目。仅在微任务里再查一次length不能完整解决。

### 正确修改

1. **唯一归属权威留在HostRegistry/插件宿主。** 现有hostRegistry.ts:30–41处理acquire；44–54在零引用宽限期后回收。serviceRegistry只投影归属，不再由任意setProjects列表代表停止授权。
2. 为每个真实服务实例提供generation，为有效租约变化提供ownerRevision；保存ref→projectId映射（现有refs只有数量，不能直接拿项目数替代真实租约数）。
3. 拆接口：releaseProjectRefs（释放当前项目的真实ref）与stopAll（停止整个实例）。默认使用前者，不能只从UI列表删项目但不释放租约。
4. stopAll请求携带serviceId、generation、expectedOwnerRevision。主进程验证调用窗口及项目访问权限，生成绑定范围的短时一次性确认票据；票据不包含密钥/命令参数。
5. 在真实宿主同一同步临界区中检查revision并设置draining，随后才可异步调用停止协议。acquire遇到draining不能取得旧实例：明确返回稍后重试，或在旧实例退出后创建新generation；不得悄悄让新项目加入正在关闭的服务。
6. 从确认到执行期间归属变化→返回ownership_changed、刷新影响清单重新确认。失败不要消费成“已停止”；旧generation的迟到exited不能改变新实例。
7. 继续区分stopping/stopped；requestStop resolve只代表请求已发，不当作退出证明。适配器提供真实exit/close/worker terminate确认；超时标stop-timeout并保留记录，不默默释放运行额度。

### 修改范围

serviceRegistry.ts及测试；hostRegistry.ts及原有回归；pluginHost.ts的acquire/release/onIdle；mcpClient.ts退出通知；新增主进程runtime/serviceAdapters.ts。HostRegistry已有30秒宽限/共享复用语义必须保留，改为可封闭获取的实例状态，而非另造引用计数。

### 必须先写的失败测试

A确认后B加入；A+B确认后C加入；停止与acquire同事件循环竞争；旧实例退出晚于新实例创建；多次停止幂等；stop超时保持占用；释放A不影响B；外部/核心服务无法关闭。验收B1中的stopCallsWithoutSharedConfirmation必须由1变0。

## 四、B2如何修：原子准入和资源账本

### 根因链

75%快照 → while循环反复调用同一个allow() → 每次看见75%<80% → 4个并发槽都放行。真实资源成本未知，所以不能据此断言CPU已超过80%；但现有接口确实无法阻止预算超售。

### 正确修改

1. Work新增任务类别、projectId、priority、parentTaskId以及estimate：CPU按整机百分点、内存按bytes、估计置信度/来源。未知成本任务只允许一个探索性准入，不把成本记0。
2. 用唯一ResourceLedger管理每任务lease；将allow()+running.set替换为tryAcquire(task,snapshot)原子操作。检查快照新鲜度、模式、系统压力、并发池与资源余量后同步预留，之后才能await/run。
3. 余量参考：阈值容量−整机已观测用量−未兑现预留−安全余量。必须避免把“已进入整机读数的运行任务用量”又完整预留一遍。没有可靠进程归属时采用保守预留，宁可低吞吐，并明确该误差；不能仅凭经过一个采样周期就认定预留已经兑现。
4. lease记录estimated/reserved/observed状态及采样代次；实际用量超过估计时缩减后续准入，不通过杀进程把数字压下去。观测校准不解除任务持有身份；结束、失败、取消确认后幂等释放。
5. 恢复从拥塞退出后每个采样周期有限放行，禁止一个while瞬间放满。候选挑选应先匹配资源，再按项目轮转/优先级/老化，防大任务头阻塞所有小任务。
6. 父agent会话生命周期不能长期占计算槽。父任务等待子工具时采用明确park/transfer契约释放可转让的工作许可，但保留真实内存预算；恢复父任务必须重新准入。没有该协议的CLI只做会话/进程树级控制，标“不支持内部工具精确排队”。
7. 取消运行中的任务只发AbortSignal；不遵守取消的执行器不能提前释放预算。引入cancel-requested/stop-timeout，仍算运行，不自动重试。
8. 等待超时由管理器提供独立、有界维护tick；采样器故障也要能取消和过期，不能让队列超时完全依赖下一次成功采样。

### 修改范围及测试

新增runtime/resourceLedger.ts；改scheduler.ts的Work/Options/准入与释放；policy.ts输出decision+reason而非仅boolean；sampler与管理器供单调时钟/采样代次。

测试：75%+每任务3百分点，在80%阈值且安全余量0的合成测试最多准入1项；第二项排队。再测试完成释放、重复释放、并发submit、模式切换、未知成本、预测误差、采样失效、取消不退出、嵌套工具、过期无重放。这是预算算法验收，不是硬CPU上限证明。

## 五、缺失链路怎样补，而不是继续堆纯函数

建议结构：PlatformMetrics → RuntimeManager（单例）→ Policy + ResourceLedger + Scheduler；ServiceAdapters从HostRegistry/agent/PTY/worker实际生命周期更新ServiceRegistry；窄IPC把脱敏快照投影给运行中心。

- 平台适配：CPU用现有ticks；内存提供total/available/pressure/口径标签，平台未验证返回unknown。freemem和memory_pressure -Q不是可以互换的百分比；GPU不可测就明确未知。
- 管理器：显式start/dispose，单例采样/队列维护；共享CPU指标缓存，不能和diagLog争用app.getAppMetrics采样区间。保护取消、保存、密钥审批、IPC心跳通道。
- 首个切片选pluginHost→mcpClient：已有HostRegistry可验证共享项目的释放与停止。在只读观测模式先核对列表、归属、退出，再启用该入口的资源准入。
- 其后逐类接入agentChat/session.ts、omp/launch.ts、pty.ts、stt/voiceVad、webview/索引/更新。每类标可观察/可排队/可安全停止；外部笔纵与CUA不能因由软件唤起就取得关闭权限。
- UI：复用设置和抽屉，显示CPU/内存、普通/节能、服务名称/项目/时长、队列原因与取消；停止确认绑定上述revision。preload只暴露ID操作，禁止渲染传PID或shell命令。
- 持久化只保存设置和必要元数据；重启未知副作用任务需用户确认，不自动重跑，不凭旧PID恢复停止能力。

## 六、按依赖顺序整改，逐项设验收门槛

| 顺序 | 交付 | 退出条件 |
|---|---|---|
| R1 | 修B1，真实租约revision+draining | 共享竞争测试通过，既有HostRegistry回归通过 |
| R2 | Ledger+Scheduler原子预留/取消/嵌套契约 | 合成预算不超售，取消不提前释放，无父子死锁 |
| R3 | 平台指标+RuntimeManager，观测模式 | 本机指标口径可解释，采样开销实测，未知不伪装0 |
| R4 | 插件端到端切片+最小运行中心 | 两项目共享服务显示正确，释放A不伤B，停止需要影响确认 |
| R5 | 其余启动入口逐类接入 | 清单每个入口有覆盖等级与退出证据，不用157候选数冒充覆盖 |
| R6 | 隔离真机压力/亮暗/窄屏/e2e | 80/50准入、排队恢复、取消、退出和低配置场景有连续证据 |

建议第一批同时完成R1/R2的核心契约与失败测试，再做R3/R4可见切片；不能在R1还不安全时先开放“关闭服务”。Windows/Linux未经实测不标通过。没有完成全覆盖时界面及发布说明必须标覆盖范围。

## 七、为什么现有测试漏掉，以及如何避免再发生

serviceRegistry现有共享测试使用静态projects；未在stop和微任务执行之间修改归属。scheduler测试的allow只返回布尔；没有连接真实policy或成本，所以并发4“正确”仍可预算错误。UI从未接入，本就不在纯函数测试范围。

补三层：单元测试锁住边界；契约集成测试把policy/ledger/scheduler和host/registry真实接在一起；隔离应用e2e验证用户入口。三层分别报告，不以总测试数替代完成比例。

## 八、决策

推荐“修契约→打通真实切片→逐类扩展”，不推倒CPU基础，不再用孤立模块数量当进度。80%/50%继续作为整机分维度准入警戒线；绝不承诺其他软件占用或不可抢占任务的瞬时硬上限。本报告不代表已修复；本轮没有业务代码变更、没有提交或发版。

决策码：按 R1→R6 整改，先修安全与预算，再开放服务管理。
