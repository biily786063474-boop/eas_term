import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../../', import.meta.url)
const css = (file) => readFileSync(new URL(file, root), 'utf8')

test('Frame、设置和对话主操作有按下与键盘焦点反馈', () => {
  const canvas = css('features/canvas/canvas.css')
  const workspace = css('features/workspace/workspace.css')
  const chat = css('features/agentChat/agentChat.css')
  for (const selector of ['.cframe-btn:active', '.cframe-start-btn:active', '.cframe-btn:focus-visible', '.cframe-start-btn:focus-visible']) {
    assert.ok(canvas.includes(selector), selector)
  }
  for (const selector of ['.cset-tab:active', '.cset-btn:active', '.cset-tab:focus-visible', '.cset-btn:focus-visible']) {
    assert.ok(workspace.includes(selector), selector)
  }
  for (const selector of ['.ac-input-send:active', '.ac-bar-send:active', '.ac-input-send:focus-visible', '.ac-bar-send:focus-visible']) {
    assert.ok(chat.includes(selector), selector)
  }
  for (const sheet of [canvas, workspace, chat]) assert.match(sheet, /prefers-reduced-motion:\s*reduce/)
})

test('hover-only 删除操作可由键盘与触屏显露，折叠按钮报告状态', () => {
  const terminalCss = css('features/terminal/terminal.css')
  const terminal = readFileSync(new URL('../../features/terminal/TerminalTodoPanel.tsx', import.meta.url), 'utf8')
  const skill = readFileSync(new URL('../../features/canvas/CanvasSkillPanel.tsx', import.meta.url), 'utf8')
  assert.match(terminalCss, /\.term-todo-item:focus-within\s+\.term-todo-x/)
  assert.match(terminalCss, /@media\s*\(hover:\s*none\)/)
  assert.match(terminal, /aria-expanded=\{todos\.expanded\}/)
  assert.match(skill, /className="skl-cat-head"[^>]*aria-expanded=/)
  assert.match(skill, /className="skl-sec-head"[^>]*aria-expanded=/)
  assert.match(skill, /className="skl-item-head"[^>]*aria-expanded=/)
  assert.match(skill, /<MotionDisclosure open=\{!collapsed\}[^>]*className="skl-list"/)
})
