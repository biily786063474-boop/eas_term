// 密钥柜：把 API key 之类的东西存在本机，注入给终端用，**但不让它进入和 AI 的对话**。
//
// ── 这个功能承诺什么、不承诺什么 ────────────────────────────────────
// 承诺：密钥不会出现在对话里、不上传给模型厂商、不进 ~/.claude/projects/*.jsonl、
//       不进 shell history。这是它真正解决的问题。
// 不承诺：「AI 读不到」。密钥一旦注入终端环境变量，在那个终端里跑命令的 AI
//       `echo $KEY` 就能看见 —— 同一个进程里的东西没法对该进程隐藏。
//       UI 文案必须按前者写，绝不能写成后者，见 docs/密钥管理器-设计与可行性.html。
//
// ── 加密：交给 Electron safeStorage，不自己写密码学 ──────────────────
// macOS：主密钥是 Keychain 里的 generic password（service = `<productName> Safe Storage`），
//        受系统 ACL 保护，密文拷到另一台机器解不开。
// Windows：DPAPI。**保护弱一档** —— 只隔离登录用户，同一用户下的任何进程都能解。
//        而且主密钥在 `<userData>/Local State`，那是密钥库的隐藏另一半，删了就全没了。
//        （这也是密钥库放 userData 而不是 ~/.eas 的最强理由：两半在一起，备份不会只带走一半。）
//
// ── 三个会静默失效的坑（实测确认过，不是理论担忧）────────────────────
// 1. **ready 之前调 safeStorage 会用错密钥桶**。macOS 上 isEncryptionAvailable() 照样返回
//    true、encryptString() 照样成功，但用的是全局的 `Chromium Safe Storage` 而不是本 app 的桶，
//    而且 OSCrypt 把 key 缓存在进程静态里 —— 一次 ready 前的调用污染整个进程生命周期，
//    于是「其他 app 拿不到」这条保护当场失效（任何同样这么干的 Electron 应用共用同一把密钥）。
//    对策：所有入口都过 assertReady()。
// 2. **CBC 没有认证，而且失效率高得离谱**。safeStorage 在 macOS 用 AES-128-CBC、IV 硬编码。
//    本机实测（56 字符的密钥、随机翻转一个 bit、3000 次）：**62.9% 静默解出错误内容**，
//    只有 37% 抛错 —— 因为 CBC 下只有改到最后一块才破坏 padding，前面几块改了照样"解密成功"。
//    这不是低概率风险：密钥库只要有一个字节坏了（磁盘错误、同步冲突、误编辑），
//    大概率会**静默注入一个错误的密钥值**到终端里，然后你对着 401 排查半天。
//    对策：加密前把 checksum 一起封进明文，解密后校验（见 seal/open）。同样 3000 次实测 0 漏过。
// 3. **改 productName 会丢光所有密钥**（钥匙串桶名由 app.getName() 决定）。
//    对策：库里记下当时的 app 名，对不上时明确告知而不是抛一个看不懂的解密错误。
import { app, ipcMain, safeStorage, BrowserWindow } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import type { SecretMeta, SecretReveal, SecretSaveInput, SecretsStatus } from '../shared/types'

// 库文件放 userData 而不是 ~/.eas：
//  · userData 的父目录天然 0700（~/.eas 实测是 0755，世界可读）
//  · Windows 上主密钥就在同目录的 `Local State`，两半放一起，备份/迁移不会只带走一个
//  · 语义上也更对 —— ~/.eas 是「用户可以自己去改」的区（词典、角色），密钥库不是
const storeFile = (): string => path.join(app.getPath('userData'), 'secrets.json')

/** v2：一条从「一个变量」改成「一组变量」（AK/SK 这类成对凭证）。读到 v1 会就地升。 */
const VERSION = 2
/** 六位码：纯数字六位 */
const CODE_RE = /^\d{6}$/
/** 解锁后多久无操作自动上锁 */
const IDLE_MS = 15 * 60 * 1000
/** 连续错几次开始退避 */
const FAIL_THRESHOLD = 5

interface StoredVar {
  varName: string
  /** safeStorage 密文的 base64。明文是 sealed（见 seal），不是裸的密钥值 */
  cipher: string
}

/** 一条 = 一组凭证，可以有多个变量。
 *
 *  为什么不是「一条一个变量」：AK/SK 这类东西是**一个整体** ——
 *  AWS 要 AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY，数据库要 host/user/password，
 *  删了一半留着另一半没有意义，「自动注入」也不可能只开一半。
 *  拆成两条的话，用户得填两次、在列表里还看不出它俩是一对。 */
