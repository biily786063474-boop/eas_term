# 笔纵画板 MCP 接入（Eas-Term 侧）

> **上游权威文档**：`~/Biily/Projects/taptv pad/docs/MCP_INTEGRATION.md`（2026-08-11，对应画板 ≥ 1.21.21）。
> 这份只记**跟 Eas-Term 相关的部分**和我们这边做了什么，接口细节以上游为准，别在这里复述一遍再各自漂移。

## 硬事实（会省两小时的那几条）

| | |
|---|---|
| **画板 < 1.21.20 一律连不上** | `.app` 里没带 `mcpServer` 的运行时依赖，客户端报 `-32000 Connection closed` |
| **画板 app 必须正在运行** | `mcpServer.js` 只是转发器，真正干活的是画板进程的本地 HTTP API |
| **不该依赖用户装 node** | 用画板自带的 Electron（`ELECTRON_RUN_AS_NODE=1`），内置 node v22 |
| **`generate` 默认不会真的开始** | 两阶段设计防误扣费，必须再走一个出口，见下 |

健康检查（诊断连不上时先跑这条）：

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:13140/
# 000 = 画板没开    401 = 正常（要 token，符合预期）
```

## Eas-Term 写出去的配置

`src/main/mcpBridge.ts` 的 `bizoneRunner()`，形状照上游文档：

```json
"bizone-canvas": {
  "type": "stdio",
  "command": "/Applications/笔纵画板.app/Contents/MacOS/笔纵画板",
  "args": ["<Eas-Term>/Contents/Resources/mcp/bizone-mcp.mjs",
           "/Applications/笔纵画板.app/Contents/Resources/app/electron/mcpServer.js"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

与上游文档的**唯一差别**：args 中间夹了一层 `mcp/bizone-mcp.mjs`（我们的包装器）。

## 我们这边额外做的两件事

**① 依赖自检**（`bizoneServerPath()`）
只有 `mcpServer.js` **和** `app/node_modules/@modelcontextprotocol/sdk` 都在才写配置。
查行为不查版本号：版本号会随上游改，「依赖在不在」才是真判据。
不通过时**不写、也不删已有条目**——用户可能自己手工指到了别处，删了反而把能用的弄坏。

**② 启动包装器**（`mcp/bizone-mcp.mjs`）
调用前探端口，画板没开就 `open -g -a`（不抢前台）拉起来，轮询至多 12s 再交棒。
上游文档把「画板必须在跑」列为硬事实、没给解法——这层就是解法。
两条硬约束写在文件头：**不许碰 stdout**（那是 MCP 传输通道）、**零外部依赖**
（它由 extraResources 原样拷进包，旁边没有 node_modules）。

## 生成的两阶段（最容易踩的一条）

`generate` 默认只写参数、节点停在 `idle`。**只调 generate 然后轮询 = 永远等不到结果。**
两个出口：

| 出口 | 调用 | 场景 |
|---|---|---|
| 让用户确认 | `generate(...)` → `confirm_batch_generate()` | 用户在画板前，弹窗显示参数与墨水成本 |
| 无人值守 | `generate(..., autoConfirm: true)` | **会真实扣费**，跳过唯一的人工确认 |

`estimate_failed` 是防资损闸门不是 bug；换模型或退回人工确认。

其余坑（`connect_nodes` 用 `from`/`to`、上游有媒体必须在 prompt 里写 `@N`、prompt 用中文、
本地文件用 `import_local_file`）已经写进 `skills/eas-term/SKILL.md` 的生图段，
那份会同时下发给 Claude（skill）和 Codex（`~/.eas/agent/canvas.md`）。**改要改那一份，别在这里补。**

## 变更记录

- 2026-08-11 首次接入上游文档。按文档把运行时从「优先系统 node」改成画板自带 Electron；
  新增依赖自检与启动包装器；重写 SKILL.md 生图段（此前缺 confirm 那一步，
  照着做的 agent 会永远轮询一个停在 idle 的节点）。
