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
// 固定宿主脚本，先于插件脚本注册（插件无法关闭：它的监听都排在这之后）。
// 只发送布尔状态与滚轮数值；不读取插件 DOM、用户输入或凭证，也不扩大 iframe 权限。
//  · Ctrl 修饰键：iframe 获得键盘焦点后，Ctrl keydown 不会冒泡到父窗口，
//    必须把修饰键状态送回宿主，才能让 Ctrl+滚轮缩放画板。
//  · 2026-09-29 用户改规则（插件面板首击直达）：iframe 始终接收指针。
//    pointerdown（capture，不拦面板自己的处理）→ canvas-select，让宿主顺手选中节点；
//    wheel（capture，passive:false）→ 宿主告知「未选中」时 preventDefault 并转发 canvas-wheel，
//    画布照旧平移/缩放；已选中时不拦，面板正常滚动。选中状态由宿主下发 canvas-selected，
//    默认按未选中处理；这条宿主通知在这里吞掉，不交给插件脚本。
//  · 中键（修复轮 1）：画布的中键平移挂在宿主 document 捕获阶段，iframe 会吞掉它。
//    中键按下报 canvas-pan-start（不报 select），按住期间 pointermove 报 canvas-pan-move
//    （带屏幕坐标），松开 / 失焦报 canvas-pan-end；宿主用合成事件复用画布原有的中键平移。
const CANVAS_MODIFIER_BRIDGE = `<script>;(function(){
  var sel=false,pan=false
  function post(m,p){parent.postMessage(p?{jsonrpc:'2.0',method:m,params:p}:{jsonrpc:'2.0',method:m},'*')}
  function send(pressed){post('ui/notifications/canvas-zoom-modifier',{pressed:pressed})}
  addEventListener('keydown',function(e){if(e.key==='Control')send(true)},true)
  addEventListener('keyup',function(e){if(e.key==='Control')send(false)},true)
  function pt(e,b){var p={clientX:e.clientX,clientY:e.clientY,screenX:e.screenX,screenY:e.screenY};if(b)p.buttons=e.buttons;return p}
  function endPan(){if(pan){pan=false;post('ui/notifications/canvas-pan-end')}}
  addEventListener('blur',function(){send(false);endPan()},true)
  addEventListener('message',function(e){var d=e.data;if(e.source!==parent||!d||d.jsonrpc!=='2.0'||d.method!=='ui/notifications/canvas-selected')return;e.stopImmediatePropagation();if(d.params&&typeof d.params.selected==='boolean')sel=d.params.selected},true)
  addEventListener('pointerdown',function(e){if(!e.isTrusted)return;if(e.button===1){pan=true;post('ui/notifications/canvas-pan-start',pt(e))}else post('ui/notifications/canvas-select')},true)
  addEventListener('mousedown',function(e){if(e.isTrusted&&e.button===1)e.preventDefault()},true)
  addEventListener('pointermove',function(e){if(pan&&e.isTrusted)post('ui/notifications/canvas-pan-move',pt(e,1))},true)
  addEventListener('pointerup',function(e){if(e.isTrusted&&e.button===1)endPan()},true)
  addEventListener('wheel',function(e){if(sel||!e.isTrusted)return;e.preventDefault();post('ui/notifications/canvas-wheel',{deltaX:e.deltaX,deltaY:e.deltaY,deltaMode:e.deltaMode,ctrlKey:e.ctrlKey,metaKey:e.metaKey,clientX:e.clientX,clientY:e.clientY})},{capture:true,passive:false})
})()</script>`

function injectCanvasModifierBridge(html: string): string {
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, m => m + CANVAS_MODIFIER_BRIDGE)
  if (/<html(?:\s[^>]*)?>/i.test(html)) return html.replace(/<html(?:\s[^>]*)?>/i, m => m + '<head>' + CANVAS_MODIFIER_BRIDGE + '</head>')
  return html.replace(/^(<!doctype[^>]*>)?/i, m => m + '<head>' + CANVAS_MODIFIER_BRIDGE + '</head>')
}

export function preparePanelHtml(html: string, maxBytes = PANEL_HTML_MAX_BYTES): PreparedHtml {
  if (typeof html !== 'string' || !html.trim()) return { ok: false, why: '面板 HTML 为空' }
  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > maxBytes) return { ok: false, why: `面板 HTML ${Math.round(bytes / 1024)}KB，超过上限 ${Math.round(maxBytes / 1024)}KB` }
  const stripped = META_CSP_RE.test(html)
  const out = injectCanvasModifierBridge(stripped ? html.replace(META_CSP_RE, '') : html)
  if (Buffer.byteLength(out, 'utf8') > maxBytes) return { ok: false, why: '面板 HTML 加入宿主交互桥后超过上限' }
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
