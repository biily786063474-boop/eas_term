# Remote MCP Transport Implementation Plan
> **For agentic workers:** Use superpowers:executing-plans, inline execution; no independent agents required.

**Goal:** 为远程 MCP 建立可测试的安全连接基础，再接统一授权；未完成前不向宿主声明 mcp.remote。
**Architecture:** 独立 URL/出站策略与传输层，SDK 只处理协议，网络策略不能靠 SDK 默认行为替代。保留现有 stdio。
**Tech Stack:** TypeScript、官方 MCP SDK（锁版本）、node:test。
**Spec:** docs/superpowers/specs/2026-09-18-plugin-market-unified-design.md

## Global Constraints
- 不发版、不改用户真实凭证、不读其他客户端token；新能力未验收不得标支持。
- 默认拒绝私网/loopback/metadata；已授权本地连接另立类型，不混为远程。
- HTTP失败不得自动重放 tools/call；取消不等于服务端副作用撤销。

### 1. 远程端点策略
Files: src/main/pluginConnections/endpointPolicy.ts 与 .test.ts。
- [ ] 写测试并见红：HTTPS仅允许精确配置origin；拒绝userinfo、query/hash、非443端口、私有IP/编码IP、localhost及越域端点。
```ts
assert.throws(()=>validateRemoteEndpoint('http://localhost/mcp', ['https://service.example']))
```
- [ ] 实现 parse/validate；仅成功返回规范 URL；不发网络。
- [ ] 绿测后加入地址策略：IPv4/IPv6均采用公开地址判定，混合DNS结果中任何私有地址都拒绝。
- [ ] 策略本身不是DNS重绑定防护，实际传输仍需绑定验证过的地址或可信的代理策略；不得提前宣称安全网络链路完成。

### 2. 远程客户端
Files: src/main/pluginConnections/remoteClient.ts 与 .test.ts。
- [ ] 确认官方SDK具体版本和接口，锁定依赖；连接实现不得引入npx运行时下载。
- [ ] 测试真实隔离MCP服务握手、listTools分页、通知、工具调用、超时/断线不重放、关闭收尾。
- [ ] 提供宿主适配接口；remote关闭与本地进程exit不同，先定义清楚生命周期再接pluginHost。

### 3. 后续依赖
授权、凭证、v2目录和三CLI接线依照总设计分别实现；本计划不把纯策略测试冒充远程服务接通。
