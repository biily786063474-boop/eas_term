// 插件面板协议里**主进程与渲染层都要用**的常量。只放这一处，两边 import。
// 设计稿：docs/superpowers/specs/2026-09-05-插件面板宿主-design.md §B
//
// 方法名以 @modelcontextprotocol/ext-apps **1.7.5**（2026-07-23）为准，2026-09-05 逐个核对过：
// 协议版本 2026-01-26；工具上的 UI 指针在 `_meta["ui/resourceUri"]`；HTML 资源
// mimeType 是 `text/html;profile=mcp-app`。规范再变只改这个文件。

export const APPS_PROTOCOL_VERSION = '2026-01-26'
export const RESOURCE_URI_META_KEY = 'ui/resourceUri'
export const PANEL_HTML_MIME = 'text/html;profile=mcp-app'

/** 面板 → 宿主 的请求（要回响应） */
export const VIEW_REQUESTS = [
  'ui/initialize',
  'ping',
  'tools/call',
  'resources/read',
  'ui/open-link',
  'ui/message',
  'ui/update-model-context',
  'ui/request-display-mode',
  // ── Eas-Term 扩展（别的宿主不认就回 -32601，面板要能承受）──
  'eas/canvas.call',
  'eas/panel.resize'
] as const
/** 面板 → 宿主 的通知（不回） */
export const VIEW_NOTIFICATIONS = ['ui/notifications/initialized', 'ui/notifications/size-changed'] as const
/** 宿主 → 面板 */
export const HOST_TO_VIEW = [
  'ui/notifications/tool-input',
  'ui/notifications/tool-input-partial',
  'ui/notifications/tool-result',
  'ui/notifications/tool-cancelled',
  'ui/notifications/host-context-changed',
  'ui/resource-teardown'
] as const

/** `eas/canvas.call` 宿主侧的全局允许集。清单里的 `permissions.canvas` 再和它取交集。
 *  **这四个都是 mcpHandler 里已有的工具**，透传时走同一执行体与路径白名单，不新增能力。 */
export const CANVAS_CALL_ALLOWLIST = ['canvas_open_file', 'canvas_open_url', 'canvas_add_note', 'canvas_focus_node'] as const

/** 面板 HTML 上限。SVG 那边是 8000 字符；面板是完整应用，放宽到 512KB */
export const PANEL_HTML_MAX_BYTES = 512 * 1024

/** 面板节点尺寸夹在这个范围 */
export const PANEL_SIZE_MIN = 240
export const PANEL_SIZE_MAX = 1200

export const JSONRPC_METHOD_NOT_FOUND = -32601
export const JSONRPC_INVALID_PARAMS = -32602
export const JSONRPC_INTERNAL = -32603
