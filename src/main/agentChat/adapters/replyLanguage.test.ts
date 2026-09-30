import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAdapter } from './index.ts'
import { setCurrentLang } from '../../../shared/i18n/current.ts'

// 英文界面：系统提示里要求 AI 用英文回答（含 CLI 自己醒来的那一轮）；中文界面：提示词逐字节不变。
const sysPrompt = (args: string[]): string => args[args.indexOf('--append-system-prompt') + 1]
const codexInstr = (args: string[]): string => args.find((a) => a.startsWith('instructions=')) ?? ''

test('中文界面：Claude / Codex 的系统提示与改动前一致（不含英文回答要求）', () => {
  setCurrentLang('zh')
  assert.equal(sysPrompt(getAdapter('claude')!.buildArgs({ cwd: '/W' }).args).includes('Always reply in English'), false)
  assert.equal(codexInstr(getAdapter('codex')!.buildArgs({ cwd: '/W' }).args), '', '没有契约时 codex 不应凭空多出 instructions')
})

test('英文界面：Claude 与 Codex 都带上「用英文回答」', () => {
  setCurrentLang('en')
  try {
    assert.ok(sysPrompt(getAdapter('claude')!.buildArgs({ cwd: '/W' }).args).includes('Always reply in English'))
    assert.ok(codexInstr(getAdapter('codex')!.buildArgs({ cwd: '/W', roleContract: '角色' }).args).includes('Always reply in English'))
  } finally {
    setCurrentLang('zh')
  }
})
