// 这些测试钉的是「走错了不会报错、只会静默出事」的那几处：
// 平台目录名写成 darwin-arm64（打包期只 warn）、PI_CONFIG_DIR 算成空串（写进真 ~/.omp）、
// 拿不到路径时回落到 PATH（跑用户自己那个 omp）、工具白名单里混进不存在的名字
// （每次 session/new 都失败）。覆盖率不是目的。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  OMP_PINNED_VERSION,
  OMP_RESOURCE_DIR,
  OMP_USERDATA_DIR,
  OMP_TOOLS,
  OMP_BUILTIN_TOOLS,
  ompResourceDirName,
  ompBinFileName,
  ompBinPath,
  ompBinPathOrNull,
  ompConfigRoot,
  ompAgentDir,
  ompConfigDirRelative,
  parseOmpVersion
} from './paths.ts'
import type { HostPaths } from '../../../shared/agentChat.ts'

const MAC = { platform: 'darwin', arch: 'arm64' }
const WIN = { platform: 'win32', arch: 'x64' }

const host = (over: Partial<HostPaths>): HostPaths => ({
  isPackaged: false,
  resourcesPath: '',
  appPath: '/repo',
  userData: '/Users/u/Library/Application Support/Eas-Term',
  home: '/Users/u',
  ...over
})

test('--tools 白名单里的每个名字都真的是 omp 的内建工具（写错了每次 session/new 都会被 validateToolNames 抛）', () => {
  for (const t of OMP_TOOLS) {
    assert.ok(OMP_BUILTIN_TOOLS.includes(t as never), `${t} 不在 omp 的 BUILTIN_TOOL_NAMES 里`)
  }
})

test('白名单里没有 ls —— 它不是 omp 的工具名，列目录归 glob', () => {
  assert.ok(!OMP_TOOLS.includes('ls'))
  assert.ok(!OMP_BUILTIN_TOOLS.includes('ls' as never))
})

test('白名单不含生图 / 浏览器 / 电脑控制这三个（红线 + 默认开着的 browser）', () => {
  for (const forbidden of ['browser', 'computer', 'generate_image']) {
    assert.ok(!OMP_TOOLS.includes(forbidden), `${forbidden} 不该在白名单里`)
  }
})

test('平台目录名用 electron-builder 的 ${os} 取值（mac / win），不是 Node 的 darwin / win32', () => {
  assert.equal(ompResourceDirName(MAC), 'mac-arm64')
  assert.equal(ompResourceDirName({ platform: 'darwin', arch: 'x64' }), 'mac-x64')
  assert.equal(ompResourceDirName(WIN), 'win-x64')
  // 反过来钉一遍：出现 darwin/win32 就是错的，而这个错在打包期只是一条 warn
  assert.ok(!ompResourceDirName(MAC).startsWith('darwin'))
  assert.ok(!ompResourceDirName(WIN).startsWith('win32'))
})

test('Windows 上二进制叫 omp.exe', () => {
  assert.equal(ompBinFileName(MAC), 'omp')
  assert.equal(ompBinFileName(WIN), 'omp.exe')
})

test('packaged 下二进制在 <Resources>/omp/ 里，没有 <os>-<arch> 那一层（打包时被宏挑走压平了）', () => {
  const h = host({ isPackaged: true, resourcesPath: '/App.app/Contents/Resources' })
  assert.equal(ompBinPath(h, MAC), '/App.app/Contents/Resources/omp/omp')
})

test('dev 下走仓库的 resources/omp/<os>-<arch>/，比 packaged 多一层', () => {
  assert.equal(ompBinPath(host({}), MAC), '/repo/resources/omp/mac-arm64/omp')
  assert.equal(
    ompBinPathOrNull(host({ appPath: 'C:\\repo' }), WIN),
    'C:\\repo\\resources\\omp\\win-x64\\omp.exe'
  )
})

test('resourcesPath 在 node --test 下是 undefined —— 判空的那个函数不许抛，要回 null', () => {
  const h = host({ isPackaged: true, resourcesPath: undefined as unknown as string })
  assert.doesNotThrow(() => ompBinPathOrNull(h, MAC))
  assert.equal(ompBinPathOrNull(h, MAC), null)
  // detect() 会被 adapters.test.ts 无参调用，这条路也不许抛
  assert.doesNotThrow(() => ompBinPathOrNull(undefined, MAC))
  assert.equal(ompBinPathOrNull(undefined, MAC), null)
})

