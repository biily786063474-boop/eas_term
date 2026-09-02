// 探测 CLI 用的 PATH 怎么拼。
//
// ── 这里的每条测试都对应一次真实事故 ──────────────────────────────
// 2026-09-01：用户装着 Claude Code，界面却一直说「未安装」、不给启动按钮。
// 根因是这份 PATH 里只写死了 `/opt/homebrew/bin:/usr/local/bin`，
// 而 Claude Code 2.x 的原生安装器把二进制放在 `~/.local/bin`
// （实测 `~/.local/bin/claude -> ~/.local/share/claude/versions/2.1.258`）。
// 从 Dock 启动时 launchd 给的 PATH 也没有它 —— 于是 spawn 报 ENOENT，
// 被判成「没装」。同一台机器上 codex 在 homebrew 里，所以只有 claude 挂，
// 更像「app 坏了」而不是「路径不对」。
//
// 所以：**候选目录只有这一份**，谁要探测谁引它；
// 而候选目录再全也总有漏网的，真正兜底的是登录 shell 那份 PATH。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildProbePath, parseLoginPath, userBinDirs } from './probeEnv.ts'

const HOME = '/Users/me'
const mac = (env: NodeJS.ProcessEnv = {}): string[] => userBinDirs(HOME, 'darwin', env)

// ── 候选目录 ──────────────────────────────────────────────────────
test('**macOS 候选必须含 ~/.local/bin** —— 漏了它就是 2026-09-01 那个 bug', () => {
  assert.ok(mac().includes('/Users/me/.local/bin'))
})

test('~/.local/bin 排在最前 —— 它是 Claude Code 原生安装器的落点，最该先命中', () => {
  assert.equal(mac()[0], '/Users/me/.local/bin')
})

test('homebrew 与 /usr/local 仍在（历史上从 Dock 启动就靠这两条活着）', () => {
  const d = mac()
  assert.ok(d.includes('/opt/homebrew/bin'))
  assert.ok(d.includes('/usr/local/bin'))
})

test('覆盖 bun / npm-global / claude 旧版 local 安装位', () => {
  const d = mac()
  assert.ok(d.includes('/Users/me/.bun/bin'))
  assert.ok(d.includes('/Users/me/.npm-global/bin'))
  // `claude migrate-installer` 装到这里，2.x 之前的用户还留着
  assert.ok(d.includes('/Users/me/.claude/local'))
})

test('Windows 走另一套：npm 目录 + WindowsApps + 同样有 .local\\bin', () => {
  const d = userBinDirs('C:\\Users\\me', 'win32', {
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local'
  })
  assert.ok(d.some((x) => x.endsWith('AppData\\Roaming\\npm')))
  assert.ok(d.some((x) => x.includes('WindowsApps')))
  // Windows 的原生安装器也落在 %USERPROFILE%\.local\bin
  assert.ok(d.some((x) => x.endsWith('.local\\bin')))
})

test('APPDATA / LOCALAPPDATA 缺失时不产出空串或 undefined 拼出来的路径', () => {
  const d = userBinDirs('C:\\Users\\me', 'win32', {})
  assert.ok(d.every((x) => !!x && !x.includes('undefined')))
})

// ── 拼 PATH ───────────────────────────────────────────────────────
const P = (login: string | null, base: string): string[] =>
  buildProbePath(mac(), login, base, ':').split(':')

test('候选目录排在进程自带 PATH 前面 —— 否则贫瘠 PATH 里的同名旧版会先命中', () => {
  const got = P(null, '/usr/bin:/bin')
  assert.ok(got.indexOf('/Users/me/.local/bin') < got.indexOf('/usr/bin'))
})

test('原来的 PATH 一条都不能丢', () => {
  const got = P(null, '/usr/bin:/bin:/sbin')
  for (const d of ['/usr/bin', '/bin', '/sbin']) assert.ok(got.includes(d), d)
})

test('**登录 shell 的 PATH 会并进来** —— 这才是「装在哪都能找到」的兜底', () => {
  const got = P('/Users/me/.rye/shims:/opt/weird/bin', '/usr/bin')
  assert.ok(got.includes('/Users/me/.rye/shims'))
  assert.ok(got.includes('/opt/weird/bin'))
})

test('登录 shell 的 PATH 排在写死候选之后 —— 候选是止血，不该盖过用户真实环境的顺序', () => {
  const got = P('/opt/weird/bin', '/usr/bin')
  assert.ok(got.indexOf('/Users/me/.local/bin') < got.indexOf('/opt/weird/bin'))
})

test('去重：三份来源重叠很多，不去重 PATH 会滚成几百项', () => {
  const got = P('/opt/homebrew/bin:/usr/bin', '/opt/homebrew/bin:/usr/bin')
  assert.equal(got.filter((x) => x === '/opt/homebrew/bin').length, 1)
  assert.equal(got.filter((x) => x === '/usr/bin').length, 1)
})

test('空段被丢掉 —— PATH 里的空项在 POSIX 下等于「当前目录」，是安全隐患', () => {
  assert.ok(!P(null, '/usr/bin::/bin:').includes(''))
})

// ── 解析登录 shell 的输出 ─────────────────────────────────────────
test('**从噪声里取 PATH** —— rc 文件会打印 banner、补全提示、p10k 的转义序列', () => {
  const out = 'Powerlevel10k 加载中…\n\x1b[32mok\x1b[0m\n__EAS_PATH__/a:/b__EAS_PATH__\n再见\n'
  assert.equal(parseLoginPath(out), '/a:/b')
})

test('没有标记就当读失败，返回 null（宁可用候选目录，也不要把 banner 当 PATH）', () => {
  assert.equal(parseLoginPath('zsh: command not found: foo\n'), null)
})

test('标记内为空也算失败', () => {
  assert.equal(parseLoginPath('__EAS_PATH____EAS_PATH__'), null)
})
