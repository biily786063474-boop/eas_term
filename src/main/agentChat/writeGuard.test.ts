// 阶段三 · 第三项：Claude 上 caps.write=false 的第二道闸——PreToolUse 守卫脚本
// `resources/agent-hooks/eas-write-guard.mjs`。这份文件不在 src/main 目录树里
// （它是随包分发给 Claude Code 当外部进程跑的独立脚本，不能 import electron），
// 但测试要挂在 `npm test` 的 glob（`src/**/*.test.ts`）下才会被跑到，所以测试文件
// 放这里、import 那份 .mjs——两处各自符合各自的运行环境要求。
//
// 只测 `isWriteCommand`（纯函数，按命令模式识别，不做 shell 解析）。脚本的
// stdin→JSON→hookResponseBody 主逻辑不在这里测——那需要真的喂 stdin、跑子进程，
// 交给 G 的真机核对。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isWriteCommand } from '../../../resources/agent-hooks/eas-write-guard.mjs'

// ── 拦：命令里确实有写操作 ──────────────────────────────────────────────
test('拦：重定向 >', () => {
  assert.equal(isWriteCommand('echo hi > a.txt'), true)
})

test('拦：追加重定向 >>', () => {
  assert.equal(isWriteCommand('cat x >> b'), true)
})

test('拦：管道到 tee', () => {
  assert.equal(isWriteCommand('ls | tee out'), true)
})

test('拦：sed -i 原地改文件', () => {
  assert.equal(isWriteCommand("sed -i 's/a/b/' f"), true)
})

test('拦：rm -rf', () => {
  assert.equal(isWriteCommand('rm -rf x'), true)
})

test('拦：mkdir', () => {
  assert.equal(isWriteCommand('mkdir p'), true)
})

test('拦：touch', () => {
  assert.equal(isWriteCommand('touch a'), true)
})

test('拦：git commit', () => {
  assert.equal(isWriteCommand('git commit -m x'), true)
})

test('拦：git checkout -- f（写子命令）', () => {
  assert.equal(isWriteCommand('git checkout -- f'), true)
})

test('拦：npm install', () => {
  assert.equal(isWriteCommand('npm install foo'), true)
})

test('拦：pip install', () => {
  assert.equal(isWriteCommand('pip install x'), true)
})

test('拦：&& 之后的写命令一样拦', () => {
  assert.equal(isWriteCommand('ls && rm x'), true)
})

test('拦：python3 -c 内联脚本里含 open(...,\'w\')', () => {
  assert.equal(isWriteCommand('python3 -c "open(\'a\',\'w\').write(\'x\')"'), true)
})

// ── 评审 Critical：分段正则原来不切换行，多行命令整段被当成一段来判 ──────────
test('拦：换行分隔，写命令排在第二行（ls\\nrm -rf x）', () => {
  assert.equal(isWriteCommand('ls\nrm -rf x'), true)
})

test('拦：单个 & 后台执行也要切段（ls & rm x）', () => {
  assert.equal(isWriteCommand('ls & rm x'), true)
})

test('拦：换行 + 只读段在前（cd /tmp\\ngit commit -m x）', () => {
  assert.equal(isWriteCommand('cd /tmp\ngit commit -m x'), true)
})

// ── 评审 Important：包装词/子 shell/内联 shell 绕过 ──────────────────────
test('拦：sudo 包装（sudo rm -rf x）', () => {
  assert.equal(isWriteCommand('sudo rm -rf x'), true)
})

test('拦：env 赋值包装（env FOO=1 rm x）', () => {
  assert.equal(isWriteCommand('env FOO=1 rm x'), true)
})

test('拦：nohup 包装（nohup rm x）', () => {
  assert.equal(isWriteCommand('nohup rm x'), true)
})

test('拦：xargs 包装（xargs rm < list）', () => {
  assert.equal(isWriteCommand('xargs rm < list'), true)
})

test('拦：子 shell 分组（(rm x)）', () => {
  assert.equal(isWriteCommand('(rm x)'), true)
})

test('拦：bash -c 内联 shell 命令（bash -c "rm x"）', () => {
  assert.equal(isWriteCommand('bash -c "rm x"'), true)
})

// ── 放：只读命令，不该被拦 ──────────────────────────────────────────────
test('放：ls -la', () => {
  assert.equal(isWriteCommand('ls -la'), false)
})

test('放：重定向到 /dev/null 不算写', () => {
  assert.equal(isWriteCommand('grep -r foo src > /dev/null'), false)
})

test('放：2>/dev/null 不算写', () => {
  assert.equal(isWriteCommand('cat a 2>/dev/null'), false)
})

test('放：git status', () => {
  assert.equal(isWriteCommand('git status'), false)
})

test('放：git log --oneline', () => {
  assert.equal(isWriteCommand('git log --oneline'), false)
})

test('放：git diff', () => {
  assert.equal(isWriteCommand('git diff'), false)
})

test('放：npm test', () => {
  assert.equal(isWriteCommand('npm test'), false)
})

test('放：npm run typecheck', () => {
  assert.equal(isWriteCommand('npm run typecheck'), false)
})

test('放：node --test x.test.ts', () => {
  assert.equal(isWriteCommand('node --test x.test.ts'), false)
})

test('放：echo hi（无重定向）', () => {
  assert.equal(isWriteCommand('echo hi'), false)
})

test('放：cat a | grep b', () => {
  assert.equal(isWriteCommand('cat a | grep b'), false)
})

test('放：2>&1 不算写', () => {
  assert.equal(isWriteCommand('ps aux 2>&1 | head'), false)
})

// ── 评审 Minor：引号里的 > 不是重定向 ────────────────────────────────────
test('放：引号里的 >（grep -c ">" f）', () => {
  assert.equal(isWriteCommand('grep -c ">" f'), false)
})

test('放：引号里的 >（awk \'$1 > 5\'）', () => {
  assert.equal(isWriteCommand("awk '$1 > 5'"), false)
})

// ── 评审 Minor：补三条边界写法的拦截测试 ──────────────────────────────────
test('拦：echo x >a（无空格重定向）', () => {
  assert.equal(isWriteCommand('echo x >a'), true)
})

test('拦：ls&&rm x（无空格 &&）', () => {
  assert.equal(isWriteCommand('ls&&rm x'), true)
})

test('拦：sed -i.bak（备份后缀粘在 -i 上）', () => {
  assert.equal(isWriteCommand("sed -i.bak 's/a/b/' f"), true)
})

// ── 脚本能被 import 而不执行主逻辑 ──────────────────────────────────────
// 判据：上面 import 已经成功（没有卡在读 stdin、没有抛异常），且 isWriteCommand
// 真是一个函数——这足以证明 `isRunAsScript()`（两边 `fs.realpathSync` 再比，
// 2026-09-06 评审 Important 修的软链坑）的守卫生效了：被 import 时 argv[1] 是
// 测试文件自己的路径，realpath 之后仍不等于这份 .mjs 的真实路径，主逻辑
// （读 stdin、写 stdout）不会跑，否则这个测试进程会挂住等 stdin，永远跑不完。
test('脚本能被 import 而不执行主逻辑（只导出函数）', () => {
  assert.equal(typeof isWriteCommand, 'function')
})