interface StoredItem {
  id: string
  name: string
  note?: string
  vars: StoredVar[]
  /** 新开的终端自动带上这一组。默认关 —— 每多一组自动注入的密钥，
   *  就多一批能读到它的进程（终端里跑的任何东西，包括 npm 包的 postinstall） */
  autoInject?: boolean
  createdAt: number
  lastUsedAt?: number
}

/** v1 的形状：一条只有一个变量。读到这种就地升成 v2（见 migrateItem） */
interface LegacyItem {
  id: string
  name: string
  varName: string
  cipher: string
  note?: string
  autoInject?: boolean
  createdAt: number
  lastUsedAt?: number
}

interface StoreFile {
  version: number
  /** 记下写库时的 app 名。改了 productName 钥匙串桶名会变，用它给出人话解释 */
  app: string
  /** 记下写库时的平台，跨平台同步过来时能说清「这台机器解不开」 */
  platform: string
  lock?: { salt: string; hash: string }
  items: StoredItem[]
}

// ── 进程内的解锁态。不持久化：重启即锁 ──────────────────────────────
let unlockedUntil = 0
let failCount = 0
let lockedOutUntil = 0

/** safeStorage 在 app ready 之前用会静默用错密钥桶，所有入口都得先过这道 */
function assertReady(): void {
  if (!app.isReady()) {
    throw new Error('密钥柜在 app ready 之前不可用（safeStorage 会用错密钥桶）')
  }
}

function emptyStore(): StoreFile {
  return { version: VERSION, app: app.getName(), platform: process.platform, items: [] }
}

function readStore(): StoreFile {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as Partial<StoreFile>
    return {
      // 读进来就已经被 migrateItem 升成当前结构了，所以版本号直接写成当前值。
      // 保留原值的话会出现「内容是 v2、号还标 v1」的库 —— 将来做 v3 迁移必然误判。
      version: VERSION,
      app: typeof raw.app === 'string' ? raw.app : app.getName(),
      platform: typeof raw.platform === 'string' ? raw.platform : process.platform,
      lock:
        raw.lock && typeof raw.lock.salt === 'string' && typeof raw.lock.hash === 'string'
          ? { salt: raw.lock.salt, hash: raw.lock.hash }
          : undefined,
      // 逐条挑，坏的那条丢掉而不是整份打不开（同 roles.ts / canvasSlice 的 sanitize 思路）
      items: Array.isArray(raw.items)
        ? (raw.items as unknown[]).map(migrateItem).filter((x): x is StoredItem => x !== null)
        : []
    }
  } catch {
    return emptyStore() // 第一次用，或者文件坏了
  }
}

/** 逐条规范化 + v1→v2 升级。返回 null = 这条坏了，丢掉它而不是让整份库打不开。 */
function migrateItem(raw: unknown): StoredItem | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Partial<StoredItem> & Partial<LegacyItem>
  if (typeof x.id !== 'string' || typeof x.name !== 'string') return null

  let vars: StoredVar[]
  if (Array.isArray(x.vars)) {
    vars = x.vars.filter(
      (v): v is StoredVar =>
        !!v && typeof (v as StoredVar).varName === 'string' && typeof (v as StoredVar).cipher === 'string'
    )
  } else if (typeof x.varName === 'string' && typeof x.cipher === 'string') {
    // v1 的一条 = 一个变量，包成只有一个元素的组
    vars = [{ varName: x.varName, cipher: x.cipher }]
  } else {
    return null
  }
  if (!vars.length) return null

  return {
    id: x.id,
    name: x.name,
    note: typeof x.note === 'string' ? x.note : undefined,
    vars,
    autoInject: x.autoInject === true,
    createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
    lastUsedAt: typeof x.lastUsedAt === 'number' ? x.lastUsedAt : undefined
  }
}

/** 原子写 + 0600。
 *  原子：写一半就崩的话，丢的是**全部**密钥，比丢一条词条严重得多，所以不能像 ~/.eas 那几个文件那样裸写。
 *  权限：mode 只在**新建**时生效、且会被 umask 削，所以写完再 chmod 一次（照抄 pty.ts:53 的双保险）。 */
