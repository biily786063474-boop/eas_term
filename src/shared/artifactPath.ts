/** Pure path handling for renderer-side artifact selection (Node path is unavailable there). */
type Platform = string

function normalizedAbsolute(input: string, platform: Platform): string {
  // POSIX permits backslashes in a filename; only Windows treats them as separators.
  const slash = platform === 'win32' ? input.replace(/\\/g, '/') : input
  let root: string
  let rest: string
  if (slash.startsWith('//')) {
    const parts = slash.slice(2).split('/')
    const server = parts.shift()
    const share = parts.shift()
    if (!server || !share) throw new Error('无效的网络共享路径')
    root = `//${server}/${share}`
    rest = parts.join('/')
  } else if (/^[A-Za-z]:\//.test(slash)) {
    root = slash.slice(0, 2)
    rest = slash.slice(3)
  } else if (slash.startsWith('/')) {
    root = '/'
    rest = slash.slice(1)
  } else {
    throw new Error('只接受绝对路径')
  }
  const segments: string[] = []
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return root === '/' ? '/' + segments.join('/') : root + '/' + segments.join('/')
}

function within(target: string, root: string, platform: Platform): boolean {
  const windows = platform === 'win32'
  const candidate = windows ? target.toLowerCase() : target
  const allowed = windows ? root.toLowerCase() : root
  const prefix = allowed.endsWith('/') ? allowed : allowed + '/'
  return candidate === allowed || candidate.startsWith(prefix)
}

/** Keep the existing caller-project/Frame-project allowance, but handle native Windows paths. */
export function safeArtifactPath(input: string, projectPath: string, ctxProject?: string, platform: Platform = 'darwin'): string {
  const base = ctxProject || projectPath
  if (!input) throw new Error('路径为空')
  const normalizedInput = platform === 'win32' ? input.replace(/\\/g, '/') : input
  if (/^[A-Za-z]:(?!\/)/.test(normalizedInput)) throw new Error('不支持盘符相对路径')
  const absolute = normalizedInput.startsWith('/') || /^[A-Za-z]:\//.test(normalizedInput)
  if (!absolute && !base) throw new Error('相对路径需要项目上下文')
  const target = normalizedAbsolute(absolute ? normalizedInput : normalizedAbsolute(base, platform) + '/' + normalizedInput, platform)
  const allows = [...new Set([ctxProject, projectPath].filter(Boolean).map(root => normalizedAbsolute(root!, platform)))]
  if (!allows.some(root => within(target, root, platform))) throw new Error(`路径越界，只允许项目目录内：${allows.join(' 或 ') || '(未知项目)'}`)
  return target
}

const encodeSegments = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

export function artifactFileUrl(filePath: string, platform: Platform = 'darwin'): string {
  const normalized = normalizedAbsolute(filePath, platform)
  if (normalized.startsWith('//')) {
    const [server, ...parts] = normalized.slice(2).split('/')
    return `file://${server}/${encodeSegments(parts.join('/'))}`
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    const drive = normalized.slice(0, 2)
    return `file:///${drive}/${encodeSegments(normalized.slice(3))}`
  }
  return 'file://' + encodeSegments(normalized)
}

export function artifactPathFromFileUrl(url: string, platform: Platform = 'darwin'): string {
  const parsed = new URL(url)
  if (parsed.protocol !== 'file:' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('仅能选择本地文件')
  const pathname = decodeURIComponent(parsed.pathname)
  if (parsed.host && parsed.host !== 'localhost') return `//${parsed.host}${pathname}`
  return platform === 'win32' && /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname
}
