import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const source = fs.readFileSync(new URL('./session.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const text = (s) => ({ type: 'text', text: s })
const tool = { type: 'tool_use', name: 'Bash' }
const assistant = (...content) => ({ type: 'assistant', message: { content } })
const user = (uuid = 'u1') => ({ type: 'user', uuid, message: { content: '请完成任务 ' + uuid } })

function run(rows, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-session-test-'))
  try {
    fs.writeFileSync(path.join(dir, 'fixture.jsonl'), rows.map(JSON.stringify).join('\n'))
    const handlers = new Map()
    const exports = {}
    new Function('exports', 'fs', 'os', 'path', 'app', 'guardedHandle', 'candidateDirs', js)(
      exports, fs, os, path, { getPath: () => dir },
      (name, fn) => handlers.set(name, fn), () => [dir])
    exports.registerSessionHandlers()
    check((name, ...args) => handlers.get('session:' + name)(null, dir, ...args))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('island returns only final text, while history retains process and tools', () => {
  run([user(), assistant(text('我先检查')), assistant(tool),
    assistant(text('检查完继续处理')), assistant(tool),
    assistant(text('已完成。'), text('验证通过。'))], call => {
    assert.equal(call('last', 'fixture').answer, '已完成。 验证通过。')
    assert.match(call('exchange', 'u1', 'fixture').assistantText, /我先检查/)
    assert.match(call('exchange', 'u1', 'fixture').assistantText, /〔调用工具：Bash〕/)
  })
})

test('tool-only or mixed tool message must not expose pre-tool commentary as result', () => {
  for (const ending of [assistant(tool), assistant(text('开始执行'), tool)]) {
    run([user(), assistant(text('先检查')), ending], call => {
      assert.equal(call('last', 'fixture').answer, '')
    })
  }
})

test('new user turn cannot inherit previous final answer', () => {
  run([user(), assistant(text('上一轮结果')), user('u2'), assistant(tool)], call => {
    assert.equal(call('last', 'fixture').answer, '')
  })
})

test('sidechain and thinking do not replace final text; literal tool labels in text are preserved', () => {
  run([user(), assistant(text('说明：〔调用工具：Bash〕只是引用。')),
    { ...assistant(text('子任务过程')), isSidechain: true },
    assistant({ type: 'thinking', thinking: '内部推理' })], call => {
    assert.equal(call('last', 'fixture').answer, '说明：〔调用工具：Bash〕只是引用。')
  })
})

test('a new unanswered turn does not reuse any earlier answer', () => {
  run([user(), assistant(text('上一轮最终结果')), user('u2')], call => {
    assert.equal(call('last', 'fixture').answer, '')
  })
})
test('only the latest pure text answer is used before applying preview limit', () => {
  run([user(), assistant(text('中间过程'.repeat(100))), assistant(text('最终结果'))], call => {
    assert.equal(call('last', 'fixture').answer, '最终结果')
  })
})
test('island never falls back to another session when binding is missing, invalid or absent on disk', () => {
  run([user(), assistant(text('其他终端的结果'))], call => {
    for (const id of [undefined, '../fixture', 'missing']) {
      assert.equal(call('last', id).found, false)
    }
    assert.equal(call('last', 'fixture').answer, '其他终端的结果')
  })
})
