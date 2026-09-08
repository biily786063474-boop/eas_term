/** Read-only validation for the narrow canvas image insertion capability. */
import fs from 'node:fs/promises'
import path from 'node:path'
type Guard = (value: unknown) => { ok: boolean; path?: string; error?: string }
const formats: Record<string, (bytes: Buffer) => boolean> = {
  '.png': b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  '.jpg': b => b[0] === 255 && b[1] === 216 && b[2] === 255,
  '.jpeg': b => b[0] === 255 && b[1] === 216 && b[2] === 255,
  '.gif': b => ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)),
  '.webp': b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  '.bmp': b => b.toString('ascii', 0, 2) === 'BM',
  '.ico': b => b.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])),
  '.avif': b => b.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(b.toString('ascii', 8, 12))
}
export async function validateRasterImage(input: unknown, roots: unknown, guards: { path: Guard; directory: Guard }): Promise<{ path: string }> {
  if (typeof input !== 'string' || !input || /^(?:[a-z]+:\/\/|\\\\|\/\/)/i.test(input)) throw new Error('只接受项目内本地光栅图片')
  if (!Array.isArray(roots) || !roots.length || roots.some(root => typeof root !== 'string' || !path.isAbsolute(root) || root.startsWith('//') || root.startsWith(String.fromCharCode(92, 92)))) throw new Error('图片需要有效项目上下文')
  const candidate = path.isAbsolute(input) ? input : path.resolve(roots[0], input)
  const check = formats[path.extname(candidate).toLowerCase()]
  if (!check) throw new Error('只支持 PNG/JPEG/GIF/WebP/BMP/ICO/AVIF；不接受 HTML、SVG 或视频')
  const checked = guards.path(candidate)
  if (!checked.ok || !checked.path) throw new Error(checked.error ?? '图片路径越界')
  const allowed: string[] = []
  for (const root of roots) {
    const checkedRoot = guards.directory(root)
    if (checkedRoot.ok && checkedRoot.path) allowed.push(await fs.realpath(checkedRoot.path))
  }
  const real = await fs.realpath(checked.path)
  if (real.startsWith('//') || real.startsWith(String.fromCharCode(92, 92))) throw new Error('不支持网络共享图片')
  if (!allowed.some(root => real.startsWith(root + path.sep))) throw new Error('图片真实路径不在当前会话项目内')
  const file = await fs.open(real, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('图片不是普通文件或超过 50MB')
    const bytes = Buffer.alloc(16)
    await file.read(bytes, 0, 16, 0)
    if (!check(bytes)) throw new Error('图片内容与格式不符')
  } finally { await file.close() }
  return { path: real }
}
