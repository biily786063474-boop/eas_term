import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startChoicePresentation } from './startChoicePresentation.ts'

test('三种 AI 入口显示准确名称和悬停解释', () => {
  assert.deepEqual(startChoicePresentation({ id: 'claude', displayName: 'Claude Code' }), {
    name: 'Claude Code', tip: '官方原生架构；下载安装需留意网络环境'
  })
  assert.deepEqual(startChoicePresentation({ id: 'codex', displayName: 'Codex' }), {
    name: 'Codex', tip: '官方原生架构；下载安装需留意网络环境'
  })
  assert.deepEqual(startChoicePresentation({ id: 'omp', displayName: '默认 harness' }), {
    name: '原生 Harness', tip: '基于 OMP 二次开发，支持多模型登录'
  })
})

test('后续新增 CLI 保留自己的名称，也有悬停解释', () => {
  assert.deepEqual(startChoicePresentation({ id: 'other', displayName: 'Other CLI' }), {
    name: 'Other CLI', tip: '使用 Other CLI 开始 AI 对话'
  })
})
