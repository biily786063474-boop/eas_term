import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSeq, mergeArchiveTurns, tailWindow, assignLegacySeq } from './historyArchive.ts'

// 完整归档（2026-09-14）：磁盘不再只留最近 100 条。做法是每条消息一个稳定序号，
// 主进程保存时按序号做并集：内存里被裁掉的旧消息保留、同序号的以新来的为准。
type T = { role: 'user' | 'assistant'; text: string; execs: never[]; seq?: number }
const t = (seq: number, text = String(seq)): T => ({ role: 'assistant', text, execs: [], seq })

test('序号：进程内严格递增，且不小于产生时刻的毫秒数（重启后天然大于旧记录）', () => {
 const next = createSeq()
 const before = Date.now()
 const a = next(), b = next(), c = next()
 assert.ok(a >= before); assert.ok(b > a && c > b)
})

test('并集：内存裁掉的旧消息保留，同序号新来覆盖，按序号排序', () => {
 const prev = [t(1, '旧1'), t(2, '旧2'), t(3, '旧3-半截')]
 const incoming = [t(3, '新3-完整'), t(4, '新4')] // 窗口只带了 3、4
 const merged = mergeArchiveTurns(prev, incoming)
 assert.deepEqual(merged.map(x => [x.seq, x.text]), [[1, '旧1'], [2, '旧2'], [3, '新3-完整'], [4, '新4']])
})

test('旧档没有序号：按下标补一个小序号，落在任何新消息之前', () => {
 const legacy = assignLegacySeq([{ role: 'user', text: 'a', execs: [] }, { role: 'assistant', text: 'b', execs: [] }] as T[])
 assert.deepEqual(legacy.map(x => x.seq), [0, 1])
 const merged = mergeArchiveTurns(legacy, [t(Date.now(), '新')])
 assert.deepEqual(merged.map(x => x.text), ['a', 'b', '新'])
})

test('并集不吃没有序号的新消息：给它追加序号而不是丢掉', () => {
 const merged = mergeArchiveTurns([t(10)], [{ role: 'user', text: '无号', execs: [] } as T])
 assert.equal(merged.length, 2); assert.equal(merged[1].text, '无号'); assert.ok((merged[1].seq ?? 0) > 10)
})

test('窗口：只取最近 n 条，顺序不变', () => {
 assert.deepEqual(tailWindow([t(1), t(2), t(3)], 2).map(x => x.seq), [2, 3])
 assert.deepEqual(tailWindow([t(1)], 5).map(x => x.seq), [1])
})
