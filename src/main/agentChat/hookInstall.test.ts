import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planHookInstall } from './hookInstall.ts'

const CMD = '/Applications/Eas-Term.app/Contents/Resources/agent-hooks/eas-pretooluse.mjs'

test('空配置 → 装上我们的 hook', () => {
  const { changed, next } = planHookInstall({}, CMD)
  assert.equal(changed, true)
  const arr = (next.hooks as Record<string, unknown[]>).PreToolUse
  assert.equal(arr.length, 1)
})

test('用户已有别的 PreToolUse hook → 保留，我们的追加在后面', () => {
  const existing = {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/用户/自己的.sh' }] }]
    }
  }
  const { next } = planHookInstall(existing, CMD)
  const arr = (next.hooks as Record<string, unknown[]>).PreToolUse
  assert.equal(arr.length, 2, '用户自己的那条必须还在')
  assert.ok(JSON.stringify(arr).includes('/用户/自己的.sh'))
})

test('用户的其它配置项一个都不能丢', () => {
  const existing = { model: 'opus', env: { FOO: '1' }, hooks: { PostToolUse: [{ x: 1 }] } }
  const { next } = planHookInstall(existing, CMD)
  assert.equal(next.model, 'opus')
  assert.deepEqual(next.env, { FOO: '1' })
  assert.ok((next.hooks as Record<string, unknown>).PostToolUse, 'PostToolUse 不能被抹掉')
})

test('已经装过 → changed 为 false，不重复追加', () => {
  const once = planHookInstall({}, CMD).next
  const twice = planHookInstall(once, CMD)
  assert.equal(twice.changed, false)
  const arr = (twice.next.hooks as Record<string, unknown[]>).PreToolUse
  assert.equal(arr.length, 1)
})

test('hook 命令路径变了（升级换了安装位置）→ 替换旧的，不留两条', () => {
  const old = planHookInstall({}, '/老路径/eas-pretooluse.mjs').next
  const { changed, next } = planHookInstall(old, CMD)
  assert.equal(changed, true)
  const arr = (next.hooks as Record<string, unknown[]>).PreToolUse
  assert.equal(arr.length, 1, '旧版本的那条要被替换掉而不是并存')
  assert.ok(JSON.stringify(arr).includes(CMD))
})

test('settings.json 是坏的（不是对象）→ 当成空配置，不抛', () => {
  assert.doesNotThrow(() => planHookInstall('这不是对象', CMD))
  assert.doesNotThrow(() => planHookInstall(null, CMD))
  assert.doesNotThrow(() => planHookInstall([1, 2, 3], CMD))
})

// ============================================================
// 以下是补充断言：上面这批题面测试逐字照抄简报，但只验证了「数组长度」「字符串
// 包含」，没锁住具体字面值、顺序、以及「同一分组内部会不会残留旧条目」。
// 按纪律，逐个字段自问「改成一个固定错值，上面的测试会不会失败」——
// 用变异验证实测过，以下 5 类改动全部能在不碰给定测试的情况下溜过去，这里补上。
// ============================================================

interface Grp {
  matcher: string
  hooks: { type: string; command: string }[]
}

test('[补充] matcher 精确是 "*"——原测试只查数组长度，没人锁 matcher 的具体值', () => {
  const { next } = planHookInstall({}, CMD)
  const arr = (next.hooks as Record<string, Grp[]>).PreToolUse
  assert.equal(arr[0].matcher, '*')
})

test('[补充] hook 条目的 type 精确是 "command"，command 精确等于传入的 hookCmd', () => {
  const { next } = planHookInstall({}, CMD)
  const arr = (next.hooks as Record<string, Grp[]>).PreToolUse
  assert.equal(arr[0].hooks.length, 1)
  assert.equal(arr[0].hooks[0].type, 'command')
  assert.equal(arr[0].hooks[0].command, CMD)
})

test('[补充] 用户自己的 hook 在前、我们的在后——原测试没锁顺序，只要求都在场', () => {
  const existing = {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/用户/自己的.sh' }] }]
    }
  }
  const { next } = planHookInstall(existing, CMD)
  const arr = (next.hooks as Record<string, Grp[]>).PreToolUse
  assert.equal(arr[0].matcher, 'Bash', '用户原有那条必须仍在原来的位置（第一条）')
  assert.equal(arr[0].hooks[0].command, '/用户/自己的.sh')
  assert.equal(arr[1].matcher, '*')
  assert.equal(arr[1].hooks[0].command, CMD, '我们的必须追加在最后一条')
})

test('[补充] 换路径后旧命令必须彻底消失——不能被追加进同一个 matcher 分组的 hooks 数组里', () => {
  const OLD_CMD = '/老路径/eas-pretooluse.mjs'
  const old = planHookInstall({}, OLD_CMD).next
  const { next } = planHookInstall(old, CMD)
  const arr = (next.hooks as Record<string, Grp[]>).PreToolUse
  assert.equal(arr[0].hooks.length, 1, '同一分组内部也必须只剩 1 条，不是被追加成 2 条')
  assert.ok(!JSON.stringify(next).includes(OLD_CMD), '旧路径字符串必须从结果里彻底消失')
})

test('[补充] 不是白名单拷贝——一个完全陌生、没被专门测过的顶层字段也必须原样保留', () => {
  const existing = { permissions: { allow: ['Bash(npm test:*)'] }, statusLine: { type: 'command' } }
  const { next } = planHookInstall(existing, CMD)
  assert.deepEqual(next.permissions, { allow: ['Bash(npm test:*)'] })
  assert.deepEqual(next.statusLine, { type: 'command' })
})

test('[补充] hooks 下除 PreToolUse 外，不止 PostToolUse 一种事件类型都不能丢', () => {
  const existing = {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: '/用户/on-start.sh' }] }],
      Stop: [{ hooks: [{ type: 'command', command: '/用户/on-stop.sh' }] }]
    }
  }
  const { next } = planHookInstall(existing, CMD)
  const hooks = next.hooks as Record<string, unknown>
  assert.deepEqual(hooks.SessionStart, existing.hooks.SessionStart)
  assert.deepEqual(hooks.Stop, existing.hooks.Stop)
})

test('[补充] 不修改传入的 existing 对象（纯函数契约，不改入参）', () => {
  const existing = {
    model: 'opus',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/用户/自己的.sh' }] }]
    }
  }
  const before = JSON.parse(JSON.stringify(existing))
  planHookInstall(existing, CMD)
  assert.deepEqual(existing, before, 'existing 在调用前后必须逐字节相同')
})

test('[补充] 损坏输入被当空配置后，产出内容与真的传 {} 完全一致——不只是"不抛"', () => {
  const fromEmpty = planHookInstall({}, CMD)
  for (const bad of ['这不是对象', null, [1, 2, 3]]) {
    const fromBad = planHookInstall(bad, CMD)
    assert.deepEqual(fromBad, fromEmpty, `坏输入 ${JSON.stringify(bad)} 的产出必须等同于空配置`)
  }
})
