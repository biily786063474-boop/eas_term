// 图纸守门的判据。**每条测试都对应一次它自己犯过的错。**
//
// 这个钩子上线当天出了两个 bug，都不是逻辑复杂，而是「凭直觉写、靠手工验」：
//   · 预筛用 `/\bgit .*commit\b/`，把**提到**提交的命令也拦了（第一条测试命令
//     `echo '{"command":"git com…"}' | node …` 当场被自己挡住）
//   · `git diff --name-status` 默认转义非 ASCII 路径，而图纸文件名全是中文，
//     于是「图纸改了没有」永远判成「没改」—— 闸门只会拦、放不行
// 手工验证抓到了这两个，但那是运气；下一条规则未必有人再手工走一遍。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isCommitCommand, isModuleFile } from './arch-guard.mjs'

// ── 什么才算「在跑提交」 ──────────────────────────────────────────
test('裸的提交命令要认出来', () => {
  assert.ok(isCommitCommand('git commit -m "fix: x"'))
})

test('前面挂了别的命令也认（`git add … && git commit …` 是最常见写法）', () => {
  assert.ok(isCommitCommand('git add -A && git commit -m "x"'))
})

test('带 -C <路径> 的认，路径带空格加了引号也认', () => {
  assert.ok(isCommitCommand('git -C /tmp/x commit -m "x"'))
  assert.ok(isCommitCommand('git -C "/Users/me/vibe coding/t" commit -m "x"'))
})

test('换行分隔的多行脚本认', () => {
  assert.ok(isCommitCommand('set -e\ngit commit -m "x"\n'))
})

test('**只是「提到」提交的命令不能拦** —— 这就是它上线当天犯的错', () => {
  // 真实案例：测试自己时用的那条管道
  assert.equal(isCommitCommand(`echo '{"command":"git commit -m \\"x\\""}' | node hooks/arch-guard.mjs`), false)
  assert.equal(isCommitCommand('grep -n "git commit" docs/*.md'), false)
  assert.equal(isCommitCommand('echo "别忘了 git commit"'), false)
})

test('别的 git 子命令一律放行', () => {
  for (const c of ['git status', 'git log --oneline', 'git show HEAD', 'git commit-graph write']) {
    assert.equal(isCommitCommand(c), false, c)
  }
})

test('`git commit-graph` 不是提交 —— \\b 边界要挡住它', () => {
  assert.equal(isCommitCommand('git commit-graph verify'), false)
})

test('空 / undefined 不炸', () => {
  assert.equal(isCommitCommand(''), false)
  assert.equal(isCommitCommand(undefined), false)
})

// ── 什么算「源码模块」 ────────────────────────────────────────────
test('源码树里的 ts/tsx/mjs 算', () => {
  assert.ok(isModuleFile('src/main/probeEnv.ts'))
  assert.ok(isModuleFile('src/renderer/src/features/canvas/CanvasStage.tsx'))
  assert.ok(isModuleFile('mcp/eas-mcp.mjs'))
  assert.ok(isModuleFile('hooks/arch-guard.mjs'))
})

test('**测试文件不算** —— 加一条测试不该逼人改图纸，那样闸门会被关掉', () => {
  assert.equal(isModuleFile('src/main/probeEnv.test.ts'), false)
  assert.equal(isModuleFile('hooks/arch-guard.test.mjs'), false)
})

test('样式 / 类型声明 / 文档 / 配置不算', () => {
  for (const f of [
    'src/renderer/src/styles/app.css',
    'src/shared/types.d.ts',
    'docs/architecture/10-模块领地图.md',
    'hooks/dictionary-bundle.json',
    'package.json'
  ]) {
    assert.equal(isModuleFile(f), false, f)
  }
})

test('源码树之外的脚本不算（改 site/ 或 deploy/ 不牵动领地图）', () => {
  assert.equal(isModuleFile('site/index.html'), false)
  assert.equal(isModuleFile('deploy/tunnel/hub.mjs'), false)
})
