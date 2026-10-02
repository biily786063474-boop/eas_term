// 手机读对话 = 电脑落盘的存档 + 这次运行内存里比存档更新的。钉住拼法：按写盘时刻切，不重不漏。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { clipForPhone, mergeForPhone } from './history.ts'

const u = (text: string, at: number) => ({ role: 'user' as const, text, at })
const a = (text: string, at: number) => ({ role: 'assistant' as const, text, at })

test('只有存档（重启后没启动的旧对话）：照存档给，空话和工具轮不给空气泡', () => {
  const disk = { savedAt: 100, turns: [{ role: 'user', text: '问', seq: 1 }, { role: 'assistant', text: '  ', seq: 2 }, { role: 'assistant', text: '答', seq: 3 }, { role: 'tool', text: 'x', seq: 4 }, null] }
  assert.deepEqual(mergeForPhone(disk, []), [u('问', 1), a('答', 3)])
})

test('存档之后内存里新说的接在后面；写盘之前的内存条目已经在盘上，不重复', () => {
  const disk = { savedAt: 100, turns: [{ role: 'user', text: '旧问', seq: 10 }, { role: 'assistant', text: '段一\n\n段二', seq: 20 }] }
  // 内存里那一轮是两段 text.done，盘上是拼好的一段 —— 按文字去重会漏判，按时刻切才对
  const live = [a('段一', 50), a('段二', 60), u('新问', 120), a('新答', 130)]
  assert.deepEqual(mergeForPhone(disk, live).map((e) => e.text), ['旧问', '段一\n\n段二', '新问', '新答'])
})

test('没有存档：就是内存记录；总条数封顶取最新', () => {
  const live = Array.from({ length: 50 }, (_, i) => u('m' + i, i + 1))
  const out = mergeForPhone(null, live, 40)
  assert.equal(out.length, 40)
  assert.equal(out[39].text, 'm49')
})

test('存档里的超长一条也要截，并且说出来', () => {
  const t = clipForPhone('x'.repeat(50), 10)
  assert.ok(t.startsWith('x'.repeat(10)))
  assert.ok(t.length > 10 && t.includes('40'))
})
