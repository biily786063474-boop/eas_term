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

// ── 最终评审 Critical 1：包装词自己带的选项，原来会被误当成「真正的命令词」 ──────
// 下面每一条改动前都**放行**（选项不在任何写命令清单里，整条就过了）。
test('拦：sudo 带选项（sudo -u x rm y）', () => {
  assert.equal(isWriteCommand('sudo -u x rm y'), true)
})

test('拦：sudo 长选项带等号（sudo --user=x rm y）', () => {
  assert.equal(isWriteCommand('sudo --user=x rm y'), true)
})

test('拦：sudo 纯开关选项（sudo -i rm x）', () => {
  assert.equal(isWriteCommand('sudo -i rm x'), true)
})

test('拦：sudo 显式选项终止符（sudo -- rm x）', () => {
  assert.equal(isWriteCommand('sudo -- rm x'), true)
})

test('拦：env 带选项（env -i rm x）', () => {
  assert.equal(isWriteCommand('env -i rm x'), true)
})

test('拦：nice 带独立参数的选项（nice -n 10 rm x）', () => {
  assert.equal(isWriteCommand('nice -n 10 rm x'), true)
})

test('拦：time 带选项（time -p rm x）', () => {
  assert.equal(isWriteCommand('time -p rm x'), true)
})

test('拦：xargs 短选项（xargs -0 rm < list）', () => {
  assert.equal(isWriteCommand('xargs -0 rm < list'), true)
})

test('拦：xargs 带独立参数的选项（xargs -n 1 rm）', () => {
  assert.equal(isWriteCommand('xargs -n 1 rm'), true)
})

test('拦：timeout 包装 + 时长位置参数（timeout 5 rm x）', () => {
  assert.equal(isWriteCommand('timeout 5 rm x'), true)
})

test('拦：连着套多个包装词（sudo -u x env FOO=1 rm y）', () => {
  assert.equal(isWriteCommand('sudo -u x env FOO=1 rm y'), true)
})

// 给包装词补选项跳过之后，`command -v rm` 这条只读探测会落到 rm 上——WRAPPER_OPTS_WITH_ARG
// 里把 `command -v/-V` 算成「吃一个参数」正是为了不误拦它，这条钉住那个决定。
test('放：command -v rm（只问命令在不在，不跑它）', () => {
  assert.equal(isWriteCommand('command -v rm'), false)
})

// ── 最终评审 Critical 2：分段不认引号，两个方向都错 ────────────────────────────
test('拦：bash -c 里用 ; 串两条（bash -c "rm x; ls"）', () => {
  assert.equal(isWriteCommand('bash -c "rm x; ls"'), true)
})

test('拦：bash -c 里用 && 串两条（bash -c "rm x && ls"）', () => {
  assert.equal(isWriteCommand('bash -c "rm x && ls"'), true)
})

test('放：引号里的 ;（echo "a;rm b"）', () => {
  assert.equal(isWriteCommand('echo "a;rm b"'), false)
})

test('放：引号里的 |（grep -E "x|rm x" f）', () => {
  assert.equal(isWriteCommand('grep -E "x|rm x" f'), false)
})

// ── 最终评审 Important 1：段首裸赋值 ─────────────────────────────────────────
test('拦：段首裸赋值包装（FOO=1 rm x）', () => {
  assert.equal(isWriteCommand('FOO=1 rm x'), true)
})

// ── 最终评审 Important 2：git 写子命令补齐 ───────────────────────────────────
test('拦：git pull', () => {
  assert.equal(isWriteCommand('git pull'), true)
})

test('拦：git clone x y', () => {
  assert.equal(isWriteCommand('git clone x y'), true)
})

test('拦：git worktree add', () => {
  assert.equal(isWriteCommand('git worktree add ../wt br'), true)
})

test('拦：git fetch（写 .git/objects 与远端引用）', () => {
  assert.equal(isWriteCommand('git fetch origin'), true)
})

test('放：git show（纯读）', () => {
  assert.equal(isWriteCommand('git show HEAD'), false)
})

// ── 最终评审 Important 3：会落文件的网络/归档命令 ─────────────────────────────
test('拦：curl -o 落文件', () => {
  assert.equal(isWriteCommand('curl -o f https://x'), true)
})