function writeStore(s: StoreFile): void {
  const f = storeFile()
  const dir = path.dirname(f)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(dir, 0o700) // recursive:true 对**已存在**的目录不改权限
  } catch {
    /* 改不动就算了，userData 本来就是 0700 */
  }
  const tmp = f + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 })
  try {
    fs.chmodSync(tmp, 0o600)
  } catch {
    /* 尽力 */
  }
  fs.renameSync(tmp, f)
  try {
    fs.chmodSync(f, 0o600)
  } catch {
    /* 尽力 */
  }
}

// ── 加密：safeStorage + 自带完整性校验 ──────────────────────────────

/** 封装成「值 + 校验和」再加密。
 *  为什么不直接加密裸值：safeStorage 在 macOS 用的是 AES-CBC，没有认证标签。
 *  实测（3000 次随机翻转一个 bit）**62.9% 会通过 padding 校验、静默解出错误内容** ——
 *  不是小概率。多存一个 sha256，解出来对不上就知道这份密文已经不可信。 */
function seal(value: string): string {
  const sum = crypto.createHash('sha256').update(value, 'utf8').digest('hex')
  const payload = JSON.stringify({ v: value, c: sum })
  return safeStorage.encryptString(payload).toString('base64')
}

type OpenResult = { ok: true; value: string } | { ok: false; reason: 'undecryptable' | 'tampered' }

function open(cipher: string): OpenResult {
  let plain: string
  try {
    plain = safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    // 密钥不在这台机器上（库被拷/同步过来了），或者钥匙串桶变了（改过 productName）
    return { ok: false, reason: 'undecryptable' }
  }
  try {
    const o = JSON.parse(plain) as { v?: unknown; c?: unknown }
    if (typeof o.v !== 'string' || typeof o.c !== 'string') return { ok: false, reason: 'tampered' }
    const sum = crypto.createHash('sha256').update(o.v, 'utf8').digest('hex')
    // 时间常数比较：这里比的是校验和不是秘密本身，但没理由留个可测的分支
    if (!crypto.timingSafeEqual(Buffer.from(sum), Buffer.from(o.c))) {
      return { ok: false, reason: 'tampered' }
    }
    return { ok: true, value: o.v }
  } catch {
    return { ok: false, reason: 'tampered' }
  }
}

// ── 六位码：只是「人在场证明」，不参与加密 ──────────────────────────
// 六位数字 100 万种组合，离线爆破几秒 —— 所以它绝不能是加密密钥。
// 真正的保护是 safeStorage（系统钥匙串）。这一层防的是：
// 「你去倒杯咖啡时 AI 自动把所有密钥注入了」「同事借你电脑用一下」。
// 因为不承担加密强度，可以做得很快，不用把 KDF 参数拉到拖慢交互。

function hashCode(code: string, salt: string): string {
  return crypto.scryptSync(code, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')
}

function verifyCode(s: StoreFile, code: string): boolean {
  if (!s.lock) return false
  const got = hashCode(code, s.lock.salt)
  const want = s.lock.hash
  if (got.length !== want.length) return false
  return crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'))
}

const isUnlocked = (): boolean => Date.now() < unlockedUntil

/**
 * 闲置到期时主动告诉界面一声。
 *
 * 解锁态本来是「懒判断」（每次用的时候比一下时间戳），没人主动通知 ——
 * 于是标题栏那把钥匙会一直显示「已解锁」直到你去点它，
 * 而这期间新开的终端其实已经拿不到密钥了。一个说谎的安全状态指示比没有更糟。
 */
let lockTimer: NodeJS.Timeout | null = null
function scheduleLockNotice(): void {
  if (lockTimer) clearTimeout(lockTimer)
  const ms = unlockedUntil - Date.now()
  if (ms <= 0) return
  lockTimer = setTimeout(() => {
    lockTimer = null
    if (isUnlocked()) return // 期间又续期了
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('secrets:locked')
    }
  }, ms + 200)
}
/** 每次成功操作都续期：15 分钟指的是「无操作」而不是「解锁后」 */
const touch = (): void => {
  if (isUnlocked()) {
    unlockedUntil = Date.now() + IDLE_MS
    scheduleLockNotice()
  }
}

// ── 注入：给 pty.ts 用 ──────────────────────────────────────────────

