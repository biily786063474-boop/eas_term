// Skill 面板的**写边界**：复制 skill、以及编辑 skill 文件时，允许动哪些路径。
//
// ── 为什么这里要自己写一层校验，而不是套 fsGuard ──────────────────────────
// fsGuard.ts 的边界是「项目根 + 知识库根」，而 skill 目录（`~/.claude/skills`、
// `~/.claude/design-skills`…）正好全在那之外——这正是本面板存在的意义。
// 但**不能因此就没有边界**：渲染进程会被网页内容影响（画布里的 webview 开任意网址、
// MCP 桥接外部 agent），fsGuard 文件头写的那条威胁模型对这个模块同样成立。
// 所以这里给出本模块自己的、更窄的边界：
//
//   **允许写的根 = 面板里已经登记的 skill 目录 ∪ 已注册项目的 `<项目>/.claude/skills`**
//
// 两者都是用户自己在界面上点出来的位置（内置那几个是他机器上实测存在的 skill 目录，
// 自定义目录是他自己选的，项目根是他自己添加的项目），写它们里面的东西属于本来的意图。
// 其它任何位置一律拒绝——home、系统目录、别的项目的兄弟目录，全部不行。
//
// 边界比 fsGuard 更窄的地方：这里还要求**落点必须是某个 skill 子目录之内**，
// 不能直接往 skill 根目录里扔文件（`<root>/<skill名>/...` 至少两层），
// 也不能改 skill 根本身。
//
// 第一半的 index.ts 文件头写过「这个文件绝不写用户的 skill 目录」——那句话对**只读**
// 那部分仍然成立，但整个模块已经不再是只读的了，那段论证不适用于写操作，
// 所以写操作的边界论证在这儿单独给一份。
import fs from 'fs'
import path from 'path'

/** 把一个路径规范化成用于比对的形式：去掉结尾斜杠。调用方应先 realpath 过。 */
function norm(p: string): string {
  return p.replace(/\/+$/, '')
}

/**
 * target 落在哪个根之内（含根本身）？返回命中的那个根，没命中返回 null。
 *
 * 用「路径段」比对而不是字符串 startsWith：`/a/skills-backup` 不能因为
 * 前缀像 `/a/skills` 就被判成在它里面。
 * 传进来的两边都应该是 realpath 过的绝对路径（symlink 会让任何字符串比对形同虚设，
 * 解析工作在 index.ts 里用 fsGuard 的 realResolve 做——那是既有实现，不重复造）。
 */
export function insideRoot(target: string, roots: readonly string[]): string | null {
  const t = norm(target)
  for (const r of roots) {
    const root = norm(r)
    if (!root) continue
    if (t === root || t.startsWith(root + '/')) return root
  }
  return null
}

export type CopyPlan =
  | { ok: true; dest: string; name: string }
  | { ok: false; error: string; duplicate?: boolean }

/**
 * 「把 srcReal 这个 skill 复制进 destDirReal」这条请求站不站得住脚。
 *
 * 纯函数：所有需要摸盘的事实（源是不是 skill、目标已经存在没有）由调用方查好传进来，
 * 这样重名判定、边界判定这些真正容易写错的规则能被单测覆盖。
 *
 * **重名一律拒绝**（design 文档 §六 第 4 条，用户拍板过）：
 * 不覆盖——skill 目录里可能是用户自己改过的版本，静默覆盖会丢东西；
 * 不自动改名——目录会慢慢积出 `xxx-2`/`xxx-3`，而 CLI 会把它们当成不同 skill 全部加载。
 */
export function planCopySkill(input: {
  /** 源 skill 目录（realpath 后的绝对路径） */
  srcReal: string
  /** 源目录里有没有 SKILL.md——没有就不是一个 skill，不给复制 */
  srcHasSkillMd: boolean
  /** 目标 skill 目录（realpath 后的绝对路径） */
  destDirReal: string
  /** 允许写的根（realpath 后） */
  roots: readonly string[]
  /** 落点 `<destDirReal>/<源目录名>` 现在是否已经存在（文件或目录都算） */
  destExists: boolean
}): CopyPlan {
  const { srcReal, srcHasSkillMd, destDirReal, roots, destExists } = input
  if (!srcReal || !path.isAbsolute(srcReal)) return { ok: false, error: '源路径不对' }
  if (!destDirReal || !path.isAbsolute(destDirReal)) return { ok: false, error: '目标目录不对' }
  if (!srcHasSkillMd) return { ok: false, error: '源目录里没有 SKILL.md，它不是一个 skill' }

  // 源也要在边界内：面板里能右键的 skill 本来就来自登记过的目录，
  // 但这条 IPC 不该假设调用方一定是面板（渲染层可能被外部内容影响）
  if (!insideRoot(srcReal, roots)) {
    return { ok: false, error: '源 skill 不在任何一个已登记的 skill 目录里' }
  }
  // 目标必须**恰好是**某个已登记的 skill 目录，不能是它下面的任意子目录：
  // 「粘贴到某个目录」这件事的语义就是「成为那个目录下的一个 skill」，
  // 允许往 `<root>/a/b/` 里塞会造出 CLI 根本扫不到的嵌套 skill。
  if (!roots.some((r) => norm(r) === norm(destDirReal))) {
    return { ok: false, error: '目标不是一个已登记的 skill 目录' }
  }

  const name = path.basename(srcReal)
  if (!name || name === '.' || name === '..') return { ok: false, error: '源目录名不对' }
  const dest = path.join(destDirReal, name)
  if (norm(dest) === norm(srcReal)) return { ok: false, error: '这就是它自己所在的目录' }
  if (destExists) {
    return { ok: false, error: `那个目录里已经有一个叫「${name}」的了，没有复制`, duplicate: true }
  }
  return { ok: true, dest, name }
}

