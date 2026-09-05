import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HostRegistry } from './hostRegistry.ts'

/** 假定时器：手动 tick */
function fakeTimers(): { setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (h: unknown) => void; fire: () => void; pending: () => number } {
  const q = new Map<number, () => void>()
  let n = 0
  return {
    setTimer: (fn) => {
      const id = ++n
      q.set(id, fn)
      return id
    },
    clearTimer: (h) => {
      q.delete(h as number)
    },
    fire: () => {
      for (const [id, fn] of [...q]) {
        q.delete(id)
        fn()
      }
    },
    pending: () => q.size
  }
}

function make(): { reg: HostRegistry<{ pid: number }>; t: ReturnType<typeof fakeTimers>; idle: string[]; created: number } {
  const t = fakeTimers()
  const idle: string[] = []
  const box = { created: 0 }
  const reg = new HostRegistry<{ pid: number }>({
    graceMs: 30_000,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
    onIdle: (k) => idle.push(k)
  })
  return {
    reg,
    t,
    idle,
    get created() {
      return box.created
    }
  }
}

test('两个持有方 acquire 同一插件 → 只 create 一次，refs=2', () => {
  const { reg } = make()
  let created = 0
  const mk = (): { pid: number } => ({ pid: ++created })
  const a = reg.acquire('board', 'panel-1', mk)
  const b = reg.acquire('board', 'session-9', mk)
  assert.equal(created, 1)
  assert.equal(a, b)
  assert.equal(reg.refs('board'), 2)
})

test('同一 ref 重复 acquire 幂等', () => {
  const { reg } = make()
  reg.acquire('board', 'p', () => ({ pid: 1 }))
  reg.acquire('board', 'p', () => ({ pid: 2 }))
  assert.equal(reg.refs('board'), 1)
})

test('release 到 0 不立刻回收，宽限期过完才 onIdle', () => {
  const { reg, t, idle } = make()
  reg.acquire('board', 'p', () => ({ pid: 1 }))
  reg.release('board', 'p')
  assert.deepEqual(idle, [], '宽限期内不回收')
  assert.equal(t.pending(), 1)
  t.fire()
  assert.deepEqual(idle, ['board'])
  assert.equal(reg.get('board'), undefined)
})

test('宽限期内又 acquire → 取消回收，进程继续用', () => {
  const { reg, t, idle } = make()
  const first = reg.acquire('board', 'p', () => ({ pid: 1 }))
  reg.release('board', 'p')
  const again = reg.acquire('board', 'p2', () => ({ pid: 2 }))
  assert.equal(again, first, '还是原来那个进程')
  t.fire()
  assert.deepEqual(idle, [], '被取消了')
})

test('drop：进程自己死了 → 立刻摘掉，下次 acquire 重新 create', () => {
  const { reg } = make()
  reg.acquire('board', 'p', () => ({ pid: 1 }))
  assert.deepEqual(reg.drop('board'), { pid: 1 })
  const n = reg.acquire('board', 'p', () => ({ pid: 2 }))
  assert.equal(n.pid, 2)
})

test('releaseAll：一个会话退出，它持有的所有插件都减一', () => {
  const { reg } = make()
  reg.acquire('a', 's1', () => ({ pid: 1 }))
  reg.acquire('b', 's1', () => ({ pid: 2 }))
  reg.acquire('b', 'panel', () => ({ pid: 3 }))
  reg.releaseAll('s1')
  assert.equal(reg.refs('a'), 0)
  assert.equal(reg.refs('b'), 1)
})
