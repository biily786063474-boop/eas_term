// 项目文件夹改名的校验与新路径计算。
//
// **不引 electron**：守卫逻辑错了就是安全问题，必须能被 node --test 直接打到。
// 也**不复用 fsGuard**：那套是「必须在某个项目**内部**」，而这里操作的正是项目根本身。
// fsGuard.ts:86-87 的注释早就写了「改名/删除一个项目根应该走项目管理，不是文件树」——
// 这个文件就是那条路。它的守卫比 fsGuard **更窄**，不是更宽。
import { tm } from '../shared/i18n/current.ts'
import path from 'path'

export interface RenameInput {
  projects: { id: string; name: string; path: string; pastPaths?: string[] }[]
  projectId: string
  newName: string
  /** 知识库路径。它在 wiki.json 里、是另一套配置，不跟着项目改名走，所以要挡住 */
  wikiPath?: string | null
}

export type RenamePlan =
  | { ok: false; error: string }
  | {
      ok: true
      oldPath: string
      newPath: string
      /** 展示名要不要跟着改：用户从没自定义过（name === 旧目录名）才改，
       *  自定义过的不动 —— 那是他特意设的，不能替他丢掉 */
      renameDisplayName: boolean
    }

/** 只允许改最后一段。这些条件各自对应一种真实的坏结果：
 *  斜杠 → 借机移动到别的目录；点开头 → 变成隐藏目录，人在访达里找不到；
 *  控制字符 → 造出打不开的名字；Windows 禁用字符 → Windows 上根本创建不了。 */
function badName(name: string): string | null {
  if (!name || !name.trim()) return tm('errCore.name.empty')
  if (name !== name.trim()) return tm('errCore.name.trimSpaces')
  if (name === '.' || name === '..') return tm('errCore.name.dots')
  if (name.startsWith('.')) return tm('errCore.projectPaths.dotStart')
  if (/[/\\]/.test(name)) return tm('errCore.name.slash')
  if (/[:*?"<>|]/.test(name)) return tm('errCore.name.badChars')
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return tm('errCore.name.invisible')
  if (name.length > 255) return tm('errCore.name.tooLong')
  return null
}

const isInside = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent + path.sep)

/** macOS 与 Windows 的默认卷都是大小写不敏感 + Unicode 规范化不敏感的：
 *  盘上 café(NFC) 和 café(NFD)、Bar 和 bar 是同一个目录。
 *  裸字符串比较会放行一个必然在 fs.rename 时才失败的操作 ——
 *  而这个模块存在的意义就是在动盘之前把它拦下来。 */
const sameOnDisk = (a: string, b: string): boolean =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()

export function planRename(input: RenameInput): RenamePlan {
  const { projects, projectId, newName, wikiPath } = input
  const p = projects.find((x) => x.id === projectId)
  if (!p) return { ok: false, error: tm('errCore.projectPaths.notFound') }

  const bad = badName(newName)
  if (bad) return { ok: false, error: bad }

  const oldPath = p.path
  const parent = path.dirname(oldPath)
  const newPath = path.join(parent, newName)

  if (newPath === oldPath) return { ok: false, error: tm('errCore.projectPaths.sameName') }
  // path.join 会把 'a/../b' 这类归一化掉，所以这条是最后一道防线：
  // 归一化之后仍然必须是同一个父目录下的直接子项
  if (path.dirname(newPath) !== parent) return { ok: false, error: tm('errCore.projectPaths.renameOnly') }

  if (wikiPath && isInside(wikiPath, oldPath)) {
    return {
      ok: false,
      error: tm('errCore.projectPaths.hasWiki')
    }
  }

  if (projects.some((x) => x.id !== projectId && sameOnDisk(x.path, newPath))) {
    return { ok: false, error: tm('errCore.projectPaths.pathTaken') }
  }

  return {
    ok: true,
    oldPath,
    newPath,
    renameDisplayName: p.name === path.basename(oldPath)
  }
}
