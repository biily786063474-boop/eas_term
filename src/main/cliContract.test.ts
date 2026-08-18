import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fingerprintOf,
  verdictOf,
  shouldWarn,
  mergeRecord,
  type CliContract,
  type ContractRecord
} from './cliContract.ts'

const C: CliContract = {
  id: 'claude',
  bin: 'claude',
  help: [
    { name: '--effort', pattern: /--effort/ },
    { name: '--output-format', pattern: /--output-format/ }
  ]
}
const HELP_OK = 'Usage: claude\n  --effort <level>\n  --output-format <fmt>\n'

test('命令跑不起来 = 没装，不是漂移', () => {
  assert.deepEqual(verdictOf(C, null, ''), { k: 'absent' })
})

test('该有的都在 → ok', () => {
  const v = verdictOf(C, HELP_OK, '1.2.3')
  assert.equal(v.k, 'ok')
})

// 这是这套东西存在的全部理由：装了、但我们依赖的东西没了
test('少一样 → drift，并说清少的是哪样', () => {
  const v = verdictOf(C, 'Usage: claude\n  --output-format <fmt>\n', '1.2.3')
  assert.equal(v.k, 'drift')
  assert.deepEqual(v.k === 'drift' ? v.missing : [], ['--effort'])
})

// 哈希全文的话，每次小版本升级都报漂移 —— 那就成了狼来了
test('指纹只认「我们依赖的那几样在不在」，不认措辞变化', () => {
  const a = fingerprintOf('1.2.3', C.help, HELP_OK)
  const b = fingerprintOf('1.2.3', C.help, HELP_OK + '\n  --some-new-unrelated-flag\n')
  assert.equal(a, b, '无关 flag 增减不该改变指纹')
  const c = fingerprintOf('1.2.4', C.help, HELP_OK)
  assert.notEqual(a, c, '版本变了要算新指纹')
})

test('ok 永远不报警', () => {
  assert.equal(shouldWarn('anything', verdictOf(C, HELP_OK, '1.0.0')), false)
})

// 从没记录过 = 初次见面，不是漂移
test('第一次自检就不合格：不报警，先记下来', () => {
  const v = verdictOf(C, 'Usage: claude\n', '1.0.0')
  assert.equal(shouldWarn(undefined, v), false)
})

test('上次好好的、这次不对了 → 报警', () => {
  const ok = verdictOf(C, HELP_OK, '1.0.0')
  const bad = verdictOf(C, 'Usage: claude\n', '2.0.0')
  assert.equal(shouldWarn(ok.k === 'ok' ? ok.fingerprint : '', bad), true)
})

// 一直坏着的每次启动都弹，用户很快学会无视
test('同一个漂移不重复报警', () => {
  const bad = verdictOf(C, 'Usage: claude\n', '2.0.0')
  assert.equal(shouldWarn(bad.k === 'drift' ? bad.fingerprint : '', bad), false)
})

test('没装的不留记录 —— 下次装上是初次见面，不该报成漂移', () => {
  const prev: Record<string, ContractRecord> = { claude: { fingerprint: 'x', checkedAt: 1, ok: true } }
  assert.deepEqual(mergeRecord(prev, 'claude', { k: 'absent' }, 2), {})
})

test('自检通过后记录会更新', () => {
  const v = verdictOf(C, HELP_OK, '9.9.9')
  const r = mergeRecord({}, 'claude', v, 1234)
  assert.equal(r.claude.ok, true)
  assert.equal(r.claude.checkedAt, 1234)
  assert.equal(r.claude.fingerprint, v.k === 'ok' ? v.fingerprint : '')
})