test('拿不到路径时 ompBinPath 抛错，绝不返回字面量 omp（回落到 PATH 就跑了用户自己装的那个）', () => {
  assert.throws(() => ompBinPath(undefined, MAC), /omp/)
  assert.throws(() => ompBinPath(host({ isPackaged: true, resourcesPath: '' }), MAC))
  // 反面钉死：任何一条路都不许产出裸的 'omp' / 'omp.exe'
  for (const h of [host({}), host({ isPackaged: true, resourcesPath: '/R' })]) {
    for (const p of [MAC, WIN]) {
      const got = ompBinPathOrNull(h, p)
      assert.ok(got && got !== 'omp' && got !== 'omp.exe', `${got} 是裸命令名`)
    }
  }
})

test('agentDir 是绝对路径 <userData>/omp/agent（PI_CODING_AGENT_DIR 要绝对的）', () => {
  const ud = '/Users/u/Library/Application Support/Eas-Term'
  assert.equal(ompConfigRoot(ud, MAC), `${ud}/omp`)
  assert.equal(ompAgentDir(ud, MAC), `${ud}/omp/agent`)
  assert.ok(path.posix.isAbsolute(ompAgentDir(ud, MAC)))
})

test('PI_CONFIG_DIR 是相对 HOME 的，且 omp 侧 join 回来必须还原成原路径', () => {
  const home = '/Users/u'
  const ud = '/Users/u/Library/Application Support/Eas-Term'
  const rel = ompConfigDirRelative(home, ud, MAC)
  assert.equal(rel, 'Library/Application Support/Eas-Term/omp')
  // 这一步就是 omp 的 dirs.ts:110-112 干的事
  assert.equal(path.posix.join(home, rel), ompConfigRoot(ud, MAC))
})

test('隔离实例的 tmpdir 不在 home 底下，靠 .. 表达；path.join 会规范化掉，不必另开分支', () => {
  const home = '/Users/u'
  const ud = '/private/tmp/eas-verify-1/userdata'
  const rel = ompConfigDirRelative(home, ud, MAC)
  assert.ok(rel.startsWith('..'), '预期用 .. 回退——这是正常情况，不是错误')
  assert.equal(path.posix.join(home, rel), '/private/tmp/eas-verify-1/userdata/omp')
})

test('算成空串要抛 —— omp 的 `PI_CONFIG_DIR || ".omp"` 会把空串吃掉，静默写进用户真实的 ~/.omp', () => {
  // home 本身就是 configRoot 的那种病态配置：relative() 回空串
  assert.throws(() => ompConfigDirRelative('/Users/u/omp', '/Users/u', MAC), /空串|~\/\.omp/)
})

test('Windows 跨盘符按「盘根不同」判，不按「以 .. 开头」判（posix 的 .. 是正常的）', () => {
  // 同盘：正常
  assert.equal(
    ompConfigDirRelative('C:\\Users\\u', 'C:\\Users\\u\\AppData\\Roaming\\Eas-Term', WIN),
    'AppData\\Roaming\\Eas-Term\\omp'
  )
  // 跨盘：path.relative 返回的是绝对路径 D:\data\omp，omp 再 join 上 home 会变成废路径
  assert.equal(path.win32.relative('C:\\Users\\u', 'D:\\data\\omp'), 'D:\\data\\omp')
  assert.throws(() => ompConfigDirRelative('C:\\Users\\u', 'D:\\data', WIN), /盘/)
  // 盘符大小写不同不算跨盘
  assert.doesNotThrow(() => ompConfigDirRelative('c:\\Users\\u', 'C:\\Users\\u\\x', WIN))
})

test('版本号解析对得上钉死的 18.1.2（实测 `omp --version` 输出 `omp/18.1.2`）', () => {
  assert.equal(parseOmpVersion('omp/18.1.2\n'), OMP_PINNED_VERSION)
  assert.equal(parseOmpVersion('omp/18.1.2-canary.1'), '18.1.2-canary.1')
  assert.equal(parseOmpVersion('command not found'), null)
})

test('打包常量与配置目录常量是两个东西，别合并（一个只读、一个可写，语义无关）', () => {
  assert.equal(OMP_RESOURCE_DIR, 'omp')
  assert.equal(OMP_USERDATA_DIR, 'omp')
  assert.equal(OMP_PINNED_VERSION, '18.1.2')
})
