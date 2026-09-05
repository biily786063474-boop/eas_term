import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resumeOwnerOf } from './resumeOwner.ts'
import { encodeCwd } from '../sessionPaths.ts'

/** 在临时目录里搭出三个 harness 的会话存放结构 */
function world(): { home: string; userData: string; cwd: string; rm: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-owner-'))
  const home = path.join(root, 'home')
  const userData = path.join(root, 'userData')
  const cwd = '/Users/x/Biily/Projects/Ipad延伸'
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  return { home, userData, cwd, rm: () => fs.rmSync(root, { recursive: true, force: true }) }
}

const CLAUDE_ID = '34d67c8b-ed49-4fe1-92b8-b2a452d775dd'
const CODEX_ID = '019faca0-7287-7432-a1d6-bc16267a2415'
const OMP_ID = 'omp-sess-0001'

function putClaude(w: ReturnType<typeof world>, id: string, cwd = w.cwd): void {
  const d = path.join(w.home, '.claude', 'projects', encodeCwd(cwd))
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, `${id}.jsonl`), '{}\n')
}
function putCodex(w: ReturnType<typeof world>, id: string): void {
  const d = path.join(w.home, '.codex', 'sessions', '2026', '09', '04')
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, `rollout-2026-09-04T10-00-00-${id}.jsonl`), '{}\n')
}
function putOmp(w: ReturnType<typeof world>, id: string): void {
  const d = path.join(w.userData, 'omp', 'agent', 'sessions', encodeCwd(w.cwd), id)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'state.json'), '{}\n')
}

test('Claude 签发的 id → claude（按 cwd 编码的目录里找 <id>.jsonl）', () => {
  const w = world()
  try {
    putClaude(w, CLAUDE_ID)
    assert.equal(resumeOwnerOf(CLAUDE_ID, w.cwd, w), 'claude')
  } finally {
    w.rm()
  }
})

test('Codex 签发的 id → codex（文件名以 -<id>.jsonl 结尾）', () => {
  const w = world()
  try {
    putCodex(w, CODEX_ID)
    assert.equal(resumeOwnerOf(CODEX_ID, w.cwd, w), 'codex')
  } finally {
    w.rm()
  }
})

test('omp 签发的 id → omp', () => {
  const w = world()
  try {
    putOmp(w, OMP_ID)
    assert.equal(resumeOwnerOf(OMP_ID, w.cwd, w), 'omp')
  } finally {
    w.rm()
  }
})

// ── 这条就是 2026-09-04 的事故形状 ──────────────────────────────────────────
// Claude 的会话文件在，omp 那边**同一个 cwd 的目录存在但是空的**（omp 被错误地
// 拿这个 cwd 起过一次，建了目录，什么都没写）。签发者必须判成 claude，
// 绝不能因为 omp 有个同名空目录就归给 omp。
test('**Claude 的 id 不会因为 omp 有个同 cwd 的空目录而被认成 omp**', () => {
  const w = world()
  try {
    putClaude(w, CLAUDE_ID)
    fs.mkdirSync(path.join(w.userData, 'omp', 'agent', 'sessions', encodeCwd(w.cwd)), { recursive: true })
    assert.equal(resumeOwnerOf(CLAUDE_ID, w.cwd, w), 'claude')
  } finally {
    w.rm()
  }
})

test('三处都没有 → null（会话被清理了 / 换了机器），不抛', () => {
  const w = world()
  try {
    assert.equal(resumeOwnerOf(CLAUDE_ID, w.cwd, w), null)
  } finally {
    w.rm()
  }
})

test('项目改过名：旧路径的 Claude 目录也要找（pastPaths）', () => {
  const w = world()
  try {
    // 旧名要**编码后和现名不同**：encodeCwd 把所有非 ASCII 都变成 '-'，
    // 「Ipad旧名」和「Ipad延伸」会编成同一个目录名，那样测不出 pastPaths 有没有生效
    const oldCwd = '/Users/x/Biily/Projects/PadLinkOld'
    putClaude(w, CLAUDE_ID, oldCwd)
    assert.equal(resumeOwnerOf(CLAUDE_ID, w.cwd, w), null, '不给 pastPaths 找不到')
    assert.equal(resumeOwnerOf(CLAUDE_ID, w.cwd, { ...w, pastPaths: [oldCwd] }), 'claude')
  } finally {
    w.rm()
  }
})

test('id 形状不对（可能是路径注入）→ null，不去碰文件系统', () => {
  const w = world()
  try {
    assert.equal(resumeOwnerOf('../../etc/passwd', w.cwd, w), null)
    assert.equal(resumeOwnerOf('', w.cwd, w), null)
    assert.equal(resumeOwnerOf('short', w.cwd, w), null)
  } finally {
    w.rm()
  }
})

test('~/.codex 根本不存在（没装）→ 不抛，继续查别的', () => {
  const w = world()
  try {
    putOmp(w, OMP_ID)
    assert.equal(resumeOwnerOf(OMP_ID, w.cwd, w), 'omp')
  } finally {
    w.rm()
  }
})
