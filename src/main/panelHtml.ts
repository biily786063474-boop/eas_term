// 插件面板 HTML 进渲染层之前的最后一道检查。**纯函数。**
//
// 2026-09-05 核对：渲染层 CSP 是 `script-src 'self'`，而 srcdoc / blob / data 文档
// **继承父页 CSP**，内联脚本必死。所以面板走自定义协议 `eas-plugin://<panelSession>/`，
// CSP 用**响应头**下发（不往 HTML 里注 meta——头比 meta 强，且不会和插件自己的 meta 取交集）。
// HTML 里若自带 CSP meta，**剥掉**：两条 CSP 取交集会把插件自己允许的东西也掐掉，行为难查。
import { PANEL_HTML_MAX_BYTES } from '../shared/pluginProtocol.ts'

export type PreparedHtml = { ok: true; html: string; headers: Record<string, string>; stripped: boolean } | { ok: false; why: string }

/** 面板的 CSP：不许外连、不许再嵌 frame、不许表单提交；脚本/样式只能内联。 */
export const PANEL_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

const META_CSP_RE = /<meta\s+[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi

export function preparePanelHtml(html: string, maxBytes = PANEL_HTML_MAX_BYTES): PreparedHtml {
  if (typeof html !== 'string' || !html.trim()) return { ok: false, why: '面板 HTML 为空' }
  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > maxBytes) return { ok: false, why: `面板 HTML ${Math.round(bytes / 1024)}KB，超过上限 ${Math.round(maxBytes / 1024)}KB` }
  const stripped = META_CSP_RE.test(html)
  const out = stripped ? html.replace(META_CSP_RE, '') : html
  return {
    ok: true,
    html: out,
    stripped,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': PANEL_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    }
  }
}
