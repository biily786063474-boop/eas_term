// 2026-09-30 钥匙串调查（.superpowers/sdd/keychain/investigation.md）的回归钉：
// 启动阶段、以及 secrets:status 这条「标题栏一挂上就调」的路径，一律不许碰 safeStorage。
// safeStorage.isEncryptionAvailable() 本身就是一次同步钥匙串访问 —— 钥匙串锁着 / 不存在 /
// ACL 不匹配时，系统弹窗会把主线程卡死；信任设备的用户甚至在窗口出现之前就被卡住。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const stubs = {
  './ipcGuard': 'export const guardedHandle = (ch, fn) => globalThis.__handlers.set(ch, fn); export const guardedOn = () => {}',
  './island': 'export const isIslandWindow = () => false; export const mainWindow = () => null',
  './i18n.ts': 'export const t = (k) => k'
}
const code = (await build({
  entryPoints: [path.join(here, 'secrets.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'],
  plugins: [{
    name: 'stub',
    setup(b) {
      b.onResolve({ filter: /^\.\/(ipcGuard|island|i18n\.ts)$/ }, (a) => a.importer.endsWith('secrets.ts') ? { path: a.path, namespace: 'stub' } : undefined)
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }))
    }
  }]
})).outputFiles[0].text

/** 每个用例一个全新模块实例 + 临时 userData，safeStorage 每次被调都记一笔 */
function load({ store, available = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-secrets-test-'))
  if (store) fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify(store))
  const calls = []
  const state = { available }
  const safeStorage = {
    isEncryptionAvailable: () => { calls.push('isEncryptionAvailable'); return state.available },
    getSelectedStorageBackend: () => { calls.push('getSelectedStorageBackend'); return 'keychain' },
    encryptString: (s) => { calls.push('encryptString'); return Buffer.from('x' + s) },
    decryptString: (b) => { calls.push('decryptString'); return b.toString().slice(1) }
  }
  const electron = {
    app: { isReady: () => true, getName: () => 'Eas-Term', getPath: () => dir },
    safeStorage,
    BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
    dialog: {}
  }
  const handlers = new Map()
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, require: (n) => (n === 'electron' ? electron : require(n)),
    process, Buffer, console: { log() {}, warn() {}, error() {} },
    // 闲置上锁的 15 分钟计时器不能拖住测试进程
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout, Date, URL,
    globalThis: { __handlers: handlers }, __handlers: handlers
  })
  const call = (ch, ...args) => handlers.get(ch)({}, ...args)
  return { api: module.exports, calls, state, call, dir }
}

