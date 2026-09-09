import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { historyAction, historyFiles } from './gitHistory.ts'

test('history actions use real Git, block dirty checkout, preserve history and handle rename/binary', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-history-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  try {
    git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test')
    await fs.writeFile(path.join(cwd, 'old name.txt'), 'one\ntwo\nthree\nfour\n')
    git('add', '.'); git('commit', '-m', 'first'); const first = git('rev-parse', 'HEAD')
    const rootFiles = await historyFiles(cwd, undefined, first)
    assert.equal(rootFiles[0].added, 4)
    assert.equal(rootFiles[0].deleted, 0)
    git('mv', 'old name.txt', 'new name.txt')
    await fs.writeFile(path.join(cwd, 'binary.bin'), Buffer.from([0, 1, 2]))
    git('add', '.'); git('commit', '-m', 'second'); const second = git('rev-parse', 'HEAD')
    const files = await historyFiles(cwd, first, second)
    assert.equal(files.find(f => f.path === 'new name.txt')?.origPath, 'old name.txt')
    assert.equal(files.find(f => f.path === 'binary.bin')?.added, null)
    await fs.writeFile(path.join(cwd, 'untracked'), 'keep')
    await assert.rejects(historyAction(cwd, 'checkout', first), /未提交/)
    assert.equal(git('rev-parse', 'HEAD'), second)
    await fs.unlink(path.join(cwd, 'untracked'))
    await historyAction(cwd, 'checkout', first)
    assert.equal(git('rev-parse', 'HEAD'), first)
    await historyAction(cwd, 'switch', 'main')
    assert.equal(git('rev-parse', 'HEAD'), second)
    await historyAction(cwd, 'branch', first, 'review/test')
    assert.equal(git('branch', '--show-current'), 'review/test')
    await historyAction(cwd, 'tag', first, 'test-v1')
    assert.equal(git('rev-parse', 'test-v1'), first)
    await assert.rejects(historyAction(cwd, 'branch', first, '--bad'))
    await assert.rejects(historyAction(cwd, 'checkout', '--help'))
    assert.equal(git('rev-parse', 'main'), second)
    await assert.rejects(historyAction(cwd, 'branch', first, 'review/test'))
    assert.equal(git('branch', '--show-current'), 'review/test')
  } finally { await fs.rm(cwd, { recursive: true, force: true }) }
})
