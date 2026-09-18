# Plugin Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 建立可复用、失败关闭的插件宿主兼容性校验，作为统一接入阶段 A 的第一块。
**Architecture:** shared 类型定义 requirements；主进程纯函数解析并检查版本、平台、架构、能力；现有 registry 保留该字段且拒绝畸形声明。暂不切线上目录，防止其尚未发布时市场变空。
**Tech Stack:** TypeScript, node:test。
**Spec:** docs/superpowers/specs/2026-09-18-plugin-market-unified-design.md

## Global Constraints
- 不改变现有 schema 1 默认 URL，不启用尚未完成的 remote/oauth 能力。
- 不修改正式 app 或真实用户凭证；本阶段不宣称 32 项已接入。
- 这是完整设计的分阶段计划；远程传输、凭证、UI、v2 目录与三 CLI 验收分别继续，不以本阶段代替整体。

### Task 1: 纯兼容性契约
**Files:** create src/shared/pluginCompatibility.ts; create src/main/pluginCompatibility.ts; create src/main/pluginCompatibility.test.ts.
**Interfaces:** parsePluginRequirements(raw: unknown) returns typed success/error; checkPluginCompatibility(requirements, host) returns {ok:true} or {ok:false, reason:string}.
- [x] 写测试：缺省兼容 legacy；畸形字段拒绝；未知 capability 拒绝；数值版本比较；平台与架构逐项匹配。
```ts
assert.equal(checkPluginCompatibility({minHostVersion:'0.4.103'}, host).ok, false)
assert.equal(checkPluginCompatibility({capabilities:['mcp.remote']}, host).ok, false)
```
- [x] `node --test src/main/pluginCompatibility.test.ts` 确认失败。
- [x] 实现严格整数三段版本解析；合法要求字段只含 minHostVersion/platforms/architectures/capabilities；未知要求字段拒绝，空数组拒绝，避免丢失约束后放行。
- [x] 同命令确认通过。

### Task 2: 目录保留要求
**Files:** modify src/main/pluginRegistry.ts, src/shared/types.ts; tests src/main/pluginRegistry.test.ts.
**Interfaces:** RegistryEntry.requirements?: PluginRequirements；PluginRegistryEntry 同步。
- [x] 测试 requirements 被保留，错误要求条目丢弃并 warning。
```ts
assert.deepEqual(parsed.entries[0].requirements, {capabilities:['mcp.remote']})
```
- [x] 跑 node --test src/main/pluginRegistry.test.ts 看到新测试失败。
- [x] parseRegistry 调用纯校验器，不吞未知要求字段；requirements 不存在时保留旧行为。
- [x] 跑两组测试与 npm run typecheck。

### Task 3: 安装边界执行
**Files:** modify src/main/pluginMarket.ts, pluginInstallGate.ts; tests use existing pluginMarketChain.test.ts style with isolated IO.
- [x] 下载前、提交前以 app.getVersion/process.platform/process.arch 和真实能力常量检查要求。
- [x] 确认门禁记录保留 requirements；拒绝后清 staging，不修改已安装包。
- [x] 包内 requirements 与目录 requirements 必须语义相同；畸形或不一致拒绝。
- [ ] 包内 schema/远程连接需要未支持能力时拒绝，不假装 legacy。
- [x] 行为测试覆盖更高版本、平台、能力不符的无下载/无落盘副作用。
- [ ] 更新 architecture/10 与 03 的兼容性边界；全测试；隔离应用安装回归后方可声明安装行为已验证。
