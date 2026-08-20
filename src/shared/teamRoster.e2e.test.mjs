// 花名册的端到端链路：**真的写文件、真的读回来**，跟主进程那两个 IPC 走同一套路径。
//
// 单测只覆盖纯函数，测不到「文件路径拼对没有、目录不存在时会不会炸、
// 写进去的东西读回来还是不是原样」—— 而那几件正是 2026-08-19 之前
// 一直漏掉的那类问题（分发链三环、id 三层，都是各段单独看都对、连起来断了）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseRoster, addBatch, recentSummary, EMPTY_ROSTER } from './teamRoster.ts'

/** 跟 main/agentHistory.ts 的 rosterFile 保持一致 —— 改那边要改这里 */
const rosterFile = (projectPath) => path.join(projectPath, '.plans', 'team.json')

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-e2e-'))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('派活 → 写盘 → 重启后读回，摘要指得到产出', () => {
  withTempProject((proj) => {
    // ① 全新项目：文件不存在，读出来是空花名册（不是抛错）
    let raw = null
    try {
      raw = fs.readFileSync(rosterFile(proj), 'utf8')
    } catch {
      raw = null
    }
    assert.deepEqual(parseRoster(raw), EMPTY_ROSTER, '没派过活时该是空的')

    // ② 派一批 —— .plans/ 目录此时还不存在，写入必须自己建
    const next = addBatch(parseRoster(raw), {
      id: 'b-1',
      at: Date.now() - 90 * 60000,
      goal: '审查 CSS 重复定义',
      agents: [
        { role: 'css-auditor', task: '扫全部 .css 找重复选择器' },
        { role: 'cross-checker', task: '交叉验证上面那份结论' }
      ]
    })
    const f = rosterFile(proj)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify(next, null, 2))

    // ③ 模拟 app 重启 / 上下文压缩：只剩磁盘上这个文件
    const reread = parseRoster(fs.readFileSync(f, 'utf8'))
    assert.equal(reread.batches.length, 1)
    assert.equal(reread.batches[0].goal, '审查 CSS 重复定义')
    assert.deepEqual(
      reread.batches[0].agents.map((a) => a.role),
      ['css-auditor', 'cross-checker']
    )
    // task 原文要活过一轮 JSON —— 「重派是一条命令」靠的就是它
    assert.equal(reread.batches[0].agents[0].task, '扫全部 .css 找重复选择器')

    // ④ 主 agent 那句话：说得出多久以前、谁、以及产出在哪
    const s = recentSummary(reread, Date.now())
    assert.match(s, /2 小时前|1 小时前/)
    assert.match(s, /css-auditor/)
    assert.match(s, /findings\.md/)
  })
})

test('文件被写坏之后，派活链路仍然走得通（退化成空、然后重建）', () => {
  withTempProject((proj) => {
    const f = rosterFile(proj)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, '{ 这不是 JSON')

    const r = parseRoster(fs.readFileSync(f, 'utf8'))
    assert.deepEqual(r, EMPTY_ROSTER, '坏文件不该抛，否则整次派活失败')

    const next = addBatch(r, { id: 'b-2', at: Date.now(), goal: 'g', agents: [{ role: 'r', task: 't' }] })
    fs.writeFileSync(f, JSON.stringify(next))
    assert.equal(parseRoster(fs.readFileSync(f, 'utf8')).batches.length, 1, '下一次派活把它修回来了')
  })
})

test('连派多批：最新的排前面，产出目录互不影响', () => {
  withTempProject((proj) => {
    const f = rosterFile(proj)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    let r = EMPTY_ROSTER
    for (let i = 1; i <= 3; i++) {
      r = addBatch(r, { id: `b-${i}`, at: i * 1000, goal: `第 ${i} 批`, agents: [{ role: `r${i}`, task: 't' }] })
      fs.writeFileSync(f, JSON.stringify(r))
      r = parseRoster(fs.readFileSync(f, 'utf8')) // 每轮都过一遍磁盘
    }
    assert.deepEqual(r.batches.map((b) => b.goal), ['第 3 批', '第 2 批', '第 1 批'])
  })
})
