// S3（2026-09-14 评审）：wiki:init / wiki:setPath 的根路径门。
// 只接受主进程自己的对话框或默认建议返回过的路径，或 guardDir 允许的目录；
// 渲染层随手传一个绝对路径，不能再让主进程去那里建目录写文件。零 electron。
import fs from 'fs'
import path from 'path'

/** 最深的已存在祖先取 realpath，剩余部分原样接上：目录还没建时记下的路径，建好后（哪怕祖先是符号链接）也能对上。 */
function normalize(p: string): string {
  const abs = path.resolve(p)
  const rest: string[] = []
  let cur = abs
  for (;;) {
    try { return path.join(fs.realpathSync.native ? fs.realpathSync.native(cur) : fs.realpathSync(cur), ...rest) } catch { /* 不存在，往上找 */ }
    const parent = path.dirname(cur)
    if (parent === cur) return abs
    rest.unshift(path.basename(cur))
    cur = parent
  }
}

export function createWikiRootGate(deps: { guardDir: (p: string) => { ok: boolean } }) {
  const picked = new Set<string>()
  return {
    /** 对话框 / 默认建议给出的路径记下来；null（用户取消）忽略。 */
    remember(p: string | null | undefined): void { if (p && path.isAbsolute(p)) picked.add(normalize(p)) },
    allowed(p: string): boolean {
      if (!p || !path.isAbsolute(p)) return false
      const n = normalize(p)
      if (picked.has(n)) return true
      try { return deps.guardDir(n).ok } catch { return false }
    }
  }
}
