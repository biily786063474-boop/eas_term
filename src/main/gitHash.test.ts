import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCommitHash } from './gitHash.ts'
// 审查发现：git:describe / git:commitFiles 把界面传来的 hash 原样给 git，`--output=<路径>` 会被当选项，
// 能覆盖任意文件。所有拿 hash 当参数的处理器都要先过这一关。
test('只认 7–40 位十六进制；带 - 开头、路径、空白、超长一律拒', () => {
  for (const ok of ['abcdef1', '0123456789abcdef0123456789abcdef01234567', 'ABCDEF1']) assert.equal(isCommitHash(ok), true, ok)
  for (const bad of ['--output=/tmp/x', '-p', 'HEAD', 'abcdef', 'abc def1', 'abcdef1\n', '', 'g123456', 'a'.repeat(41)]) assert.equal(isCommitHash(bad), false, JSON.stringify(bad))
})
