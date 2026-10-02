/** 事件与历史文件都视为不可信；入口处再次验证，不依赖 adapter 已过滤。 */
export function externalResourceUrl(uri: string): string | null {
  try {
    const url = new URL(uri)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}
import type { PluginInfo } from '../../../../shared/types.ts'
import { userPanels } from '../../../../shared/pluginPanelSurface.ts'

/** 仅选择本会话插件已经声明的面板；不把工具返回的任意 URI 当作可执行页面。 */
export function resourcePanel(uri: string, pluginId: string | undefined, plugins: PluginInfo[]) {
  if (!uri.startsWith('ui://') || !pluginId) return undefined
  const plugin = plugins.find(p => p.id === pluginId)
  // 隐藏面板（分屏头条）只供宿主按 panelId 嵌入，不从对话里的资源链接单开
  const panel = userPanels(plugin?.panels).find(p => p.entry === uri)
  return plugin && panel ? { plugin, panel } : undefined
}
