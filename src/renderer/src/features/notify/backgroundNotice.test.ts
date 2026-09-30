import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  pickNoticeSound,
  backgroundMarkFor,
  shouldDropBackgroundMark
} from './backgroundNotice.ts'

test('提示音优先级：批次里有审批 → approval（压过后台运行中和完成）', () => {
  assert.equal(pickNoticeSound(['a', 'b', 'c'], { b: { question: 'q' } }, { a: { at: 1, count: 1 } }), 'approval')
})

test('提示音优先级：无审批、有后台运行中 → background', () => {
  assert.equal(pickNoticeSound(['a', 'b'], {}, { b: { at: 1, count: 1 } }), 'background')
})

test('提示音优先级：都没有 → done', () => {
  assert.equal(pickNoticeSound(['a'], {}, {}), 'done')
})

test('只看本批：别的终端的审批/后台标记不影响这一批', () => {
  assert.equal(pickNoticeSound(['a'], { z: { question: 'q' } }, { y: { at: 1, count: 1 } }), 'done')
})

test('同批只响一声：返回单个 kind 而不是每条一个', () => {
  const r = pickNoticeSound(['a', 'b', 'c'], {}, { a: { at: 1, count: 1 }, c: { at: 1, count: 1 } })
  assert.equal(typeof r, 'string')
})

test('turn.done 时后台还有任务 → 打标记，带任务名与个数', () => {
  const m = backgroundMarkFor({ background: [{ label: 'npm test' }, { label: 'sleep 30' }] }, 42)
  assert.deepEqual(m, { at: 42, count: 2, label: 'npm test' })
})

test('后台为空 → 不打标记（照常按「完成」）', () => {
  assert.equal(backgroundMarkFor({ background: [] }, 42), null)
})

test('超长任务名截断，不把整行命令塞进灵动岛', () => {
  const m = backgroundMarkFor({ background: [{ label: 'x'.repeat(200) }] }, 1)!
  assert.ok(m.label.length <= 40)
  assert.ok(m.label.endsWith('…'))
})

test('任务名里的换行压成空格', () => {
  const m = backgroundMarkFor({ background: [{ label: 'a\nb  c' }] }, 1)!
  assert.equal(m.label, 'a b c')
})

test('新回合开始 → 摘标记', () => {
  assert.equal(shouldDropBackgroundMark('turn.start', { background: [{ label: 'x' }] }), true)
})

test('后台清空 → 摘标记', () => {
  assert.equal(shouldDropBackgroundMark('background.tasks', { background: [] }), true)
  assert.equal(shouldDropBackgroundMark('text.delta', { background: [] }), true)
})

test('后台仍在跑、不是新回合 → 保留标记', () => {
  assert.equal(shouldDropBackgroundMark('turn.done', { background: [{ label: 'x' }] }), false)
  assert.equal(shouldDropBackgroundMark('background.tasks', { background: [{ label: 'y' }] }), false)
})

// ── 接线的源码断言：这几处漏一处都不报错，只是声音/文案悄悄不对 ──
const read = (p: string): string => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

test('sound.ts 有第三种 kind：background，且 previewNotice 接得住', () => {
  const src = read('./sound.ts')
  assert.match(src, /export type NoticeKind = 'done' \| 'approval' \| 'background'/)
  assert.match(src, /export function playNotice\(kind: NoticeKind\)/)
  assert.match(src, /export function previewNotice\(kind: NoticeKind\)/)
  assert.match(src, /kind === 'background'/)
})

test('useNoticeSound 走 pickNoticeSound，读 ptyBackground', () => {
  const src = read('./useNoticeSound.ts')
  assert.match(src, /pickNoticeSound\(/)
  assert.match(src, /ptyBackground/)
})

test('设置「声音与提醒」有「后台运行中」试听', () => {
  const src = read('../workspace/SettingsPanel.tsx')
  assert.match(src, /previewNotice\('background'\)/)
  assert.match(src, /后台运行中/)
})

test('store：clearAttention 与重新跑起来都连带摘掉 ptyBackground（与 ptyApproval 同生共死）', () => {
  const src = read('../../store/uiSlice.ts')
  const clear = src.slice(src.indexOf('clearAttention: (ptyId) =>'), src.indexOf('setPtyApproval: (ptyId, info) =>'))
  assert.match(clear, /ptyBackground: dropKey\(s\.ptyBackground, ptyId\)/)
  const running = src.slice(src.indexOf('setPtyRunning: (ptyId, running) =>'), src.indexOf('setMcpEnabled: (v) =>'))
  assert.match(running, /ptyBackground: dropKey\(s\.ptyBackground, ptyId\)/)
})

test('AgentChatView：flag 前按视图打标记；turn.start/后台清空时摘；只在非团队分支里', () => {
  const src = read('../agentChat/AgentChatView.tsx')
  assert.match(src, /backgroundMarkFor\(/)
  assert.match(src, /shouldDropBackgroundMark\(e\.k, v\)/)
  const team = src.indexOf('if (!isTeamOwned) {')
  assert.ok(team > 0 && src.indexOf('backgroundMarkFor(') > team)
  assert.ok(src.indexOf('shouldDropBackgroundMark(') > team)
})
