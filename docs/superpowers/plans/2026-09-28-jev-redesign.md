# Jev 重设计与持久连接 Implementation Plan

> 执行方式：单会话，使用 superpowers:executing-plans 逐项实施。每项先红测再实现，再回归；本文件待用户审阅，不代表产品已实现。

**Goal:** 重启后恢复 Jev 连接和原开关，在不绕过凭证柜与材料授权的前提下重设计判断工作流。
**Architecture:** 宿主负责恢复与凭证租约，插件负责持久化使用意图和判断模板。连接可用性与开关意图分离，界面只消费脱敏状态。
**Tech Stack:** Electron / TypeScript / Node test / ESM 插件 / 原生 HTML 面板。
**Spec:** `docs/superpowers/specs/2026-09-28-jev-redesign-persistence-design.md`

## Global Constraints

- 分支 `feat/jev-redesign-20260928`，基线 `origin/main` 的 `92570390`。原工作区与时间线分支不修改。
- 一次保存长期恢复；暂停继续暂停，已授权自动化可继续运行。
- 不持久化可直接授权的 connected=true；不存明文密钥，不绕过锁柜，不补跑历史事件。
- 不重复收费测试；未知结果不自动重放。不做 OAuth、跨设备同步或自动付费测评。
- UI 必须构建隔离应用亲眼验证；Windows 和真实服务没测就明确标未验证。
- 代码改动同步 `docs/architecture/10-模块领地图.md` 与对应连接/工具图纸。只有检查通过的明确文件可提交，不自动合并或发版。

## Review Focus

1. 恢复与退出并发：晚到结果不得重新启用；Task 2 deferred promise 测试。
2. 旧设置没有总开关状态：迁移不能猜为已启用；Task 1 旧格式 fixture。
3. 预览后材料被修改：旧许可不得复用；Task 3 许可哈希测试。
4. 面板全部关闭：自动化仍按授权运行但不能成为永久进程泄漏；Task 4 引用释放测试。
5. 日界线、断网重启与预算：不丢记账、不补事件、不重复扣本地预算；Task 4 时钟/失败夹具。

## Task 1 — 持久化用户意图

**Files:** 修改 `resources/plugins/jev/lib/preferences.mjs`、`policy.mjs`、`runtime.mjs` 与各自同名 `.test.ts`。
**Interface:** 新偏好格式 `{version:2, enabledIntent:boolean, selected:Record<string,boolean>}`；旧七个布尔选择迁移为 `enabledIntent:false`。有效运行仍取决于当前租约和授权。

- [ ] 在 preferences 测试写入旧格式，断言迁移后 enabledIntent 为 false；用两个 store 实例验证保存与重载。
```js
store.save({version:2,enabledIntent:true,selected});
assert.equal(preferenceStore(directory).load().enabledIntent,true);
```
- [ ] `node --test resources/plugins/jev/lib/preferences.test.ts`，确认新增测试失败原因是新契约缺失。
- [ ] 原子保存 v2 偏好并严格校验；损坏时拒绝调用。runtime.enable/pause 保存意图；disconnect 只撤销运行态，显式退出另清授权意图。更新 policy/runtime 测试防止旧 ticket 复活。
- [ ] 跑 `node --test resources/plugins/jev/lib/*.test.ts`；只提交 Task 1 文件。

## Task 2 — 宿主恢复协调与撤销

**Files:** 新建 `src/main/pluginConnections/jevRecovery.ts` / `.test.ts`；修改 `deferredConfiguration.ts` / `.test.ts`、`src/main/pluginConfiguration.ts`、`src/main/pluginHost.ts`、插件 `lib/service.mjs` / `.test.ts`。
**Interface:** `createJevRecovery({restore:()=>Promise<void>,stop:()=>void})` 返回 `{recover:()=>Promise<void>,revoke:()=>void}`；generation 和 single-flight 防止恢复竞态。调用者实时检查凭证租约、插件启用和配置身份。

- [ ] 写退出与 pending restore 交错测试：
```js
const pending=manager.recover(); manager.revoke(); resolveRestore();
await pending; assert.equal(active,false);
```
- [ ] 跑新 recovery 测试，确认缺失实现红测。
- [ ] 接入现有 connectPluginConfiguration 与安全租约；区分首次验证和恢复，恢复不走收费固定问题。可信宿主恢复入口不得暴露给面板或 MCP shim。
- [ ] 添加锁柜、密钥改变、插件禁用、401、超时的夹具；所有失效路径撤销旧代际。面板只得到 saved/locked/restoring/available/offline/invalid 等脱敏状态，不返回密钥。
- [ ] 跑 `node --test src/main/pluginConnections/*.test.ts resources/plugins/jev/lib/*.test.ts`；提交 Task 2 文件。

