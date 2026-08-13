// 文件写操作的路径边界。
//
// 为什么需要它：渲染进程能被网页内容影响（画布里的 <webview> 开任意网址、file:// 预览、
// MCP 桥接外部 agent），而 fs:rename / fs:trash 原来对路径零校验 —— 一句
// `window.api.fs.trash('/Users/xxx')` 就能把整个 home 扔进废纸篓。加「新建/移动/复制」
// 只会把这个面扩大，所以先立边界再加能力。
//
// 边界取「用户已经明确声明过的工作区」：项目列表里的每个项目根 + 知识库根。
// 这两处都是用户自己在界面上选的目录，写它们里面的东西属于本来的意图；
// 其它任何位置一律拒绝 —— 包括用户 home、系统目录、以及别的项目的兄弟目录。
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { wikiPath } from './wiki/paths'

interface StoredProject {
  path?: string
}

/** 直接读 projects.json 而不是从 projects.ts 导入：
 *  守卫必须在任何时候都能独立算出边界，不依赖别处的模块初始化顺序。 */
function projectRoots(): string[] {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'projects.json'), 'utf8')
    const list = JSON.parse(raw) as StoredProject[]
    if (!Array.isArray(list)) return []
    return list.map((p) => p?.path).filter((p): p is string => typeof p === 'string' && !!p)
  } catch {
    return []
  }
}

/** symlink 会让「字符串前缀比对」形同虚设（项目里放一个指向 / 的软链就绕过了），
 *  所以必须解析到真实路径再比。目标可能还不存在（新建文件/目录的场景），
 *  这时退到「最深的那个真实存在的祖先」做 realpath，再把剩下的段落拼回去。 */
export function realResolve(target: string): string {
  const abs = path.resolve(target) // 顺手把 . 和 .. 规范掉
  let cur = abs
  const tail: string[] = []
  for (;;) {
    try {
      return tail.length ? path.join(fs.realpathSync(cur), ...tail) : fs.realpathSync(cur)
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return abs // 一路到根都不存在，原样返回（随后会被拒）
      tail.unshift(path.basename(cur))
      cur = parent
    }
  }
}

/** 名称校验：这些字符/形态会让 path.join 跑到意料之外的地方，或者产生打不开的文件。
 *  `..` 是重点 —— 原来的 /[/\\:]/ 挡不住它，一个 `..` 就能让重命名把文件搬到父目录。 */
export function invalidNameReason(name: string): string | null {
  if (!name || !name.trim()) return '名称不能为空'
  if (name !== name.trim()) return '名称首尾不能有空格'
  if (name === '.' || name === '..') return '名称不能是 . 或 ..'
  if (/[/\\]/.test(name)) return '名称不能包含斜杠'
  if (/[:*?"<>|]/.test(name)) return '名称不能包含 : * ? " < > |'
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return '名称含不可见字符'
  if (name.length > 255) return '名称太长'
  return null
}

export interface GuardOk {
  ok: true
  /** 解析后的真实绝对路径 —— 后续操作一律用这个，不要再用调用方传进来的原始字符串 */
  path: string
}
export interface GuardFail {
  ok: false
  error: string
}

/** 校验一个路径是否落在允许写的范围内。返回解析后的真实路径。 */
export function guardPath(target: unknown): GuardOk | GuardFail {
  if (typeof target !== 'string' || !target) return { ok: false, error: '路径为空' }
  if (!path.isAbsolute(target)) return { ok: false, error: '只接受绝对路径' }
  const roots = [...projectRoots(), wikiPath()].filter((r): r is string => !!r).map(realResolve)
  if (!roots.length) {
    return { ok: false, error: '还没有任何项目或知识库，没有可以写入的位置' }
  }
  const real = realResolve(target)
  for (const root of roots) {
    // 根目录本身也不许动（改名/删除一个项目根应该走项目管理，不是文件树）
    if (real === root) return { ok: false, error: '这是项目或知识库的根目录，不能在文件树里改动它' }
    if (real.startsWith(root + path.sep)) return { ok: true, path: real }
  }
  return { ok: false, error: '路径不在任何项目或知识库目录内，出于安全不允许操作' }
}

/** 目录版：和 guardPath 一样，但允许命中根目录本身
 *  （在项目根里新建文件是正常操作，只是不许改动根自己）。 */
export function guardDir(target: unknown): GuardOk | GuardFail {
  if (typeof target !== 'string' || !target) return { ok: false, error: '路径为空' }
  if (!path.isAbsolute(target)) return { ok: false, error: '只接受绝对路径' }
  const roots = [...projectRoots(), wikiPath()].filter((r): r is string => !!r).map(realResolve)
  if (!roots.length) {
    return { ok: false, error: '还没有任何项目或知识库，没有可以写入的位置' }
  }
  const real = realResolve(target)
  for (const root of roots) {
    if (real === root || real.startsWith(root + path.sep)) return { ok: true, path: real }
  }
  return { ok: false, error: '路径不在任何项目或知识库目录内，出于安全不允许操作' }
}
