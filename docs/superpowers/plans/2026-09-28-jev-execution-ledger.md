# Jev execution ledger

Branch: feat/jev-redesign-20260928, base 92570390. Single-session execution.

Task 1 RED: preference v2 rejected, legacy migration returned bare selections, runtime intent undefined, enable did not persist. Four new failure conditions observed.
Task 1 GREEN: versioned intent persistence and legacy paused migration; runtime restores enabled only after host supplies verified credential; pause revokes before storage write. Plugin suite result recorded by execution output.
Ruling: temporary disconnect preserves intent, explicit pause stores false — needed for vault lock/restart restoration. Failed pause persistence remains a cross-restart risk to address in host fail-closed recovery; current in-memory permission is revoked immediately.
Remaining: host credential recovery and authorization binding; materials consent; automation; UI and real application verification. Do not claim feature complete from unit tests.

Tasks 2–5 implementation: recovery proof stored encrypted under configuration scope; trusted host/restore bypasses paid verification only after exact configuration digest match. Both panel and shim preview immutable request and bind generation. Decision API consolidated; old aliases still gated. Event-owned Jev and timeline references release in finally; independent recipe scopes avoid cross-recipe permission expansion. Daily budget and estimated price visible in UI.

Ruling: use native one-shot confirmation closure + plugin generation rather than reusable ticket registry — fewer stored permissions; exact serialized material cannot mutate after confirmation. Tradeoff: native confirmation limits previews to 16KB and is modal.
Ruling: fresh authorization is host-owned; recipe question composition stays in service/timeline plus client validation rather than adding an otherwise empty DecisionService wrapper. Tradeoff: future complex templates should extract a focused module.
Ruling: independent local npm ci --ignore-scripts followed by Electron install, because shared node_modules lacked MCP SDK. Original shared dependencies untouched.
Verification history: first full check failed only because existing onboarding test pinned 0.1.2; updated assertion to 0.2.0 plus new capability. Next full check passed 3934, skipped 19. UI initial run on older shared Electron verified core behavior; subsequent runs use worktree Electron 42.11.8 and app version 0.4.114. Initial expanded UI harness looked for node.type instead of node.component.type; fixed harness, did not patch product to satisfy it. Subsequent panel-closed automation E2E passed.

Final independent read-only review found P1 old automation snapshot could send after scope change and P2 failed pause persistence could restore old enabled intent. Both reproduced RED then fixed: host/timeline binds generation; plugin checks current recipe scope before transport. pauseJevSafely removes only encrypted recovery proof before terminating a process whose pause save failed. CredentialStore test confirms actual file removal retains API key, requires no decrypt. If the filesystem also refuses proof deletion, the user sees an explicit warning that durable blocking could not be guaranteed; code does not falsely claim recovery is blocked. Independent reviewer reran 15 relevant tests and found no severe regression in the fixes.

Additional UI harness correction: after adding a timeline iframe, reconnect initially selected the first iframe instead of Jev; title-scoped selection replaces this harness assumption. These timeouts did not indicate a product state failure. Final verification results recorded separately in docs/verification/jev-redesign.

Final actual-host E2E: 21 checks passed including whole-app enabled/paused restart, no repeated provider verification, panel-closed process recycling then authorized event, lock/unlock restore, logout deletion and no revival. TypeSafe HTTP remains test-only fixture; no real API, CLI account or Windows claim.
Final full-suite attempt: 3961 tests, 3941 passed, 19 skipped, 1 failed in untouched codexCapabilityLauncher.test.mjs ('5 秒内夹具没到达 config 阶段', elapsed 5003ms). No product or timeout change made to hide it; isolated rerun and full rerun tracked separately. Earlier full run of this branch passed 3941 / 19 skipped before the last added negative-warning test.

Final: isolated unrelated test rerun 6/6 passed. Full npm run check rerun 3961 total, 3942 passed, 19 skipped, 0 failed; build passed; 21 actual-host UI checks passed. No real provider, online CLI, Windows or release claim. All implementation steps are complete; working changes remain isolated and unmerged.

## 安全合并验收（2026-09-28）
用户明确授权提交、合并 main、推送。功能提交 629749c8；整合 origin/main 1cbbc1c2 为 549ccf58。两处新增内容冲突保留双方：pluginHost 活动统计导入与 Jev 导入、架构图纸两段说明。合并后 check 3966通过/19跳过/0失败，build通过；隔离 Electron 21项验收通过，实际截图已查看。真实 TypeSafe/在线 CLI/Windows 未验证。推送仅允许快进，不强推，不修改其他工作区。