export type FileWritePlan = { ok: true; path: string } | { ok: false; error: string }

/**
 * 「往 fileReal 写内容」这条请求站不站得住脚（画布上编辑 skill 文件那条路）。
 *
 * 比复制更严：
 * - 必须在某个根的**某个 skill 子目录**之内（`<root>/<skill>/…`，至少两层），
 *   不能直接写根目录下的散文件，更不能写根本身
 * - 必须是**已经存在的普通文件**——这条口子只用来「改已经在那儿的文件」，
 *   不负责新建，也不碰目录。想新建文件走复制或用户自己在访达里做。
 */
export function planWriteSkillFile(input: {
  fileReal: string
  roots: readonly string[]
  /** 这个路径现在是不是一个已存在的普通文件 */
  isExistingFile: boolean
}): FileWritePlan {
  const { fileReal, roots, isExistingFile } = input
  if (!fileReal || !path.isAbsolute(fileReal)) return { ok: false, error: '路径不对' }
  const root = insideRoot(fileReal, roots)
  if (!root) return { ok: false, error: '这个文件不在任何一个已登记的 skill 目录里，不给写' }
  const rel = norm(fileReal).slice(norm(root).length + 1)
  if (rel.split('/').filter(Boolean).length < 2) {
    return { ok: false, error: 'skill 目录本身和它下面的散文件不给改，只能改某个 skill 里的文件' }
  }
  if (!isExistingFile) return { ok: false, error: '这个文件不存在（这条口子只改已有文件，不新建）' }
  return { ok: true, path: fileReal }
}

/**
 * 递归复制一个目录。**先拷到同级临时名，成功后再改名**——
 * 拷到一半失败（磁盘满、权限、文件被占）时，落点上不会留下半个残缺的 skill 目录：
 * CLI 扫到一个只有半截文件的 skill 会当成正常 skill 加载，那比复制失败本身糟得多。
 *
 * 不用 fs.cpSync 的 recursive（Node 16.7+ 才有、且行为随版本变过）——
 * 这段逻辑要在用户机器上跑几年，自己走一遍 readdir 更可控，顺带能明确处理符号链接：
 * **链接按链接原样复制**，不跟随。跟随的话，一个指向 home 的软链会把整个 home 拷进去。
 */
export function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(s), d)
    } else if (ent.isDirectory()) {
      copyDirRecursive(s, d)
    } else if (ent.isFile()) {
      fs.copyFileSync(s, d)
    }
    // 其余类型（socket/fifo/设备）不该出现在 skill 目录里，跳过
  }
}

/**
 * 真正落盘的复制：临时名 → 改名，失败清理临时目录。
 * 临时名带进程 pid + 时间戳，且以 `.` 开头——scanSkillDir 跳过点开头的条目，
 * 所以万一清理也失败（比如断电），面板下次也不会把它当成一个 skill 显示出来。
 */
export function copySkillDir(src: string, dest: string): { ok: true } | { ok: false; error: string } {
  const tmp = path.join(path.dirname(dest), `.eas-copying-${process.pid}-${Date.now()}`)
  try {
    copyDirRecursive(src, tmp)
    // rename 之前再确认一次落点还没被别人占上（从校验到这里之间可能有人建了同名目录）
    if (fs.existsSync(dest)) {
      fs.rmSync(tmp, { recursive: true, force: true })
      return { ok: false, error: `那个目录里已经有一个叫「${path.basename(dest)}」的了，没有复制` }
    }
    fs.renameSync(tmp, dest)
    return { ok: true }
  } catch (e) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      // 清理都失败了也别再抛——原始错误更重要，而且临时名是点开头的，不会被当成 skill
    }
    return { ok: false, error: (e as Error).message || '复制失败' }
  }
}
