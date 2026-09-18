// 插件一键安装的安全纯逻辑。**零 electron,`node --test` 裸跑。**
// 主进程的下载/解压/落盘编排在 plugins.ts;这里只管三条安全判据(每条都可测):
//   1. 写入边界:只许 ~/.eas/plugins/<name>/,name 过 NAME_RE —— 不复用 fsGuard
//      (那个边界是项目根+知识库根;插件装在 home 下的独立目录,是另一条边界)
//   2. zip-slip:每个 zip 条目的解压目标必须仍在插件目录内,穿越即拒整包
//   3. sha256:下载内容与 registry 声明的哈希一致才放行
import path from 'node:path'
import { createHash } from 'node:crypto'

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/   // 同 pluginManifest / pluginRegistry
const SHA256_RE = /^[a-f0-9]{64}$/

export type GuardResult = { ok: true; dir: string } | { ok: false; reason: string }

/** 插件落盘目录:只允许 ~/.eas/plugins/<name>/,name 合法且不含路径分隔。 */
export function guardPluginDir(name: unknown, home: string): GuardResult {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return { ok: false, reason: '插件名非法（小写字母/数字/连字符,1–40 位）' }
  const dir = path.join(home, '.eas', 'plugins', name)
  // 双保险:join 后必须仍在 ~/.eas/plugins 下(NAME_RE 已挡穿越,这里兜底)
  const root = path.join(home, '.eas', 'plugins')
  const rel = path.relative(root, dir)
  if (rel !== name || rel.includes('..') || path.isAbsolute(rel)) return { ok: false, reason: '插件目录越界' }
  return { ok: true, dir }
}

/** zip 条目名 → 解压目标绝对路径,越界(穿越/绝对/软链)返回 null,调用方据此拒整包。 */
export function safeExtractTarget(entryName: string, dest: string): string | null {
  if (typeof entryName !== 'string' || !entryName || path.isAbsolute(entryName)) return null
  const target = path.resolve(dest, entryName)
  const root = path.resolve(dest)
  // target 必须严格在 dest 内(等于 dest 本身也不算文件)
  if (target === root) return null
  const rel = path.relative(root, target)
  if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) return null
  return target
}

/** 下载内容 sha256 与声明一致(大小写不敏感)。声明本身格式错也判 false。 */
export function verifySha256(buf: Buffer, expected: string): boolean {
  const exp = typeof expected === 'string' ? expected.toLowerCase() : ''
  if (!SHA256_RE.test(exp)) return false
  return createHash('sha256').update(buf).digest('hex') === exp
}

/** Freeze the full parsed manifest across the user-confirmation boundary. */
export function packageManifestHash(raw:unknown):string {return createHash('sha256').update(JSON.stringify(raw)).digest('hex')}
