// 终端文件链接（Cmd/Ctrl 点击直达）的纯逻辑：候选路径抽取 / 打开路由 / 路径工具。
// 与 xterm 生命周期无关，从 TerminalView 抽出便于单独维护。

import { useStore } from '../../store'

// 能在 App 内预览的扩展名 → 走预览面板（和点文件树一致）；其余文件/文件夹交给系统。
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
const TEXT_EXT =
  /\.(txt|md|markdown|mdx|json|jsonc|ya?ml|toml|ini|conf|cfg|env|xml|html?|css|s[ac]ss|less|js|cjs|mjs|jsx|ts|tsx|c|h|cc|cpp|hpp|cxx|cs|java|kt|kts|go|rs|rb|py|pyw|php|swift|m|mm|sh|bash|zsh|fish|sql|vue|svelte|astro|lua|pl|r|dart|gradle|gitignore|dockerignore|log|csv|tsv)$/i

export function routeOpen(absPath: string, isDir: boolean): void {
  if (isDir) {
    void window.api.fs.openPath(absPath)
  } else if (IMAGE_EXT.test(absPath) || TEXT_EXT.test(absPath)) {
    void useStore.getState().openFile(absPath)
  } else {
    void window.api.fs.openPath(absPath)
  }
}

const LEAD_TRIM = /^[("'`<[{「『]+/
const TAIL_TRIM = /[)"'`>\]}.,;:。、）」』]+$/

// 从一行终端文本里抽出"长得像路径"的候选 token（含起止字符下标，供下划线定位）。
// 真正是否成为链接由主进程 fs.statSync 验证存在性把关，所以这里宁可宽松。
export function extractPathCandidates(
  line: string
): { raw: string; start: number; end: number }[] {
  const out: { raw: string; start: number; end: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) && out.length < 15) {
    let tok = m[0]
    let start = m.index
    let end = start + tok.length
    // http(s) 等网址交给 WebLinksAddon，但保留 file://
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(tok) && !tok.startsWith('file://')) continue
    const lead = tok.match(LEAD_TRIM)
    if (lead) {
      start += lead[0].length
      tok = tok.slice(lead[0].length)
    }
    const tail = tok.match(TAIL_TRIM)
    if (tail) {
      end -= tail[0].length
      tok = tok.slice(0, tok.length - tail[0].length)
    }
    if (!tok) continue
    const pathish =
      tok.startsWith('file://') ||
      tok.startsWith('~') ||
      tok.includes('/') ||
      tok.includes('\\')
    if (!pathish) continue
    out.push({ raw: tok, start, end })
  }

  // 带空格的路径（如 ".../vibe coding/terminal"）会被上面按空白分词拆断；
  // 这里再补一个候选：从行内第一个路径起始符一直取到行尾（去掉尾部空白与标点）。
  // 是否真的存在仍由主进程 statSync 把关，所以放宽点无妨。
  const startRe = /(?:~\/|\.{1,2}\/|\/|[A-Za-z]:\\)/
  const sm = startRe.exec(line)
  if (sm) {
    const start = sm.index
    let seg = line.slice(start).replace(/\s+$/, '')
    const tail = seg.match(TAIL_TRIM)
    if (tail) seg = seg.slice(0, seg.length - tail[0].length)
    const end = start + seg.length
    if (
      seg.length > 1 &&
      (seg.includes('/') || seg.includes('\\')) &&
      !out.some((c) => c.start === start && c.end === end)
    ) {
      out.push({ raw: seg, start, end })
    }
  }

  return out
}

// 鼠标当前悬停命中的路径（由 link provider 的 hover/leave 维护），供右键菜单读取
export interface HoveredPath {
  absPath: string
  isDir: boolean
}

// 路径相对当前活动项目根的展示（复制相对路径用）；不在项目内则原样返回
export function relativeToProject(fullPath: string): string {
  const st = useStore.getState()
  const project = st.projects.find((p) => p.id === st.activeProjectId)
  if (!project) return fullPath
  if (fullPath === project.path) return project.name
  if (fullPath.startsWith(project.path + '/')) return fullPath.slice(project.path.length + 1)
  return fullPath
}

// 把 cd 命令写进指定终端并回车（带空格/特殊字符则单引号包裹，按 POSIX 转义）
export function cdInTerminal(ptyId: string, dir: string): void {
  const q = /[^\w@%+=:,./-]/.test(dir) ? `'${dir.replace(/'/g, `'\\''`)}'` : dir
  window.api.pty.write(ptyId, `cd ${q}\n`)
}

// 取所在文件夹（POSIX 与 Windows 分隔符都处理）
export function dirnameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
}
