// 主窗口（带 preload 的那个）只允许应用内导航：开发服务器同源，或 renderer 目录下的 file 页面。
// 其余 URL（拖进来的链接、window.open）一律不在主窗口里打开——否则远程页面拿到 window.api。零 electron。
import path from 'node:path'

export function isAppNavigation(url: string, env: { devUrl?: string; rendererDir: string }): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (env.devUrl) {
    try { const dev = new URL(env.devUrl); if (u.origin === dev.origin && u.protocol === dev.protocol) return true } catch { /* 无效 dev 地址就不认 */ }
  }
  if (u.protocol !== 'file:') return false
  const file = path.resolve(decodeURIComponent(u.pathname))
  const dir = path.resolve(env.rendererDir)
  return file === path.join(dir, 'index.html') || file.startsWith(dir + path.sep)
}
