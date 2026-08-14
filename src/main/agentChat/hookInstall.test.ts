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

// ============================================================
// 以下是审查回合 2 补的断言：审查者没有读代码，而是用「真实用户可能手改/写坏出来的
// settings.json 形状」直接调用实现，撞出 2 个 Important + 1 个 Minor，逐条复现属实：
// 1. 分组的 hooks 数组里混进 null 会直接抛异常（第二处 .some() 没有像 isOurGroup 内部
//    那样先判 isPlainObject(h)）
// 2. 换路径时整体替换分组对象，会连带吞掉用户手加进同一个分组的条目（矩阵：用户很自然会
//    往 matcher: '*' 的分组里加东西，因为它本来就匹配所有工具）
// 3. marker 散落在多个分组时，findIndex 只处理第一个，其余的清不掉
// 对应的修法都已经改成「全局扫描 + 分组内部摘除」而不是「找到第一个就整体替换」。
// ============================================================

test('[追加] 分组的 hooks 数组里混进 null 不抛，且能正确识别已装好/需要换路径两种情况', () => {
  const withNullAfterOurs = {
    hooks: { PreToolUse: [{ matcher: '*', hooks: [null, { type: 'command', command: CMD }] }] }
  }
  assert.doesNotThrow(() => planHookInstall(withNullAfterOurs, CMD))
  const r1 = planHookInstall(withNullAfterOurs, CMD)
  assert.equal(r1.changed, false, 'null 混在旁边不该干扰"已经装好"的判断')

  const OLD = '/老/eas-pretooluse.mjs'
  const withNullAfterOld = {
    hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: OLD }, null] }] }
  }
  assert.doesNotThrow(() => planHookInstall(withNullAfterOld, CMD))
  const r2 = planHookInstall(withNullAfterOld, CMD)
  assert.equal(r2.changed, true)
  assert.ok(JSON.stringify(r2.next).includes(CMD))
  assert.ok(!JSON.stringify(r2.next).includes(OLD), '旧命令必须被摘掉，null 不应该挡住这一步')
})

test('[追加] 换路径时，同一分组里用户手加的条目必须还在——这是这轮最要紧的一条', () => {
  const OLD = '/老路径/eas-pretooluse.mjs'
  const existing = {
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            { type: 'command', command: OLD },
            { type: 'command', command: '/用户/hand-added.sh' }
          ]
        }
      ]
    }
  }
  const { changed, next } = planHookInstall(existing, CMD)
  assert.equal(changed, true)
  const arr = (next.hooks as Record<string, Grp[]>).PreToolUse
  assert.equal(arr.length, 1, '不该为了装新的另开一个分组，还是原来那一个')
  const commands = arr[0].hooks.map((h) => h.command)
  assert.ok(commands.includes('/用户/hand-added.sh'), '用户手加的那条必须还在')
  assert.ok(commands.includes(CMD), '我们的新命令也要在')
  assert.ok(!commands.includes(OLD), '旧命令必须被摘掉')
  assert.equal(commands.length, 2, '不多不少，恰好两条——没有重复也没有丢失')
})

test('[追加] 上一条修复后收敛：再调用一次 changed 为 false，手加的条目依然还在', () => {
  const OLD = '/老路径/eas-pretooluse.mjs'
  const existing = {
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            { type: 'command', command: OLD },
            { type: 'command', command: '/用户/hand-added.sh' }
          ]
        }
      ]
    }
  }
  const once = planHookInstall(existing, CMD).next
  const twice = planHookInstall(once, CMD)
  assert.equal(twice.changed, false)
  assert.ok(JSON.stringify(twice.next).includes('/用户/hand-added.sh'), '收敛之后手加的条目依然还在')
})

test('[追加] marker 散落在多个分组里——全部清理干净只留一条，不相关的分组不受影响', () => {
  const existing = {
    hooks: {
      PreToolUse: [
        { matcher: '*', hooks: [{ type: 'command', command: '/老A/eas-pretooluse.mjs' }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: '/真实/real.sh' }] },
        { matcher: '*', hooks: [{ type: 'command', command: '/老B/eas-pretooluse.mjs' }] }
      ]
    }
  }
  const { changed, next } = planHookInstall(existing, CMD)
  assert.equal(changed, true)
  const arr = (next.hooks as Record<string, Grp[]>).PreToolUse
  const markerGroups = arr.filter((g) => JSON.stringify(g).includes('eas-pretooluse'))
  assert.equal(markerGroups.length, 1, '清理后全局只能剩一个带 marker 的分组')
  assert.equal(
    markerGroups[0].hooks.filter((h) => h.command.includes('eas-pretooluse')).length,
    1,
    '那一个分组内部也只能有一条带 marker 的记录'
  )
  assert.ok(JSON.stringify(arr).includes('/真实/real.sh'), '不相关的 Bash 分组必须完好保留')
})

