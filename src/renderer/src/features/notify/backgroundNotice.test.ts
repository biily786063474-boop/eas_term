import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import {
  pickNoticeSound,
  backgroundMarkFor,
  createBackgroundGrace,
  applyChatSignal,
  expireBackgroundGrace,
  ringKeyOf,
  retireChatSession,
  BACKGROUND_WAKE_GRACE_MS
} from './backgroundNotice.ts'
import { noticeIdOf } from '../status/machine.ts'
import { usesZh } from '../../../../shared/i18n/testKeys.ts'

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

test('同批只响一声：混合批（完成+后台+审批）得到唯一一个 kind，且按优先级取最急的', () => {
  const approval = { c: { question: 'q' } }
  const background = { b: { at: 1, count: 1 } }
  // 同一批三条三种：结果是审批，不因顺序变化
  for (const order of [['a', 'b', 'c'], ['c', 'b', 'a'], ['b', 'a', 'c']]) {
    assert.equal(pickNoticeSound(order, approval, background), 'approval')
  }
  // 去掉审批那条：完成与后台混在一起 → 后台，不是 done
  assert.equal(pickNoticeSound(['a', 'b'], approval, background), 'background')
  assert.equal(pickNoticeSound(['b', 'a'], approval, background), 'background')
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

// ── 后台清空 → 续轮之间（2026-09-29 真机闪现：后台清空那一刻弹出无声「已完成」卡片，
//    正文「未取得该模块本轮的最终回答」，约 0.3s 后折回）。以下场景跑的是**真 uiSlice**。──

/** 手动推进的假定时器 */
function fakeTimers() {
  let seq = 0
  const pending = new Map<number, { fn: () => void; due: number }>()
  let now = 0
  return {
    set(fn: () => void, ms: number): unknown { const id = ++seq; pending.set(id, { fn, due: now + ms }); return id },
    clear(h: unknown): void { pending.delete(h as number) },
    advance(ms: number): void {
      now += ms
      for (const [id, t] of [...pending].sort((a, b) => a[1].due - b[1].due)) {
        if (t.due <= now && pending.has(id)) { pending.delete(id); t.fn() }
      }
    },
    count: (): number => pending.size
  }
}

/** 把 uiSlice.ts 原样编译进一个沙箱，拿到真 store（Date.now 由 clock 控制） */
function realStore(clock: { now: number }) {
  const code = transformSync(fs.readFileSync(new URL('../../store/uiSlice.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code
  const module = { exports: {} as any }
  const req = (m: string): unknown =>
    m.includes('themes') ? { loadTheme: () => 'dark', applyTheme() {}, watchSystemTheme: () => () => {} }
      : m.includes('chipTargets') ? { withChipTarget: (a: unknown) => a, withoutChipTarget: (a: unknown) => a } : {}
  const store = new Map<string, string>()
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }
  class FakeDate extends Date { static now(): number { return clock.now } }
  runInNewContext(code, { module, exports: module.exports, require: req, localStorage: ls, Date: FakeDate, console,
    window: { api: {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) } })
  let state: any
  const set = (p: any): void => { const patch = typeof p === 'function' ? p(state) : p; if (patch !== state) state = { ...state, ...patch } }
  state = module.exports.createUiSlice(set, () => state, {})
  return { getState: () => state }
}

const SID = 'ac-1'
const view = (busy: boolean, bg: string[] = []) => ({ busy, background: bg.map((label) => ({ label })) })

/** 走到「本轮说完、后台还有 1 个任务、已提醒为后台运行中」这一刻 */
function afterBackgroundNotice() {
  const clock = { now: 1000 }
  const timers = fakeTimers()
  const s = realStore(clock)
  let expired = 0
  const grace = createBackgroundGrace(timers, () => { expired++; expireBackgroundGrace(s.getState, SID, () => {}) })
  const ev = (k: string, v: ReturnType<typeof view>): void => { applyChatSignal(s.getState(), SID, k, v, grace) }
  ev('turn.start', view(true))
  clock.now = 2000
  ev('background.tasks', view(true, ['npm test']))
  clock.now = 3000
  ev('turn.done', view(false, ['npm test']))
  // AgentChatView.flagDone：先打标记再 flag
  s.getState().setPtyBackground(SID, backgroundMarkFor(view(false, ['npm test']), clock.now))
  s.getState().flagAttention(SID)
  const idOf = (): string => noticeIdOf(SID, s.getState().ptyBackground[SID], s.getState().ptyTiming[SID]?.lastDoneAt)
  const ringOf = (): string => ringKeyOf(SID, s.getState().ptyBackground[SID])
  return { clock, timers, s, grace, ev, idOf, ringOf, expired: () => expired }
}

test('前提：后台运行中提醒已挂上，播的是后台音', () => {
  const h = afterBackgroundNotice()
  const st = h.s.getState()
  assert.deepEqual([...st.attentionPtys], [SID])
  assert.ok(st.ptyBackground[SID])
  assert.ok(st.runningPtys.includes(SID))
  assert.equal(pickNoticeSound([SID], st.ptyApproval, st.ptyBackground), 'background')
})

test('后台清空、续轮还没开始 → 不产生新通知：标记/提醒/通知 id/响铃键都不变，运行态撑住', () => {
  const h = afterBackgroundNotice()
  const id0 = h.idOf(), ring0 = h.ringOf(), done0 = h.s.getState().ptyTiming[SID]?.lastDoneAt
  h.clock.now = 4000
  h.ev('background.tasks', view(false, []))
  h.timers.advance(BACKGROUND_WAKE_GRACE_MS - 100)
  const st = h.s.getState()
  assert.ok(st.ptyBackground[SID], '标记不能在后台清空时摘')
  assert.deepEqual([...st.attentionPtys], [SID])
  assert.ok(st.runningPtys.includes(SID), '运行态不能落下（一落下 lastDoneAt 就变）')
  assert.equal(st.ptyTiming[SID]?.lastDoneAt, done0)
  assert.equal(h.idOf(), id0, '通知 id 变了 = 灵动岛会弹一张新卡片')
  assert.equal(h.ringOf(), ring0, '响铃键变了 = 会再响一次')
  assert.equal(h.expired(), 0)
})

test('5 秒内续轮 turn.start → 清提醒、摘标记、取消宽限；这一轮结束前不出现「完成」', () => {
  const h = afterBackgroundNotice()
  h.ev('background.tasks', view(false, []))
  h.timers.advance(2000)
  h.ev('turn.start', view(true))
  let st = h.s.getState()
  assert.deepEqual([...st.attentionPtys], [])
  assert.equal(st.ptyBackground[SID], undefined)
  assert.equal(h.timers.count(), 0, '宽限定时器必须随 turn.start 取消')
  h.ev('text.delta', view(true))
  h.timers.advance(10_000)
  st = h.s.getState()
  assert.equal(h.expired(), 0)
  assert.deepEqual([...st.attentionPtys], [], '续轮还在跑，不许有「完成」')
  assert.ok(st.runningPtys.includes(SID))
  // 续轮结束：普通 flag，背景空 → 无标记 → done
  h.ev('turn.done', view(false, []))
  h.s.getState().setPtyBackground(SID, backgroundMarkFor(view(false, []), 9999))
  h.s.getState().flagAttention(SID)
  st = h.s.getState()
  assert.equal(pickNoticeSound([SID], st.ptyApproval, st.ptyBackground), 'done')
  assert.equal(h.timers.count(), 0)
})

test('5 秒内没有续轮 → 转成普通完成：运行态落下、标记摘掉、新通知 id、响铃键变化且播 done', () => {
  const h = afterBackgroundNotice()
  const id0 = h.idOf(), ring0 = h.ringOf()
  h.clock.now = 4000
  h.ev('background.tasks', view(false, []))
  h.clock.now = 9000
  h.timers.advance(BACKGROUND_WAKE_GRACE_MS)
  const st = h.s.getState()
  assert.equal(h.expired(), 1)
  assert.equal(st.ptyBackground[SID], undefined)
  assert.deepEqual([...st.attentionPtys], [SID], '提醒保留，改成完成')
  assert.ok(!st.runningPtys.includes(SID))
  assert.notEqual(h.idOf(), id0, '新 id → 灵动岛按「完成」弹一次')
  assert.notEqual(h.ringOf(), ring0, '响铃键变化 → useNoticeSound 当成新的一条')
  assert.equal(pickNoticeSound([SID], st.ptyApproval, st.ptyBackground), 'done')
})

test('宽限中又来了新的后台任务 → 取消宽限，继续按后台运行中', () => {
  const h = afterBackgroundNotice()
  h.ev('background.tasks', view(false, []))
  h.ev('background.tasks', view(false, ['next']))
  assert.equal(h.timers.count(), 0)
  h.timers.advance(10_000)
  assert.equal(h.expired(), 0)
  assert.ok(h.s.getState().ptyBackground[SID])
})

test('dispose（卸载/换会话）取消宽限定时器', () => {
  const h = afterBackgroundNotice()
  h.ev('background.tasks', view(false, []))
  h.grace.dispose()
  assert.equal(h.timers.count(), 0)
  h.timers.advance(10_000)
  assert.equal(h.expired(), 0)
})

test('宽限到期时提醒已被看过 → 只落运行态，不再补一条完成', () => {
  const h = afterBackgroundNotice()
  h.ev('background.tasks', view(false, []))
  h.s.getState().clearAttention(SID)
  h.timers.advance(BACKGROUND_WAKE_GRACE_MS)
  const st = h.s.getState()
  assert.deepEqual([...st.attentionPtys], [])
  assert.ok(!st.runningPtys.includes(SID))
})

test('响铃键：有标记时带标记时刻，标记摘掉后变回 id', () => {
  assert.equal(ringKeyOf('a', undefined), 'a')
  assert.notEqual(ringKeyOf('a', { at: 5 }), 'a')
  assert.notEqual(ringKeyOf('a', { at: 5 }), ringKeyOf('a', { at: 6 }))
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
  // 响过没有按 ringKeyOf 记：宽限到期转完成时要能再响一次 done
  assert.match(src, /ringKeyOf\(id, ptyBackground\[id\]\)/)
  assert.match(src, /\[attentionPtys, ptyBackground\]/)
})

test('设置「声音与提醒」有「后台运行中」试听', () => {
  const src = read('../workspace/SettingsPanel.tsx')
  assert.match(src, /previewNotice\('background'\)/)
  // 按钮文案走词典（英文界面合流后）：源码里用的键，中文就是「后台运行中」
  assert.ok(usesZh(src, '后台运行中', true))
})

test('store：clearAttention 与重新跑起来都连带摘掉 ptyBackground（与 ptyApproval 同生共死）', () => {
  const src = read('../../store/uiSlice.ts')
  const clear = src.slice(src.indexOf('clearAttention: (ptyId) =>'), src.indexOf('setPtyApproval: (ptyId, info) =>'))
  assert.match(clear, /ptyBackground: dropKey\(s\.ptyBackground, ptyId\)/)
  const running = src.slice(src.indexOf('setPtyRunning: (ptyId, running) =>'), src.indexOf('setMcpEnabled: (v) =>'))
  assert.match(running, /ptyBackground: dropKey\(s\.ptyBackground, ptyId\)/)
})

test('AgentChatView：flag 前按视图打标记；事件接线走 applyChatSignal；宽限到期走 expireBackgroundGrace；都在非团队分支里', () => {
  const src = read('../agentChat/AgentChatView.tsx')
  const team = src.indexOf('if (!isTeamOwned) {')
  assert.ok(team > 0)
  for (const needle of ['backgroundMarkFor(', 'applyChatSignal(', 'expireBackgroundGrace(']) {
    assert.ok(src.indexOf(needle) > 0, needle)
  }
  assert.ok(src.indexOf('applyChatSignal(') > team)
  // 宽限定时器随卸载与换会话一起收
  assert.match(src, /bgGraceRef\.current\?\.dispose\(\)/)
  // turn.start 清提醒这件事现在由 applyChatSignal 做（上面场景测试钉着行为），源码里别再手写第二份
  assert.doesNotMatch(src, /if \(e\.k === 'turn\.start'\) st\.clearAttention\(sid\)/)
})

test('applyChatSignal：turn.start 对本会话 clearAttention，且在 setPtyRunning 之前（后台一直在跑时那一跳不会发生）', () => {
  const calls: string[] = []
  const st = {
    clearAttention: (id: string) => calls.push('clear:' + id),
    setPtyRunning: (id: string, r: boolean) => calls.push(`run:${id}:${r}`),
    setPtyBackground: (id: string, m: unknown) => calls.push(`bg:${id}:${m}`)
  }
  applyChatSignal(st, 'x', 'turn.start', view(true, ['still']), createBackgroundGrace(fakeTimers(), () => {}))
  assert.deepEqual(calls, ['clear:x', 'run:x:true', 'bg:x:null'])
})

test('灵动岛卡片：后台运行中不显示耗时（roundMs 为空会显示成「—」）', () => {
  const src = read('../../../island/Island.tsx')
  const meta = src.slice(src.indexOf('<div className="isl-meta">'), src.indexOf('<div className="isl-actions">'))
  assert.match(meta, /n\.background === undefined \? <span>\{fmtDur\(n\.roundMs, tr\)\}<\/span>/)
})

// ── 宽限期 / 后台标记态里开新对话（2026-09-30 T3）：handleNewChat 停了旧会话、收了宽限定时器，
//    但旧会话 id 的运行态 / 提醒 / 标记没人摘——卸载清理读 sessionIdRef 时已是新 id，旧 id 永远「运行中」。──

test('开新对话：旧会话在宽限期内 → 摘掉旧 id 的运行态、提醒、后台标记，并收掉定时器', () => {
  const h = afterBackgroundNotice()
  h.ev('background.tasks', view(false, []))
  assert.ok(h.grace.holding(), '前提：宽限中')
  const retired = retireChatSession(h.s.getState, SID, h.grace, view(false, []))
  const st = h.s.getState()
  assert.equal(retired, true)
  assert.ok(!st.runningPtys.includes(SID), '旧 id 不能留在运行中')
  assert.deepEqual([...st.attentionPtys], [])
  assert.equal(st.ptyBackground[SID], undefined)
  assert.equal(h.timers.count(), 0)
  h.timers.advance(10_000)
  assert.equal(h.expired(), 0, '宽限已收，不能到点再弹一张「完成」')
})

test('开新对话：旧会话挂着后台运行中标记（后台还在跑）→ 一并收尾', () => {
  const h = afterBackgroundNotice()
  const retired = retireChatSession(h.s.getState, SID, h.grace, view(false, ['npm test']))
  const st = h.s.getState()
  assert.equal(retired, true)
  assert.ok(!st.runningPtys.includes(SID))
  assert.deepEqual([...st.attentionPtys], [])
  assert.equal(st.ptyBackground[SID], undefined)
})

test('开新对话：后台还在跑但提醒已被看过（标记随 clearAttention 摘了）→ 旧会话要被停，运行态也要落', () => {
  const h = afterBackgroundNotice()
  h.s.getState().clearAttention(SID)
  assert.ok(h.s.getState().runningPtys.includes(SID))
  assert.equal(retireChatSession(h.s.getState, SID, h.grace, view(false, ['npm test'])), true)
  assert.ok(!h.s.getState().runningPtys.includes(SID))
})

test('开新对话：旧会话普通完成（不在宽限、无标记、无后台）→ 不动它的提醒与运行态', () => {
  const clock = { now: 1000 }
  const timers = fakeTimers()
  const s = realStore(clock)
  const grace = createBackgroundGrace(timers, () => {})
  applyChatSignal(s.getState(), SID, 'turn.start', view(true), grace)
  clock.now = 2000
  applyChatSignal(s.getState(), SID, 'turn.done', view(false), grace)
  s.getState().flagAttention(SID)
  const before = s.getState()
  assert.equal(retireChatSession(s.getState, SID, grace, view(false)), false)
  const st = s.getState()
  assert.deepEqual([...st.attentionPtys], [...before.attentionPtys], '「已完成」提醒照旧留着')
  assert.deepEqual([...st.runningPtys], [...before.runningPtys])
})

test('开新对话：旧会话前台真实运行（busy）→ 不收尾（handleNewChat 本就拦着，这里再兜一层）', () => {
  const clock = { now: 1000 }
  const s = realStore(clock)
  const grace = createBackgroundGrace(fakeTimers(), () => {})
  applyChatSignal(s.getState(), SID, 'turn.start', view(true), grace)
  assert.equal(retireChatSession(s.getState, SID, grace, view(true)), false)
  assert.ok(s.getState().runningPtys.includes(SID))
})

test('AgentChatView.handleNewChat：停旧会话前对旧 id 调 retireChatSession，且在清 sessionId 之前', () => {
  const src = read('../agentChat/AgentChatView.tsx')
  const body = src.slice(src.indexOf('const handleNewChat = async'), src.indexOf('const handlePickRole ='))
  const retire = body.indexOf('retireChatSession(')
  assert.ok(retire > 0, 'handleNewChat 里要调 retireChatSession')
  assert.ok(retire < body.indexOf('setSessionId(null)'))
  assert.ok(retire < body.indexOf('bgGraceRef.current = null'), '要在宽限对象被丢掉之前判断它是否在宽限中')
})