/**
 * 取出要注入终端的密钥。**值在主进程内解密后直接进 env，从不回传渲染层。**
 *
 * 这条路和 mcpBridge 的 EAS_TERM_TOKEN 完全一样 —— 那个 token 也是只存在于主进程、
 * 只经 PTY env 下发，从没穿过渲染层，更没进过对话。
 *
 * names 语义：
 *   undefined → 用「标了自动注入」的那些（正常路径，渲染层什么都不用传）
 *   []        → 明确不要注入任何东西
 *   [..]      → 就用这些（留给将来的高级用法）
 *
 * **锁定态下一律不注入。** 这一条是验收时改过来的 ——
 * 原来的写法（"打开开关那一刻已经表达过意图了，spawn 这步不用再问"）在纸面上说得通，
 * 实测下来是个洞：AI 自己就能开终端（MCP 的 canvas_new_terminal），
 * 于是锁不锁完全一样，六位码变成纯装饰 —— 人不在电脑前的那段时间恰恰是最该防的。
 *
 * 代价是重启后恢复画布批量重开的终端不带密钥（那时必然是锁着的），
 * 解锁之后得重开才有。这个代价是对的：没证明"人在场"，就不该发密钥。
 */
export function secretsEnv(names?: string[]): Record<string, string> {
  if (!app.isReady()) return {} // 兜底，正常不会走到
  if (names && names.length === 0) return {}
  if (!isUnlocked()) {
    // 别静默 —— "终端里怎么没有 key" 要能在日志里找到答案
    console.log('[secrets] 密钥柜锁着，这个终端不注入任何密钥')
    return {}
  }
  const s = readStore()
  // 指定了名字就按名字挑（可以只要一组里的某几个变量）；没指定就用标了自动注入的整组
  const pick = (it: StoredItem, v: StoredVar): boolean =>
    names ? names.includes(v.varName) : !!it.autoInject
  const out: Record<string, string> = {}
  let used = false
  for (const it of s.items) {
    let hit = false
    for (const v of it.vars) {
      if (!pick(it, v)) continue
      const r = open(v.cipher)
      if (!r.ok) {
        console.error(`[secrets] ${v.varName} 解不开（${r.reason}），跳过注入`)
        continue
      }
      out[v.varName] = r.value
      hit = true
    }
    if (hit) {
      it.lastUsedAt = Date.now()
      used = true
    }
  }
  if (used) {
    try {
      writeStore(s) // 记一下「最后用于」，方便用户看哪些还在用
    } catch {
      /* 记录失败不该拦住终端启动 */
    }
  }
  return out
}

/** 注入进 PTY 的那一刻记一笔审计（只记名字）。pty.ts 拿到 env 之后调 */
export function auditInjection(ptyId: string, names: string[]): void {
  if (names.length) audit({ at: Date.now(), ptyId, source: 'pty-env', names })
}

/**
 * 某个终端启动时到底带上了哪些变量。**只存名字，不存值。**
 *
 * 有两个用处，都是「让人和 AI 都不用去 echo 才知道」：
 *   · secret_check 工具告诉 agent「这个变量你这个终端能不能直接用」
 *   · 终端角标显示这个终端携带了几组密钥
 * PTY 死了也不删：agent 可能在进程退出后才来问，留着不占什么。
 */
const injectedByPty = new Map<string, string[]>()

export function noteInjected(ptyId: string, names: string[]): void {
  if (names.length) injectedByPty.set(ptyId, names)
}
export function injectedInPty(ptyId?: string): string[] {
  return ptyId ? (injectedByPty.get(ptyId) ?? []) : []
}

// ── 按终端授权 ─────────────────────────────────────────────────────
//
// **这一整块是在修一个我们自己造出来的回退。** 加 eas-secret 时，/secret-env 只认全局
// EAS_TERM_TOKEN，而那个 token 注入到每一个 PTY 的 env、还明文落在
// userData/mcp-endpoint.json 里。于是一个「一条密钥都没注入」的终端里跑的任何东西
// （npm 的 postinstall 就够了）POST 一次就能拿走**整柜**明文，包括从没进过任何终端的组。
//
// 这推翻了两件本来成立的事：
//   · 设计文档里「按终端授权，不是全局注入，限制了恶意依赖能偷到的范围」
//   · 密钥柜面板上那句「新开的终端会自动带上 N 条」所暗示的上界
//
// 修法：每个 PTY 启动时单独发一张凭证（EAS_SECRET_TOKEN），主进程记住
// 这张凭证对应哪个终端、那个终端**被允许取哪几组**。允许的范围刻意设成：
//   ① 这个终端启动时本来就会注入的组（拿得到不是新增权限，它 env 里已经有了）
//   ② 本会话里用户通过 request_secret 现场给这个终端的组（eas-secret 的核心用例）
// 关掉自动注入的组，对没被授权的终端就是取不到 —— 保护回来了。
const ptyGrants = new Map<string, Set<string>>() // ptyId → 可取的组名
const secretTokens = new Map<string, string>() // 一次性凭证 → ptyId

