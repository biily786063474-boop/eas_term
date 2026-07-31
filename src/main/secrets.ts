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
import { app, ipcMain, safeStorage } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import type { SecretMeta, SecretsStatus } from '../shared/types'

// 库文件放 userData 而不是 ~/.eas：
//  · userData 的父目录天然 0700（~/.eas 实测是 0755，世界可读）
//  · Windows 上主密钥就在同目录的 `Local State`，两半放一起，备份/迁移不会只带走一个
//  · 语义上也更对 —— ~/.eas 是「用户可以自己去改」的区（词典、角色），密钥库不是
const storeFile = (): string => path.join(app.getPath('userData'), 'secrets.json')

const VERSION = 1
/** 六位码：纯数字六位 */
const CODE_RE = /^\d{6}$/
/** 解锁后多久无操作自动上锁 */
const IDLE_MS = 15 * 60 * 1000
/** 连续错几次开始退避 */
const FAIL_THRESHOLD = 5

interface StoredItem {
  id: string
  name: string
  varName: string
  note?: string
  /** safeStorage 密文的 base64。明文是 sealed（见 seal），不是裸的密钥值 */
  cipher: string
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
      version: typeof raw.version === 'number' ? raw.version : VERSION,
      app: typeof raw.app === 'string' ? raw.app : app.getName(),
      platform: typeof raw.platform === 'string' ? raw.platform : process.platform,
      lock:
        raw.lock && typeof raw.lock.salt === 'string' && typeof raw.lock.hash === 'string'
          ? { salt: raw.lock.salt, hash: raw.lock.hash }
          : undefined,
      // 逐条挑，坏的那条丢掉而不是整份打不开（同 roles.ts / canvasSlice 的 sanitize 思路）
      items: Array.isArray(raw.items)
        ? raw.items.filter(
            (x): x is StoredItem =>
              !!x &&
              typeof x.id === 'string' &&
              typeof x.name === 'string' &&
              typeof x.varName === 'string' &&
              typeof x.cipher === 'string'
          )
        : []
    }
  } catch {
    return emptyStore() // 第一次用，或者文件坏了
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
 *  为什么不直接加密裸值：safeStorage 在 macOS 用的是 AES-CBC，没有认证标签，
 *  密文被改动后有约 1/256 的概率通过 padding 校验、静默解出一段乱码。
 *  多存一个 sha256，解出来对不上就知道这份密文已经不可信。 */
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
/** 每次成功操作都续期：15 分钟指的是「无操作」而不是「解锁后」 */
const touch = (): void => {
  if (isUnlocked()) unlockedUntil = Date.now() + IDLE_MS
}

// ── 注入：给 pty.ts 用 ──────────────────────────────────────────────

/**
 * 按变量名取出要注入终端的密钥。**值在主进程内解密后直接进 env，从不回传渲染层。**
 *
 * 这条路和 mcpBridge 的 EAS_TERM_TOKEN 完全一样 —— 那个 token 也是只存在于主进程、
 * 只经 PTY env 下发，从没穿过渲染层，更没进过对话。
 *
 * 注意：**不要求解锁态**。理由是终端可能在解锁超时之后才被创建（比如恢复画布时批量重开），
 * 而用户在勾选那些密钥的时候已经解锁过一次、也已经表达过意图了。
 * 真正的门在「勾选」那一步，不在「spawn」这一步。
 */
export function secretsEnv(names?: string[]): Record<string, string> {
  if (!names?.length) return {}
  if (!app.isReady()) return {} // 兜底，正常不会走到
  const s = readStore()
  const out: Record<string, string> = {}
  let used = false
  for (const it of s.items) {
    if (!names.includes(it.varName)) continue
    const r = open(it.cipher)
    if (!r.ok) {
      console.error(`[secrets] ${it.varName} 解不开（${r.reason}），跳过注入`)
      continue
    }
    out[it.varName] = r.value
    it.lastUsedAt = Date.now()
    used = true
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
      return done()
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
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
      varName: it.varName,
      note: it.note,
      createdAt: it.createdAt,
      lastUsedAt: it.lastUsedAt,
      // 这一条在这台机器上还解得开吗（跨机器同步/改过 app 名的情况）
      readable: open(it.cipher).ok
    }))
  })

  /** 新增或更新一条。value 传空字符串 = 只改元数据不动密钥值 */
  ipcMain.handle(
    'secrets:save',
    (_e, input: { id?: string; name: string; varName: string; note?: string; value?: string }): Res => {
      try {
        const guard = requireUnlocked()
        if (guard) return fail(guard)
        if (!safeStorage.isEncryptionAvailable()) return fail('这台机器上系统加密不可用，无法安全存储')

        const name = String(input?.name ?? '').trim()
        const varName = String(input?.varName ?? '').trim()
        if (!name) return fail('给它起个名字')
        // 环境变量名的合法字符。不挡的话注入时会拼出一个 shell 认不出的 env
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
          return fail('变量名只能用字母、数字、下划线，且不能以数字开头')
        }
        const s = readStore()
        if (s.items.some((x) => x.varName === varName && x.id !== input.id)) {
          return fail(`已经有一条在用 ${varName} 了`)
        }

        const value = typeof input.value === 'string' ? input.value : ''
        if (input.id) {
          const it = s.items.find((x) => x.id === input.id)
          if (!it) return fail('这条已经不在了')
          it.name = name
          it.varName = varName
          it.note = input.note?.trim() || undefined
          if (value) it.cipher = seal(value) // 空 = 不改值
        } else {
          if (!value) return fail('密钥值不能为空')
          s.items.push({
            id: crypto.randomUUID(),
            name,
            varName,
            note: input.note?.trim() || undefined,
            cipher: seal(value),
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
    }
  )

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
  ipcMain.handle(
    'secrets:reveal',
    (_e, id: string): { ok: boolean; value?: string; error?: string } => {
      const guard = requireUnlocked()
      if (guard) return { ok: false, error: guard }
      const s = readStore()
      const it = s.items.find((x) => x.id === id)
      if (!it) return { ok: false, error: '这条已经不在了' }
      const r = open(it.cipher)
      if (!r.ok) {
        return {
          ok: false,
          error:
            r.reason === 'undecryptable'
              ? '这台机器上解不开（密钥库可能是从别的机器同步过来的，或者应用改过名字）'
              : '这条密文校验不通过，可能已损坏'
        }
      }
      touch()
      return { ok: true, value: r.value }
    }
  )
}
