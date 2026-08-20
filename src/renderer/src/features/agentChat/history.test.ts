import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trimForSave, settleOnLoad, contextLostOf, MAX_TURNS, MAX_EXEC_OUTPUT } from './history.ts'
import type { Turn } from './reduce.ts'

const turn = (text: string, over: Partial<Turn> = {}): Turn => ({
  role: 'assistant', text, execs: [], ...over
})

test('只保留最近 MAX_TURNS 轮，且保序', () => {
  const many = Array.from({ length: MAX_TURNS + 10 }, (_, i) => turn(`t${i}`))
  const out = trimForSave(many)
  assert.equal(out.length, MAX_TURNS)
  assert.equal(out[0].text, `t10`, '留的是最后那一段')
  assert.equal(out[out.length - 1].text, `t${MAX_TURNS + 9}`)
})

test('超长命令输出被截断，并说明原长', () => {
  const big = 'x'.repeat(MAX_EXEC_OUTPUT + 500)
  const out = trimForSave([turn('a', { execs: [{ execId: '1', label: 'l', detail: 'd', state: 'ok', output: big }] })])
  const o = out[0].execs[0].output!
  assert.ok(o.length < big.length, '该截断')
  assert.ok(o.includes('已截断'), '要说明截断了，否则看的人以为命令只输出了这么多')
  assert.ok(o.includes(String(big.length)), '要带上原长')
})

test('没有 output 的 exec 不会凭空长出一个 output 字段', () => {
  const out = trimForSave([turn('a', { execs: [{ execId: '1', label: 'l', detail: 'd', state: 'running' }] })])
  assert.equal('output' in out[0].execs[0], false)
})

test('图片只留 path，丢掉 url', () => {
  // url 可能是几百 KB 的 data: URI，而且是运行时产物，下次进程不一定还有效
  const out = trimForSave([turn('a', { role: 'user', images: [{ path: '/a/b.png', url: 'data:image/png;base64,AAAA' }] })])
  assert.equal(out[0].images![0].path, '/a/b.png')
  assert.equal(out[0].images![0].url, '')
})

test('没有图片的轮次不会长出空的 images 字段', () => {
  const out = trimForSave([turn('a')])
  assert.equal('images' in out[0], false)
})

test('读回来时把卡在 running 的命令落到 failed', () => {
  // 进程早就没了，不会再有事件来收尾；原样渲染界面上会有个永远转不完的圈
  const out = settleOnLoad([turn('a', { execs: [
    { execId: '1', label: 'l', detail: 'd', state: 'running' },
    { execId: '2', label: 'l', detail: 'd', state: 'ok' }
  ] })])
  assert.equal(out[0].execs[0].state, 'failed')
  assert.equal(out[0].execs[1].state, 'ok', '已经有结果的不动')
})

test('空数组安全', () => {
  assert.deepEqual(trimForSave([]), [])
  assert.deepEqual(settleOnLoad([]), [])
})

// ── 这份历史模型还接不接得回 ─────────────────────────────────────

test('resumeId 对得上 → 接得回', () => {
  assert.equal(contextLostOf('sess-1', 'sess-1'), false)
})

test('resumeId 对不上 / pane 上被清空 → 接不回', () => {
  assert.equal(contextLostOf('sess-1', 'sess-2'), true, '换过 CLI 或另起了会话')
  assert.equal(contextLostOf('sess-1', ''), true, 'resume 失败被 fallback 清掉过')
  assert.equal(contextLostOf('sess-1', undefined), true, 'pane 上压根没有')
})

test('历史里没记 resumeId → 一律当接得上（宁可漏报不误报）', () => {
  // 旧版本写的记录、或者存得太早（session.ready 还没到）都会是 null。
  // 误报会让人不信任正常的恢复；漏报最多是没提示，那正是上线前的状态
  assert.equal(contextLostOf(null, 'sess-1'), false)
  assert.equal(contextLostOf(null, undefined), false)
})
