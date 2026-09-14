// 代码地图上「点文件就打开」的落点判定。纯函数，零 react / store（依赖注入），可单测。
//
// 画布里：在地图所在的**同一 Frame** 开预览节点 —— 复用 openArtifact，同文件不重复开、直接聚焦已有的；
// 分屏里：走既有 tabsSlice.openFile（向右分屏出预览）。
// 图上的 id 是相对项目根、'/' 分隔（codeGraphAnalyze 给的）；root 是项目绝对路径。
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])

/** 归一化相对 id（去掉 . 与 ..）；逃出项目根的返回 null——图上的 `../shared/x.ts` 这类跨包引用不在这个项目里，不开。 */
export function fileAbsPath(root: string, rel: string): string | null {
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel
  const parts: string[] = []
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue }
    parts.push(seg)
  }
  if (!parts.length) return null
  const win = root.includes('\\') && !root.includes('/')
  const sep = win ? '\\' : '/'
  const base = root.replace(/[\\/]+$/, '')
  return base + sep + parts.join(sep)
}

/** 有扩展名才当文件；模块级图（Swift 的 target 之类）的 id 没有扩展名，点了不该去开一个不存在的文件。 */
const looksLikeFile = (rel: string): boolean => /\.[A-Za-z0-9]+$/.test(rel.split('/').pop() ?? '')

export function openGraphFile(root: string, rel: string, deps: {
  frameId?: string
  openArtifact: (frameId: string, pane: { kind: 'code' | 'image'; filePath: string }) => unknown
  openFile: (abs: string) => unknown
}): void {
  if (!looksLikeFile(rel)) return
  const abs = fileAbsPath(root, rel)
  if (!abs) return
  if (deps.frameId) {
    const ext = abs.split('.').pop()?.toLowerCase() ?? ''
    deps.openArtifact(deps.frameId, { kind: IMAGE_EXTS.has(ext) ? 'image' : 'code', filePath: abs })
  } else deps.openFile(abs)
}