export function issueSecretToken(ptyId: string, groups: string[]): string {
  const tok = crypto.randomBytes(24).toString('hex')
  secretTokens.set(tok, ptyId)
  ptyGrants.set(ptyId, new Set(groups))
  return tok
}

/** 用户当场把某一组给了这个终端（request_secret 存完就调）→ 它才能用 eas-secret 取 */
export function grantGroupToPty(ptyId: string | undefined, group: string): void {
  if (!ptyId) return
  const s = ptyGrants.get(ptyId) ?? new Set<string>()
  s.add(group)
  ptyGrants.set(ptyId, s)
}

export function forgetPty(ptyId: string): void {
  ptyGrants.delete(ptyId)
  injectedByPty.delete(ptyId)
  for (const [tok, id] of secretTokens) if (id === ptyId) secretTokens.delete(tok)
}

/** 哪些组会被自动注入 —— 也就是新终端默认被授权的范围 */
export function autoInjectGroups(): string[] {
  return readStore()
    .items.filter((it) => it.autoInject)
    .map((it) => it.name)
}

/**
 * 查这些变量在不在柜里 / 在不在某个终端里。**只回布尔，永不回值。**
 *
 * 故意**不要求解锁**：锁着的时候 agent 也该能判断「柜里已经有了，只是要用户解个锁」，
 * 否则它只能盲目再弹一次 request_secret 去骚扰用户 —— 而变量名本身不是秘密
 * （AWS_ACCESS_KEY_ID 谁都知道），泄露的信息量远小于反复弹窗的代价。
 */
export function secretsHas(
  names: string[],
  ptyId?: string
): { varName: string; inVault: boolean; readable: boolean; inThisTerminal: boolean }[] {
  const s = readStore()
  const here = new Set(injectedInPty(ptyId))
  const byName = new Map<string, StoredVar>()
  for (const it of s.items) for (const v of it.vars) byName.set(v.varName, v)
  return names.map((varName) => {
    const v = byName.get(varName)
    return {
      varName,
      inVault: !!v,
      readable: v ? open(v.cipher).ok : false,
      inThisTerminal: here.has(varName)
    }
  })
}

/** 哪一组包含这个变量 —— eas-secret 按组名取值时要用 */
export function groupOf(varName: string): string | null {
  const s = readStore()
  for (const it of s.items) if (it.vars.some((v) => v.varName === varName)) return it.name
  return null
}

/**
 * 给 eas-secret 包装命令用：按组名或变量名取一组值。
 * **这是明文离开主进程的第二条路**（第一条是 PTY env 注入），所以门开得比 secretsEnv 还紧：
 * 必须解锁态。调用方是本机的 shim 进程，靠 EAS_TERM_TOKEN 认身份。
 */
export function secretsForRun(
  sel: { group?: string; vars?: string[] },
  auth: { secretToken?: string; mcpEnabled: boolean }
): {
  ok: boolean
  env?: Record<string, string>
  error?: string
} {
  if (!app.isReady()) return { ok: false, error: '应用还没就绪' }
  // 标题栏那个「MCP 接入」开关说的是「关掉后所有工具调用立刻被拒」。
  // 它原来只挡 /invoke，挡不住这条价值最高的路 —— 安全开关撒谎比没有开关更糟。
  if (!auth.mcpEnabled) {
    return { ok: false, error: '用户已在 Eas-Term 里关闭 MCP 接入，密钥也一并停发' }
  }
  if (!isUnlocked()) {
    return { ok: false, error: '密钥柜锁着 —— 让用户点标题栏的钥匙图标输入六位码，然后重试这条命令' }
  }
  // 认「哪个终端在要」，不是只认「有没有 token」。见 ptyGrants 那段注释。
  const ptyId = auth.secretToken ? secretTokens.get(auth.secretToken) : undefined
  if (!ptyId) {
    return { ok: false, error: '这个终端没有取密钥的凭证 —— 在 Eas-Term 里新开一个终端再试' }
  }
  const allowed = ptyGrants.get(ptyId) ?? new Set<string>()

  const s = readStore()
  const picked = sel.group
    ? s.items.filter((it) => it.name === sel.group)
    : s.items.filter((it) => it.vars.some((v) => sel.vars?.includes(v.varName)))
  if (!picked.length) {
    return { ok: false, error: sel.group ? `密钥柜里没有「${sel.group}」这一组` : '密钥柜里没有这些变量' }
  }
  const denied = picked.filter((it) => !allowed.has(it.name)).map((it) => it.name)
  if (denied.length) {
    return {
      ok: false,
      error:
        `这个终端没被授权用「${denied.join('、')}」。` +
        '要么让用户在密钥柜里给它打开「自动注入」然后新开一个终端，' +
        '要么用 request_secret 让用户当场授权。'
    }
  }

  const env: Record<string, string> = {}
  const names: string[] = []
  for (const it of picked) {
    for (const v of it.vars) {
      // 指定了 vars 就只给那几个，指定 group 就整组给
      if (sel.vars && !sel.vars.includes(v.varName)) continue
      const r = open(v.cipher)
      if (!r.ok) return { ok: false, error: `${v.varName} 在这台机器上解不开，需要重新录入` }
      env[v.varName] = r.value
      names.push(v.varName)
    }
    it.lastUsedAt = Date.now()
  }
  audit({ at: Date.now(), ptyId, source: 'eas-secret', names })
  try {
    writeStore(s)
  } catch {
    /* 记录失败不该拦住命令执行 */
  }
  return { ok: true, env }
}

