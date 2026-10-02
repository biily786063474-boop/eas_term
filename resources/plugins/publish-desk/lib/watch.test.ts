import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { watchData } from './watch.mjs'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
// 和 store.mjs 一样：写临时文件再 rename 覆盖 —— 外部脚本、别的进程、宿主写入都是这条路
function writeLikeStore(dir: string, version: number) {
  const tmp = path.join(dir, `.publish-desk-${version}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify({ schema: 1, version, batches: [], lexicon: [] }))
  fs.renameSync(tmp, path.join(dir, 'publish-desk.json'))
}

test('别的进程改了数据文件 → 回调一次（多次事件合并）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-watch-'))
  let n = 0
  const stop = watchData(dir, () => n++, 60)
  try {
    writeLikeStore(dir, 1); writeLikeStore(dir, 2)
    await wait(400)
    assert.equal(n, 1)
    writeLikeStore(dir, 3)
    await wait(400)
    assert.equal(n, 2)
  } finally { stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('只碰锁文件、临时文件不算数据变化', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-watch-'))
  let n = 0
  const stop = watchData(dir, () => n++, 60)
  try {
    fs.writeFileSync(path.join(dir, 'publish-desk.lock'), '')
    fs.writeFileSync(path.join(dir, '.publish-desk-x.tmp'), 'x')
    await wait(400)
    assert.equal(n, 0)
  } finally { stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('数据目录还不存在：先建好再监听，第一次写入也能收到', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-watch-')), 'publish-desk')
  let n = 0
  const stop = watchData(dir, () => n++, 60)
  try {
    writeLikeStore(dir, 1)
    await wait(400)
    assert.equal(n, 1)
  } finally { stop(); fs.rmSync(path.dirname(dir), { recursive: true, force: true }) }
})