// ============================================================
// 以下是审查回合 3 补的断言：复审者不读代码，直接构造对抗性输入调真函数，
// 发现回合 2 的修法（摘除旧痕迹 + `{...group, hooks:[...]}`）会**继承原分组的
// matcher**——如果那个分组不是 matcher: '*'（比如被摘干净后剩下的分组恰好是
// 'Write'），新装的 hook 就会静默落在错误的 matcher 下。PreToolUse hook 的本意是
// 拦下所有工具调用去弹审批卡片，matcher 一旦被收窄，其它工具（Bash/Edit/...）
// 完全不经过审批、直接放行，没有任何报错、changed:true 也看不出异常——比前几轮
// 「丢数据」更严重，是「审批被静默绕过」。
// 对应的修法：摘除旧痕迹（分组身份、matcher、其它条目原样保留）和「新条目放哪」
// 拆成两个独立步骤，新条目只认 matcher 字面量是 '*' 的分组，与摘除逻辑完全解耦。
// ============================================================

test('[追加] marker 分散在不同 matcher 的分组里，新 hook 必须落在 matcher: "*"——这轮最要紧的一条', () => {
  const OLD1 = '/老1/eas-pretooluse.mjs'
  const OLD2 = '/老2/eas-pretooluse.mjs'
  const existing = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write',
          hooks: [
            { type: 'command', command: OLD1 },
            { type: 'command', command: '/keep.sh' }
          ]
        },
        { matcher: '*', hooks: [{ type: 'command', command: OLD2 }] }
      ]
    }
  }
  const { changed, next } = planHookInstall(existing, CMD)
  assert.equal(changed, true)
  const arr = (next.hooks as Record<string, Grp[]>).PreToolUse
  const starGroups = arr.filter((g) => g.matcher === '*')
  assert.equal(starGroups.length, 1, '有且只有一个 matcher: "*" 的分组')
  const starCommands = starGroups[0].hooks.map((h) => h.command)
  assert.ok(starCommands.includes(CMD), '新 hook 必须落在 "*" 分组里，不能被静默收窄到别的 matcher')
  assert.ok(
    !arr.some((g) => g.matcher !== '*' && g.hooks.some((h) => h.command === CMD)),
    '任何非 "*" 的分组里都不该出现我们的新命令'
  )
})

test('[追加] 用户原有分组的 matcher 不被改动——摘除旧痕迹后分组身份保持原样', () => {
  const OLD1 = '/老1/eas-pretooluse.mjs'
  const OLD2 = '/老2/eas-pretooluse.mjs'
  const existing = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write',
          hooks: [
            { type: 'command', command: OLD1 },
            { type: 'command', command: '/keep.sh' }
          ]
        },
        { matcher: '*', hooks: [{ type: 'command', command: OLD2 }] }
      ]
    }
  }
  const { next } = planHookInstall(existing, CMD)
  const arr = (next.hooks as Record<string, Grp[]>).PreToolUse
  const writeGroup = arr.find((g) => g.matcher === 'Write')
  assert.ok(writeGroup, 'Write 分组必须还在——不能被当成"marker 分组"整个吞掉或改名')
  const writeCommands = writeGroup!.hooks.map((h) => h.command)
  assert.ok(writeCommands.includes('/keep.sh'), 'keep.sh 必须还在')
  assert.ok(!writeCommands.includes(OLD1), 'OLD1 必须被摘掉')
  assert.equal(writeCommands.length, 1, 'Write 分组摘完旧痕迹后恰好剩 1 条，不多不少')
})

test('[追加] 唯一一条 marker 记录如果落在错误的 matcher 下，不能被误判成"已经装好"', () => {
  const existing = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: CMD }] }] } }
  const { changed, next } = planHookInstall(existing, CMD)
  assert.equal(changed, true, '命令虽然精确匹配，但 matcher 不是 "*"，必须视为需要修正，不能静默放过')
  const arr = (next.hooks as Record<string, Grp[]>).PreToolUse
  const starGroups = arr.filter((g) => g.matcher === '*')
  assert.equal(starGroups.length, 1)
  assert.ok(starGroups[0].hooks.map((h) => h.command).includes(CMD))
})