// ── 审计 ───────────────────────────────────────────────────────────
//
// **只记名字和时间，永远不记值。** 存在的意义是让「谁在什么时候拿走了什么」可查 ——
// 出事能追溯，也是让人敢用这个功能的理由。放内存不落盘：落盘等于多一份
// 「这台机器上有哪些密钥」的清单躺在磁盘上，而它的用途只是给用户看最近发生了什么。
export interface SecretAuditEntry {
  at: number
  ptyId?: string
  source: 'pty-env' | 'eas-secret' | 'reveal'
  names: string[]
}
const auditLog: SecretAuditEntry[] = []
const AUDIT_MAX = 300

function audit(e: SecretAuditEntry): void {
  auditLog.push(e)
  if (auditLog.length > AUDIT_MAX) auditLog.splice(0, auditLog.length - AUDIT_MAX)
}
export function secretAudit(): SecretAuditEntry[] {
  return auditLog.slice().reverse()
}

// ── IPC ────────────────────────────────────────────────────────────

function status(): SecretsStatus {
  const s = readStore()
  return {
    available: safeStorage.isEncryptionAvailable(),
    configured: !!s.lock,
    locked: !isUnlocked(),
    count: s.items.length,
    // 库是别的 app 名/别的平台写的 → 这台机器多半解不开，UI 要能说人话而不是甩解密错误
    foreign: s.items.length > 0 && (s.app !== app.getName() || s.platform !== process.platform),
    lockedOutMs: Math.max(0, lockedOutUntil - Date.now())
  }
}

/** 变更类统一这个形状（项目惯例：不 throw 到 IPC 对面，顺手回带最新 status） */
type Res = { ok: boolean; error?: string; status: SecretsStatus }
const fail = (error: string): Res => ({ ok: false, error, status: status() })
const done = (): Res => ({ ok: true, status: status() })

/** 需要解锁的操作的统一前置 */
function requireUnlocked(): string | null {
  if (!isUnlocked()) return '密钥柜已锁定，请先输入六位码'
  return null
}

