// **隔离基线（上半场）**：Claude / Codex 的「CLI 原始输出 → ChatEvent」逐字快照。
// 下半场（「ChatEvent → 界面视图」）在 `src/renderer/src/features/agentChat/isolationBaseline.test.ts`，
// 它读本文件产出的这份 JSON 接着往下钉。
//
// ── 这两个文件为什么存在 ───────────────────────────────────────────────────
// omp 底座接入（docs/superpowers/specs/2026-09-01-omp-底座接入-design.md）立了一条红线：
// **「OMP 的接入不要影响 CC 和 codex 的任何方面」**。那份 spec 的 §12.1 列了六条隔离判据，
// 其中五条是 `git diff` 与 `grep` —— 它们只能证明「文件没被改」，证明不了「行为没变」。
// 而这次接入要动的恰恰是两边共用的东西：
//
//   · `shared/agentChat.ts` 加 `ChatEvent` 变体、把 `error.kind` 放宽成 'auth' | 'setup'
//   · `reduce.ts` 加 `case 'capabilities'`、`Notice.kind` 跟着放宽
//   · `session.ts` 加九处分支（声称「对旧 adapter 恒为 no-op」—— 「恒为」是需要被证明的）
//
// 这些改动一个 `-` 号都不会出现在 diff 里，全是新增的 `if` 和新增的 `case`。
// 唯一能抓住「新增的东西悄悄改了旧行为」的，是把旧行为**逐字钉下来**。
//
// ── 为什么它不花钱、不起进程 ───────────────────────────────────────────────
// spec 原本指望 `scripts/verify-agent-chat.mjs` 做运行时判据，但它要真的起 Claude、真的
// 花额度，且写死了 `cli:'claude'`、没有 interrupt/stop 两步；`verify-agent-chat-ui.mjs`
// 的 main.tsx 锚点早就对不上、当前根本跑不起来（`docs/architecture/14-验证与调试.md` 有记）。
// 这里改成喂**真录的 fixture**（`claude-*.jsonl` / `codex-*.jsonl` 是 2026-08-14 真跑出来的
// CLI 输出）：不起 CLI、不连网、不花一分钱，几十毫秒跑完，因此能挂进 `npm run check`。
//
// ── 为什么拆成两个单层文件，而不是一个跨层文件 ─────────────────────────────
// 要保护的契约本身是跨层的（主进程的翻译器 → 渲染层的归约器），但**两个 tsconfig 都是
// `composite: true`**：一个文件 import 另一半的代码，`tsc` 直接报 TS6307「不在本项目文件
// 列表里」。想修就得往共享 tsconfig 里加 include —— 那等于为了造隔离证明先把分层撬开一道口。
// 所以改成：上半场只 import 主进程的东西，把事件流落成 JSON；下半场只 import 渲染层的东西，
// 把那份 JSON 当**数据**读进来。两边都不 import 对方的代码，共享配置一个字节不动。
//
// ── 红了怎么办 ─────────────────────────────────────────────────────────────
// 1. 先看 `git diff` 快照文件 —— 它逐字告诉你哪个事件、哪个字段变了。
// 2. **默认假设是你改坏了 CC/Codex**，不是基线过期。这条基线的全部价值就在于「不轻易更新」；
//    随手 `EAS_BASELINE_UPDATE=1` 刷一遍等于把红线擦掉。
// 3. 真的是有意改动，再重生成（**两个文件都要跑，先上半场后下半场**）：
//      EAS_BASELINE_UPDATE=1 node --test src/main/agentChat/isolationBaseline.test.ts
//      EAS_BASELINE_UPDATE=1 node --test src/renderer/src/features/agentChat/isolationBaseline.test.ts
//    并在 commit message 里写明为什么这次行为该变。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { createClaudeTranslator } from './claudeEvents.ts'
import { createCodexTranslator } from './codexEvents.ts'
import type { ChatEvent } from '../../shared/agentChat.ts'

const FIXTURES = path.join(import.meta.dirname, '__fixtures__')
/** 下半场按相对路径读它。改名要同时改那边（那是一条 fixture 路径耦合，没有编译期保护）。 */
const SNAPSHOT = path.join(FIXTURES, 'isolation-events.json')