## Task 3 — 判断契约与单次材料许可

**Files:** 新建插件 `lib/decision.mjs` / `.test.ts`；新建宿主 `src/main/pluginConnections/jevDecisionConsent.ts` / `.test.ts`；修改 `lib/service.mjs`、`lib/client.mjs`、`lib/errors.mjs` 与同名测试、`src/main/pluginHost.ts`、插件 `skills/*.md`。
**Interface:** 宿主许可绑定 `{sessionId, materialDigest, questionDigest, model, generation}`；一次消费，变化或撤销后失效。模板输入为显式材料与闭集问题，输出判断结果，不能授权后续动作。

- [ ] 许可单元测试先覆盖同请求成功、材料修改失败、跨会话失败与第二次消费失败：
```js
assert.equal(consume(ticket,changedRequest),false);
assert.equal(consume(ticket,originalRequest),true);
assert.equal(consume(ticket,originalRequest),false);
```
- [ ] 测试失败后实现许可注册表及宿主预览确认；取消不发网络请求。
- [ ] 收敛五个通用工具；旧名称兼容层也走相同预览路径。首版反馈分类和自定义小问题，不展示未实现的专业工作流。固定配方模型版本。
- [ ] 测试恶意说明不能扩权、未知工具拒绝、非 JSON/超大输入拒绝、置信度缺失弃答；错误信息不转发原始凭证或第三方响应。
- [ ] 跑 Task 2 回归加新许可测试；提交 Task 3 文件。

## Task 4 — 自动化生命周期与用量

**Files:** 修改 `lib/timeline.mjs` / `.test.ts`、`lib/usage.mjs` / `.test.ts`、`lib/runtime.mjs` / `.test.ts`、`src/main/pluginHost.ts`；新建 `src/main/pluginConnections/jevAutomation.ts` / `.test.ts`。
**Interface:** 自动化只接收宿主授权项目的当前事件；单次 acquire/release 生命周期；共享 state 的独立问题合并请求。

- [ ] 先写两个问题只调用一次的测试，项目来源明确时不出站，低置信度 projectId 为 null。
```js
assert.equal(requests.length,1);
assert.equal(advice.project.projectId,null);
```
- [ ] 实现临时受管引用，finally 释放；重启不追溯事件，禁用/撤销立即停止。没有模型建议时基础时间线仍正常。
- [ ] 统一持久化日预算；并发限额独立。用量记录保存模型/模板版本及 token，不保存原文；估算花费注明单价来源与时点，未知仍未知。
- [ ] 写 UTC 跨日、进程重建、请求结果未知、重复事件和权限变更测试；费用估算缺价格时不显示零费用。
- [ ] 跑插件及 automation 测试；提交 Task 4 文件。

## Task 5 — 三页界面与应用验收

**Files:** 修改 `resources/plugins/jev/ui/panel.html`、`plugin.json`、`README.md`、`skills/*.md`、`resources/plugin-market-details/jev.json`；更新 `docs/design/jev/design-mapping.md` 与架构图纸；新增 `docs/verification/jev-redesign/` 验收记录。

- [ ] 先建立面板测试：三页可导航、暂停可见、离线不显示退出、锁柜显示解锁入口、历史记录可展开而非 toast。
- [ ] 实现判断台的材料预览/确认/结果；自动化独立授权；连接与用量有明细。应用现有配色和组件规则，支持键盘及 reduced-motion，不引入 UI 依赖。
- [ ] 退出按钮明确「移除 Jev 凭证」并确认；暂停不删密钥。新增授权范围不可随「恢复」自动放开。
- [ ] 版本与市场元数据一致更新；保留固定端点、无重定向及路径 guard。
- [ ] `npm run check` 和 `npm run build`；失败原样报告。
- [ ] 使用 open-app-verify，在隔离 userData/测试凭证夹具中验证启用重启、暂停重启、关面板事件、断网、退出竞态、记录展示；保存截图与实测结果。真实付费调用另经用户授权；未做的不记通过。
- [ ] 审查整分支 diff 和安全回归，提交只包含本任务文件；未获用户后续指令不合并不发版。

## 当前基线

2026-09-28：`node --test resources/plugins/jev/lib/*.test.ts` 24 项通过，0 失败。完整应用基线检查尚未运行；实施前配置独立依赖后补跑。当前仅创建分支、复制设计并编写计划，尚未开始产品实现。
