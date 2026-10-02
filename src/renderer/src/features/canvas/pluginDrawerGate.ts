import type { PluginInfo } from '../../../../shared/types.ts'

/** Cards without a runnable, enabled in-app panel remain ordinary market rows. */
export function panelEligible(plugin: PluginInfo): boolean {
  return plugin.cli === 'eas' && plugin.enabled !== false && !!plugin.panels?.length
}

/** 没有面板、但有工具的已启用插件：点卡片 = 新开一个接好它的对话（2026-09-30）。
 *  自家插件要有 mcp 或 remote；Claude / Codex 插件交给它们各自的 CLI（与 Frame 右键「插件」同一份判断）。 */
export function chatEligible(plugin: PluginInfo): boolean {
  if (plugin.enabled === false || panelEligible(plugin)) return false
  return plugin.cli === 'eas' ? !!(plugin.mcp || plugin.remote) : true
}

/** Status returns field IDs only; secret values never enter the renderer. */
export function missingRequiredSecrets(plugin: PluginInfo, configured: readonly string[]): string[] {
  return (plugin.config?.fields ?? [])
    .filter(field => field.required && field.type === 'secret' && !configured.includes(field.id))
    .map(field => field.id)
}