/** 重生成快照。**别顺手用它** —— 见文件头「红了怎么办」第 2 条。 */
const UPDATE = process.env.EAS_BASELINE_UPDATE === '1'

interface Case {
  name: string
  fixture: string
  make: () => { push(line: string): ChatEvent[] }
}

// **`thinkingThrottleMs: 0` 是让这条基线可复现的关键**：claudeEvents 的 thinking 节流读
// `Date.now()`（那是它唯一的不确定量），默认节流下同一份 fixture 每次跑产出的 thinking
// 条数都不一样。给 0 让判据 `now - last < 0` 恒假 —— 每条都放行，于是完全确定。
// 节流本身的行为由 claudeEvents.test.ts 单独管，这里不重复测。
const CASES: Case[] = [
  { name: 'claude-hook-approved', fixture: 'claude-hook-approved.jsonl', make: () => createClaudeTranslator({ thinkingThrottleMs: 0 }) },
  { name: 'claude-permission-denied', fixture: 'claude-permission-denied.jsonl', make: () => createClaudeTranslator({ thinkingThrottleMs: 0 }) },
  { name: 'claude-unauthed', fixture: 'claude-unauthed.jsonl', make: () => createClaudeTranslator({ thinkingThrottleMs: 0 }) },
  { name: 'codex-exec-write', fixture: 'codex-exec-write.jsonl', make: createCodexTranslator },
  { name: 'codex-exec-fail', fixture: 'codex-exec-fail.jsonl', make: createCodexTranslator },
  { name: 'codex-unauthed', fixture: 'codex-unauthed.jsonl', make: createCodexTranslator }
]

interface Shot {
  /** 事件种类序列（压缩成一行）。内容对不上时先看它变没变：
   *  变了 = 事件的产出顺序/条数变了；没变 = 只是某个字段的值变了。 */
  kinds: string
  /** 翻译器产出的完整事件流 —— 主进程侧的契约，也是下半场的输入。 */
  events: ChatEvent[]
}

function run(c: Case): Shot {
  const lines = fs.readFileSync(path.join(FIXTURES, c.fixture), 'utf8').split('\n').filter(Boolean)
  const t = c.make()
  const events: ChatEvent[] = []
  for (const l of lines) events.push(...t.push(l))
  // JSON 往返一次：把 undefined 字段统一掉，好让「快照里长什么样」和「断言时比什么」
  // 是同一个东西（也保证下半场读到的与这里断言的完全一致）。
  return { kinds: events.map((e) => e.k).join(' '), events: JSON.parse(JSON.stringify(events)) as ChatEvent[] }
}

if (UPDATE) {
  const next: Record<string, Shot> = {}
  for (const c of CASES) next[c.name] = run(c)
  fs.writeFileSync(SNAPSHOT, JSON.stringify(next, null, 1) + '\n')
  console.log(`[isolationBaseline] 已重生成 ${SNAPSHOT}（${CASES.length} 个用例）`)
}

let snap: Record<string, Shot> = {}
try {
  snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as Record<string, Shot>
} catch {
  snap = {}
}

// 用例名少一个 = 有人删了一条基线，那和「改坏了」一样严重，
// 所以它自己也是一条断言，不能只在遍历里靠 `?.` 悄悄跳过。
test('基线覆盖的用例一个都不许少', () => {
  assert.deepEqual(Object.keys(snap).sort(), CASES.map((c) => c.name).sort())
})

for (const c of CASES) {
  test(`${c.name}：翻译器产出的事件流逐字不变`, () => {
    const got = run(c)
    const want = snap[c.name]
    assert.ok(want, `快照里没有 ${c.name} —— 先跑 EAS_BASELINE_UPDATE=1 生成`)
    assert.equal(got.kinds, want.kinds, '事件种类序列变了 —— 翻译器的产出顺序或条数被改动了')
    assert.deepEqual(got.events, want.events, '事件内容变了 —— 翻译器的字段产出被改动了')
  })
}
