// 2026-09-30 用户反馈「执行清单时好时坏」：报「执行清单缺少有效项目或轮次」，一轮之内先好后坏、换一轮又好。
// 根因：后台任务在本轮结束**之后**才跑完时，Claude 会自己续一轮（task_notification → background.wake），
// session.ts 为它补了 turn.start，却没开执行清单轮次（ensurePlanTurn 只在三条用户发送路径上）；
// 上一轮的 turn.done 已经 endPlanTurn，于是续上的这一轮里清单工具一律找不到轮次（pluginHost 报上面那句）。
// 用真实录制的 Claude 输出（__fixtures__/claude-background-shell.jsonl：用户一轮 + 后台跑完后自发一轮）
// 驱动 session.ts 里真实的 handleEvent / wireProc，清单轮次用真实的 executionPlanTurns。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import { createClaudeTranslator } from './claudeEvents.ts'
import { absorbSelfInitiatedDone } from './sessionState.ts'
import * as turns from './executionPlanTurns.ts'

const source = ts.createSourceFile('session.ts', fs.readFileSync(new URL('./session.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const names = ['handleEvent', 'wireProc', 'feed', 'finishCliDispatch']
const code = ts.transpileModule(source.statements.filter((n) => ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? '')).map((n) => n.getText(source)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const lines = fs.readFileSync(path.join(import.meta.dirname, '__fixtures__', 'claude-background-shell.jsonl'), 'utf8').split('\n').filter(Boolean)

function fixture(id: string) {
  const noop = (): void => {}, events: any[] = []
  const probes: { at: string; turn: ReturnType<typeof turns.activePlanTurn> }[] = []
  const proc = Object.assign(new EventEmitter(), { stdout: Object.assign(new EventEmitter(), { setEncoding: noop }), stderr: Object.assign(new EventEmitter(), { setEncoding: noop }) })
  const live: any = { rec: { id, cli: 'claude', cwd: '/fixture', alive: true, busy: false }, wcId: 1, proc, stdoutBuf: '', translator: createClaudeTranslator() }
  const api = runInNewContext(code + '\n({wireProc,handleEvent})', {
    Date, setTimeout, clearTimeout, crypto, queueMicrotask: noop, executionPlanEnabled: () => true,
    activePlanTurn: turns.activePlanTurn, ensurePlanTurn: turns.ensurePlanTurn, endPlanTurn: turns.endPlanTurn,
    retirePlanTurn: turns.retirePlanTurn, notePlanExec: turns.notePlanExec, planRecovery: () => null,
    cliTurnQueue: { networkFailure: noop, networkSuccess: noop }, sessions: new Map([[id, live]]),
    ownedSessions: { add: noop }, resetUsageCost: noop, projectAttribution: () => null, loadProjects: () => [], runtimeProcessGeneration: 0, createStderrDiagnostics: () => ({ push: () => false }), unauthedInLine: () => null,
    isSilenced: () => false, captureUsage: noop, observePluginTurn: noop, BG_TOOLS: new Set(), getAdapter: () => ({}),
    scheduleApiRefresh: noop, scheduleOmpRefresh: noop, refreshBoard: noop, projectRootOf: (s: string) => s, tally: (p: any) => p, ZERO_TALLY: {},
    transcripts: { push: noop, notePartial: noop }, timelineRuntime: { begin: noop, text: noop, end: noop },
    emitEvent: (_: any, e: any) => {
      events.push(e)
      // 模型在续上的那一轮里说话 / 调工具时，清单工具能不能找到轮次
      if (e.k === 'text.done' || e.k === 'exec.start') probes.push({ at: e.k === 'text.done' ? e.text : e.k, turn: turns.activePlanTurn(id) })
    },
    ingestChatQuota: noop, signalPlanStop: noop, planIdleSink: noop, absorbSelfInitiatedDone, logSession: noop, finishCliDispatch: noop
  })
  api.wireProc(live, proc)
  // 用户发消息：与 session.ts 发送路径一致——先开清单轮次，再推 turn.start
  turns.ensurePlanTurn(id, () => 'user-turn')
  api.handleEvent(live, { k: 'turn.start' })
  const feed = (): void => { for (const l of lines) proc.stdout.emit('data', l + '\n') }
  return { api, live, events, probes, feed }
}

test('后台任务在本轮结束后才跑完：CLI 自己续上的那一轮里，执行清单仍有轮次', () => {
  const f = fixture('wake')
  f.feed()
  // background.wake 在 handleEvent 里处理完就返回、不往外发；用「第一次本轮结束之后」定位续上的那一轮
  assert.equal(f.events.filter((e) => e.k === 'turn.done').length, 2, '样本是用户一轮 + 续上一轮')
  const finished = f.probes.find((p) => p.at === 'FINISHED')
  assert.ok(finished, '样本里续上的那一轮应说出 FINISHED')
  assert.ok(finished!.turn, '续上的那一轮说话时必须有执行清单轮次（否则清单工具报「缺少有效项目或轮次」）')
  assert.notEqual(finished!.turn!.turnId, 'user-turn', '续上的那一轮是新轮次，不复用已结束的用户轮次')
  assert.equal(turns.activePlanTurn('wake'), null, '续上的那一轮结束后轮次照常收掉')
})

test('续上的那一轮结束不发「本轮没有建清单」：清单在用户那一轮已经建了，续轮多半只是收尾', () => {
  const f = fixture('quiet')
  f.feed()
  const done = f.events.map((e, i) => [e, i] as const).filter(([e]) => e.k === 'turn.done')
  assert.equal(done.length, 2, '样本是用户一轮 + 续上一轮')
  const missing = f.events.map((e, i) => [e, i] as const).filter(([e]) => e.k === 'plan.missing')
  // 用户那一轮没建清单，照旧提示一次；续上的那一轮不再重复提示
  assert.equal(missing.length, 1)
  assert.ok(missing[0][1] < done[1][1], '唯一那条提示属于用户那一轮')
})

test('续上的那一轮进行中用户发了新消息：这一轮归用户，结束时照常判断有没有建清单', () => {
  const id = 'claimed'
  turns.beginPlanTurn(id, 'self', { continuation: true })
  // 用户发送路径：ensurePlanTurn 拿到的是已有的续轮，要改成用户的
  const claimed = turns.ensurePlanTurn(id, () => 'unused')
  assert.equal(claimed.turnId, 'self')
  assert.deepEqual(turns.endPlanTurn(id, 'self', { interrupted: false }), { k: 'plan.missing', executed: false })
  // 没人认领的续轮：结束时不提示
  turns.beginPlanTurn(id, 'self2', { continuation: true })
  assert.equal(turns.endPlanTurn(id, 'self2', { interrupted: false }), null)
})
