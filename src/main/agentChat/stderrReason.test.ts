import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exitMessage, stderrReason } from './stderrReason.ts'

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
