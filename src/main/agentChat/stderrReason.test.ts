import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStderrDiagnostics, exitMessage, stderrReason } from './stderrReason.ts'

test('取 stderr 最后一句有信息量的话；Codex 的 stdin 提示是噪声', () => {
  const tail = 'Reading additional input from stdin...\nNot inside a trusted directory and --skip-git-repo-check was not specified.\n'
  assert.equal(stderrReason(tail), 'Not inside a trusted directory and --skip-git-repo-check was not specified.')
})

test('只有噪声 → 空串 → 通知只报退出码', () => {
  assert.equal(stderrReason('Reading additional input from stdin...\n\n'), '')
  assert.equal(exitMessage(1, 'Reading additional input from stdin...'), 'CLI 进程退出（code 1）')
})

test('带日志前缀的行去掉时间戳和级别', () => {
  assert.equal(stderrReason('2026-09-06T02:12:52.153953Z ERROR codex_models_manager::manager: failed to refresh'), 'failed to refresh')
})

test('太长截断', () => {
  assert.ok(stderrReason('x'.repeat(500)).length <= 160)
})

test('exitMessage 有原因时拼在退出码后面', () => {
  assert.equal(exitMessage(1, 'boom'), 'CLI 进程退出（code 1）：boom')
})

test('真实模型版本错误优先于退出期间的 MCP 握手警告', () => {
  const tail = `2026-09-07T12:41:50Z WARN codex_core::prewarm: startup failed: {"type":"error","error":{"message":"The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}\n2026-09-07T12:42:01Z WARN codex_mcp::rmcp_client: failed to initialize MCP client during shutdown: MCP startup failed: handshaking with MCP server failed: Auth required\n`
  assert.match(stderrReason(tail), /Codex CLI 版本过旧.*gpt-6-astra/)
  assert.doesNotMatch(stderrReason(tail), /MCP/)
})

test('仅 MCP 关闭警告不能冒充进程退出原因', () => {
  assert.equal(stderrReason('WARN codex_mcp::rmcp_client: failed to initialize MCP client during shutdown: MCP startup failed: Auth required'), '')
})

test('跨 chunk 的错误与 MCP 诊断保留，长尾日志不能覆盖结构化原因', () => {
  const d=createStderrDiagnostics()
  d.push('WARN codex::prewarm: startup failed: {"error":{"message":"The \'gpt-6-')
  d.push('astra\' model requires a newer version of Codex."}}\n')
  d.push('INFO codex::analytics: '+ 'noise'.repeat(900)+'\n')
  assert.equal(d.push('MCP startup fai'),false)
  assert.equal(d.push('led: handshaking with MCP server failed\n'),true)
  assert.equal(d.push('MCP startup failed again\n'),false)
  assert.match(d.reason(),/Codex CLI 版本过旧/)
})
