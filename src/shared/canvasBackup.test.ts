import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldBackup, backupName, prunable, KEEP_BACKUPS } from './canvasBackup.ts'

test('清空一定要备份 —— 那正是踩过的那一下', () => {
  // ErrorBoundary 上的「重置画布并重载」就是 save(EMPTY)，20 个 Frame 一瞬间归零
  assert.equal(shouldBackup(20, 0), true)
  assert.equal(shouldBackup(1, 0), true)
})

test('掉一半以上也备份', () => {
  assert.equal(shouldBackup(20, 3), true, '20 → 3 是这次真实发生的')
  assert.equal(shouldBackup(10, 5), true, '刚好一半也算')
  assert.equal(shouldBackup(10, 6), false, '只掉 4 个是正常编辑')
})

test('正常增删不备份 —— 否则每次拖节点都写一份垃圾', () => {
  assert.equal(shouldBackup(20, 20), false)
  assert.equal(shouldBackup(20, 21), false)
  assert.equal(shouldBackup(3, 2), false)
})

test('本来就是空的不备份', () => {
  assert.equal(shouldBackup(0, 0), false)
  assert.equal(shouldBackup(0, 5), false)
})

test('连点两次重置，两份备份不会互相覆盖', () => {
  // 名字带毫秒 —— 只到秒的话，手快一点第二份就把第一份盖了，
  // 而第一份才是那个还完整的
  const a = backupName('canvas.json', 1787200000000)
  const b = backupName('canvas.json', 1787200000400)
  assert.notEqual(a, b)
  assert.match(a, /canvas\.json\.bak-\d{8}-\d{6}-\d{3}$/)
})

test('只留最近几份，多的挑出来删', () => {
  const names = Array.from({ length: KEEP_BACKUPS + 3 }, (_, i) => backupName('canvas.json', 1787200000000 + i * 1000))
  const drop = prunable([...names, 'canvas.json', 'projects.json'])
  assert.equal(drop.length, 3)
  assert.ok(drop.every((d) => names.slice(0, 3).includes(d)), '删的是最旧的三份')
  assert.ok(!drop.includes('canvas.json'), '别把正主删了')
})