test('拦：curl -O 落文件', () => {
  assert.equal(isWriteCommand('curl -O https://x'), true)
})

test('拦：curl --output 落文件', () => {
  assert.equal(isWriteCommand('curl --output f https://x'), true)
})

test('拦：curl --remote-name 落文件', () => {
  assert.equal(isWriteCommand('curl --remote-name https://x'), true)
})

test('拦：curl 的 o 挤在短选项簇里（curl -sLo f url）', () => {
  assert.equal(isWriteCommand('curl -sLo f https://x'), true)
})

test('放：curl 不带 -o（只打印到 stdout）', () => {
  assert.equal(isWriteCommand('curl https://x'), false)
})

test('拦：wget（默认就是存文件）', () => {
  assert.equal(isWriteCommand('wget https://x'), true)
})

test('放：wget -O - 吐到 stdout', () => {
  assert.equal(isWriteCommand('wget -O - https://x'), false)
})

test('放：wget -qO- 吐到 stdout', () => {
  assert.equal(isWriteCommand('wget -qO- https://x'), false)
})

test('拦：tar 解包（tar -xzf a.tgz）', () => {
  assert.equal(isWriteCommand('tar -xzf a.tgz'), true)
})

test('拦：tar 经典无横线写法（tar xzf a.tgz）', () => {
  assert.equal(isWriteCommand('tar xzf a.tgz'), true)
})

test('放：tar 只列内容（tar -tf a.tar）', () => {
  assert.equal(isWriteCommand('tar -tf a.tar'), false)
})

test('拦：unzip', () => {
  assert.equal(isWriteCommand('unzip a.zip'), true)
})

test('拦：zip', () => {
  assert.equal(isWriteCommand('zip -r a.zip d'), true)
})

test('拦：gunzip', () => {
  assert.equal(isWriteCommand('gunzip a.gz'), true)
})

test('拦：bsdtar', () => {
  assert.equal(isWriteCommand('bsdtar -xf a.tar'), true)
})

// ── 最终评审 Important 4：find 的写动作 ──────────────────────────────────────
test('拦：find -delete', () => {
  assert.equal(isWriteCommand('find . -name x -delete'), true)
})

test('拦：find -exec', () => {
  assert.equal(isWriteCommand('find . -type f -exec rm {} \\;'), true)
})

test('拦：find -execdir', () => {
  assert.equal(isWriteCommand('find . -execdir rm {} +'), true)
})

test('拦：find -ok', () => {
  assert.equal(isWriteCommand('find . -ok rm {} \\;'), true)
})

test('放：find 纯查询（find . -name x）', () => {
  assert.equal(isWriteCommand('find . -name x'), false)
})

// ── 最终评审 Important 5：eval 递归 + `-c` 挤在短选项簇末尾 ────────────────────
test('拦：eval "rm x"（与 bash -c 同一条递归判据）', () => {
  assert.equal(isWriteCommand('eval "rm x"'), true)
})

test('放：eval ls', () => {
  assert.equal(isWriteCommand('eval ls'), false)
})

test('拦：bash -lc "rm x"（-c 挤在簇末尾）', () => {
  assert.equal(isWriteCommand('bash -lc "rm x"'), true)
})

test('放：sh -lc "ls"', () => {
  assert.equal(isWriteCommand('sh -lc "ls"'), false)
})

// ── 最终评审 Minor 1：tee 只在命令词位置算写 ─────────────────────────────────
test('放：grep tee src（只是提到 tee）', () => {
  assert.equal(isWriteCommand('grep tee src'), false)
})

test('放：man tee（只是提到 tee）', () => {
  assert.equal(isWriteCommand('man tee'), false)
})

// ── 最终评审 Minor 3：sed --in-place / perl -pi ──────────────────────────────
test('拦：sed --in-place', () => {
  assert.equal(isWriteCommand("sed --in-place 's/a/b/' f"), true)
})

test('拦：perl -pi -e（i 挤在短选项簇里）', () => {
  assert.equal(isWriteCommand("perl -pi -e 's/a/b/' f"), true)
})

test('放：sed -n（没有 -i 不算写）', () => {
  assert.equal(isWriteCommand("sed -n '1,5p' f"), false)
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