const trustedStore = () => {
  const salt = 'abcd'
  const hash = crypto.scryptSync('123456', salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')
  return { version: 2, app: 'Eas-Term', platform: process.platform, lock: { salt, hash }, trustedDevice: true, items: [] }
}

test('启动注册 + status：全新用户一次钥匙串都不碰，available 报「未知」', () => {
  const f = load()
  f.api.registerSecretHandlers()
  const st = f.call('secrets:status')
  assert.deepEqual(f.calls, [])
  assert.equal(st.available, null)
  assert.equal(st.configured, false)
  assert.equal(st.locked, true)
})

test('信任设备用户：启动注册不碰钥匙串（窗口出现前不能被系统弹窗卡住），status 也不碰', () => {
  const f = load({ store: trustedStore() })
  f.api.registerSecretHandlers()
  assert.deepEqual(f.calls, [], 'registerSecretHandlers 在 createWindow 之前跑，不许访问钥匙串')
  const st = f.call('secrets:status')
  assert.deepEqual(f.calls, [])
  // 用户选了信任设备：在真的验证失败之前，界面按「已解锁」呈现，免得多弹一次输码
  assert.equal(st.locked, false)
  assert.equal(st.trustedDevice, true)
  assert.equal(st.available, null)
})

test('信任设备：第一次真用（list）才验证钥匙串；可用 → 保持解锁并缓存 available', () => {
  const f = load({ store: trustedStore() })
  f.api.registerSecretHandlers()
  f.call('secrets:list')
  assert.ok(f.calls.includes('isEncryptionAvailable'), '真用时必须现查')
  f.calls.length = 0
  const st = f.call('secrets:status')
  assert.deepEqual(f.calls, [])
  assert.equal(st.available, true)
  assert.equal(st.locked, false)
})

test('信任设备：第一次真用发现系统加密不可用 → 不注入、status 转成锁定且 available=false', () => {
  const f = load({ store: trustedStore(), available: false })
  f.api.registerSecretHandlers()
  assert.equal(Object.keys(f.api.secretsEnv()).length, 0)
  f.calls.length = 0
  const st = f.call('secrets:status')
  assert.deepEqual(f.calls, [])
  assert.equal(st.available, false)
  assert.equal(st.locked, true)
  assert.equal(st.trustedDevice, false)
})

test('真加密操作前照旧现查：setup 在加密不可用时拒绝，并把结果缓存给 status', () => {
  const f = load({ available: false })
  f.api.registerSecretHandlers()
  const r = f.call('secrets:setup', '123456')
  assert.equal(r.ok, false)
  assert.equal(r.error, 'errCore.secrets.encryptionUnavailable')
  assert.ok(f.calls.includes('isEncryptionAvailable'))
  assert.equal(fs.existsSync(path.join(f.dir, 'secrets.json')), false, '不可用时一个字节都不写')
  f.calls.length = 0
  assert.equal(f.call('secrets:status').available, false)
  assert.deepEqual(f.calls, [])
})

test('每次真操作都现查，不吃缓存：可用→不可用之后 save 立即被拒', () => {
  const f = load()
  f.api.registerSecretHandlers()
  assert.equal(f.call('secrets:setup', '123456').ok, true)
  f.state.available = false
  f.calls.length = 0
  const r = f.call('secrets:save', { name: 'g', vars: [{ varName: 'A_KEY', value: 'v' }] })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'errCore.secrets.encryptionUnavailable')
  assert.ok(f.calls.includes('isEncryptionAvailable'))
  assert.ok(!f.calls.includes('encryptString'))
})

test('源码钉：标题栏密钥柜挂载时只拉 status，不拉 list（list 会解密，等于启动碰钥匙串）', () => {
  const src = fs.readFileSync(path.join(here, '../renderer/src/features/workspace/SecretsPanel.tsx'), 'utf8')
  // 订阅 onLocked 的那个 effect 就是挂载 effect：取它从 useEffect( 到订阅之间的正文
  const at = src.indexOf('secrets.onLocked(')
  assert.ok(at > 0, '找不到 onLocked 订阅')
  const body = src.slice(src.lastIndexOf('useEffect(', at), at).replace(/\/\/.*$/gm, '')
  assert.ok(!/refresh\(\)|secrets\.list\(|secrets\.audit\(/.test(body), '挂载时不能 list/audit（list 会解密）')
  assert.match(body, /secrets\.status\(\)/)
})

test('信任设备真门禁每次现查，不吃缓存：可用 → 不可用，立刻锁住', () => {
  const f = load({ store: trustedStore() })
  f.api.registerSecretHandlers()
  // 用 has 而不是 list 建立「验证通过」：list 会 touch() 续出 15 分钟的时间解锁（既有语义），
  // 那之后放行靠计时而不是信任腿，就测不到信任腿是否现查了
  assert.equal(f.call('secrets:has', ['A_KEY']).locked, false)
  assert.equal(f.call('secrets:status').available, true)
  f.state.available = false
  f.calls.length = 0
  assert.equal(Object.keys(f.api.secretsEnv()).length, 0)
  assert.ok(f.calls.includes('isEncryptionAvailable'), 'secretsEnv 必须现查')
  assert.equal(f.call('secrets:has', ['A_KEY']).locked, true)
  assert.equal(f.call('secrets:status').locked, true)
})

test('信任设备真门禁每次现查：不可用 → 恢复可用，下一次真用重新放行', () => {
  const f = load({ store: trustedStore(), available: false })
  f.api.registerSecretHandlers()
  assert.equal(f.call('secrets:has', ['A_KEY']).locked, true)
  assert.equal(f.call('secrets:status').locked, true)
  f.state.available = true
  f.calls.length = 0
  assert.equal(f.call('secrets:has', ['A_KEY']).locked, false)
  assert.ok(f.calls.includes('isEncryptionAvailable'))
  assert.equal(f.call('secrets:status').locked, false)
})