export function registerSecretHandlers(): void {
  // 见文件头第 1 条坑：这个模块任何时候都不能在 ready 之前碰 safeStorage
  assertReady()

  ipcMain.handle('secrets:status', () => status())

  /** 首次设置六位码。已经设过就得先解锁再改（走 secrets:changeCode） */
  ipcMain.handle('secrets:setup', (_e, code: string): Res => {
    try {
      if (!CODE_RE.test(String(code))) return fail('六位码必须是 6 位数字')
      const s = readStore()
      if (s.lock) return fail('已经设置过六位码了')
      if (!safeStorage.isEncryptionAvailable()) return fail('这台机器上系统加密不可用，无法安全存储')
      const salt = crypto.randomBytes(16).toString('hex')
      s.lock = { salt, hash: hashCode(String(code), salt) }
      s.app = app.getName()
      s.platform = process.platform
      writeStore(s)
      unlockedUntil = Date.now() + IDLE_MS // 刚设完直接进解锁态，省一次输入
      failCount = 0
      scheduleLockNotice()
      return done()
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  /**
   * 忘了六位码 → 换一个，**密钥一条不动**。
   *
   * 看着像后门，其实不是：六位码从来就不是加密边界（密钥是钥匙串加密的，
   * 跟这六位数没关系）。把 secrets.json 里的 lock 段删掉、重启、设个新码，
   * 所有密钥照样解得开 —— 能编辑那个文件的人本来就能绕过。
   * 不在 GUI 上铺这条路，挡不住任何真会来的人，只会让忘了码的自己人全盘重录。
   *
   * 退避（lockedOutUntil）故意不管这里：那是防在线猜码的，而重置根本不用猜。
   * 真正的摩擦放在 UI 的二次确认上，文案必须说清「重置后柜子就开了」。
   */
  ipcMain.handle('secrets:resetCode', (_e, code: string): Res => {
    try {
      if (!CODE_RE.test(String(code))) return fail('六位码必须是 6 位数字')
      if (!safeStorage.isEncryptionAvailable()) return fail('这台机器上系统加密不可用，无法安全存储')
      const s = readStore()
      const salt = crypto.randomBytes(16).toString('hex')
      s.lock = { salt, hash: hashCode(String(code), salt) }
      s.app = app.getName()
      s.platform = process.platform
      writeStore(s) // items 原样写回去，一条没动
      unlockedUntil = Date.now() + IDLE_MS
      failCount = 0
      lockedOutUntil = 0
      scheduleLockNotice()
      console.log(`[secrets] 六位码已重置，${s.items.length} 条密钥保留`)
      return done()
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle('secrets:unlock', (_e, code: string): Res => {
    try {
      const now = Date.now()
      if (now < lockedOutUntil) {
        return fail(`错误次数过多，请 ${Math.ceil((lockedOutUntil - now) / 1000)} 秒后再试`)
      }
      const s = readStore()
      if (!s.lock) return fail('还没设置六位码')
      if (!verifyCode(s, String(code))) {
        failCount++
        if (failCount >= FAIL_THRESHOLD) {
          // 指数退避：5 次后 5 分钟起步，之后每错一次翻倍，上限 1 小时。
          // 让在线猜测不可行（六位码只有 100 万种，不退避的话几小时能试完）
          const n = failCount - FAIL_THRESHOLD
          lockedOutUntil = now + Math.min(60 * 60_000, 5 * 60_000 * Math.pow(2, n))
        }
        return fail('六位码不对')
      }
      failCount = 0
      lockedOutUntil = 0
      unlockedUntil = now + IDLE_MS
      scheduleLockNotice()
      return done()
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  /** 给 secret_check 用。**不要求解锁**（只回布尔，理由见 secretsHas 的注释） */
  ipcMain.handle('secrets:has', (_e, names: string[], ptyId?: string) => {
    const list = Array.isArray(names) ? names.map((n) => String(n)) : []
    return {
      vars: secretsHas(list, ptyId),
      // 告诉 agent 该用哪个组名去 eas-secret run --group
      groups: [...new Set(list.map((n) => groupOf(n)).filter(Boolean))] as string[],
      locked: !isUnlocked()
    }
  })

  ipcMain.handle('secrets:lock', (): SecretsStatus => {
    unlockedUntil = 0
    return status()
  })

  /** 列表**永远不含值**。渲染层拿不到值，只有 secrets:reveal 那一条通道能拿到 */
  ipcMain.handle('secrets:list', (): SecretMeta[] => {
    if (!isUnlocked()) return []
    touch()
    const s = readStore()
    return s.items.map((it) => ({
      id: it.id,
      name: it.name,
      note: it.note,
      // 这一条在这台机器上还解得开吗（跨机器同步/改过 app 名的情况）逐个变量算
      vars: it.vars.map((v) => ({ varName: v.varName, readable: open(v.cipher).ok })),
      autoInject: !!it.autoInject,
      createdAt: it.createdAt,
      lastUsedAt: it.lastUsedAt
    }))
  })

  /**
   * 新增或更新一条（= 一组变量，AK/SK 这类成对凭证放一条里）。
   * 每行的 value 留空 + 带 from = 沿用原来那个变量的密文（改名不丢值）；
   * 新增的行必须给 value。
   */
  /** 用户当场把一组密钥给了某个终端（走 request_secret 时）→ 那个终端才能用 eas-secret 取它。
   *  没有这一步的话，用户刚填的密钥反而是唯一取不到的（新组默认不在任何终端的授权里）。 */
  ipcMain.handle('secrets:grantToPty', (_e, ptyId: string | undefined, group: string) => {
    grantGroupToPty(ptyId, String(group))
  })

  ipcMain.handle('secrets:audit', (): SecretAuditEntry[] => secretAudit())

  /** 这个终端启动时带了哪些变量 —— 终端角标用。**只有名字** */
  ipcMain.handle('secrets:injectedIn', (_e, ptyId: string): string[] => injectedInPty(ptyId))

  ipcMain.handle('secrets:save', (_e, input: SecretSaveInput): Res => {
    try {
      const guard = requireUnlocked()
      if (guard) return fail(guard)
      if (!safeStorage.isEncryptionAvailable()) return fail('这台机器上系统加密不可用，无法安全存储')

      const name = String(input?.name ?? '').trim()
      if (!name) return fail('给它起个名字')

      const rows = Array.isArray(input?.vars) ? input.vars : []
      if (!rows.length) return fail('至少要有一个变量')

      const s = readStore()
      const old = input.id ? s.items.find((x) => x.id === input.id) : undefined
      if (input.id && !old) return fail('这条已经不在了')

      // 别的条目已经占掉的变量名。注入到同一个 env，重名会互相覆盖，所以必须全局唯一
      const taken = new Map<string, string>()
      for (const it of s.items) {
        if (it.id === input.id) continue
        for (const v of it.vars) taken.set(v.varName, it.name)
      }

      const next: StoredVar[] = []
      const seen = new Set<string>()
      for (const row of rows) {
        const varName = String(row?.varName ?? '').trim()
        // 环境变量名的合法字符。不挡的话注入时会拼出一个 shell 认不出的 env
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
          return fail(`「${varName || '空'}」不是合法变量名：只能用字母、数字、下划线，且不能以数字开头`)
        }
        if (seen.has(varName)) return fail(`这一组里 ${varName} 写了两遍`)
        const owner = taken.get(varName)
        if (owner) return fail(`${varName} 已经被「${owner}」占用了`)
        seen.add(varName)

        const value = typeof row.value === 'string' ? row.value : ''
        if (value) {
          next.push({ varName, cipher: seal(value) })
          continue
        }
        // 没给新值 → 沿用旧密文
        const from = typeof row.from === 'string' ? row.from : varName
        const prev = old?.vars.find((v) => v.varName === from)
        if (!prev) return fail(`${varName} 还没有值`)
        next.push({ varName, cipher: prev.cipher })
      }

      if (old) {
        old.name = name
        old.note = input.note?.trim() || undefined
        old.vars = next
        if (typeof input.autoInject === 'boolean') old.autoInject = input.autoInject
      } else {
        s.items.push({
          id: crypto.randomUUID(),
          name,
          note: input.note?.trim() || undefined,
          vars: next,
          autoInject: input.autoInject === true,
          createdAt: Date.now()
        })
      }
      s.app = app.getName()
      s.platform = process.platform
      writeStore(s)
      touch()
      return done()
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle('secrets:remove', (_e, id: string): Res => {
    try {
      const guard = requireUnlocked()
      if (guard) return fail(guard)
      const s = readStore()
      const n = s.items.length
      s.items = s.items.filter((x) => x.id !== id)
      if (s.items.length === n) return fail('这条已经不在了')
      writeStore(s)
      touch()
      return done()
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  /**
   * 唯一能把密钥值交给渲染层的通道 —— 给「查看/复制」用。
   * 单独一条而不是并进 list，是为了让「值离开主进程」这件事在代码里只有一个入口，
   * 将来加审计日志也只用盯这一处。
   */
  ipcMain.handle('secrets:reveal', (_e, id: string, varName?: string): SecretReveal => {
    const guard = requireUnlocked()
    if (guard) return { ok: false, error: guard }
    const s = readStore()
    const it = s.items.find((x) => x.id === id)
    if (!it) return { ok: false, error: '这条已经不在了' }
    // 不传 varName = 整组都要（"复制成 .env"）；传了就只解那一个
    const want = varName ? it.vars.filter((v) => v.varName === varName) : it.vars
    if (!want.length) return { ok: false, error: `这条里没有 ${varName}` }

    const vars: { varName: string; value: string }[] = []
    for (const v of want) {
      const r = open(v.cipher)
      if (!r.ok) {
        return {
          ok: false,
          error:
            r.reason === 'undecryptable'
              ? `${v.varName} 在这台机器上解不开（密钥库可能是从别的机器同步过来的，或者应用改过名字）`
              : `${v.varName} 的密文校验不通过，可能已损坏`
        }
      }
      vars.push({ varName: v.varName, value: r.value })
    }
    touch()
    return { ok: true, vars }
  })
}
