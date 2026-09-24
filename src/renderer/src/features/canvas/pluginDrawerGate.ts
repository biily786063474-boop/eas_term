import type { PluginInfo } from '../../../../shared/types.ts'

/** Cards without a runnable, enabled in-app panel remain ordinary market rows. */
export function panelEligible(plugin: PluginInfo): boolean {
  return plugin.cli === 'eas' && plugin.enabled !== false && !!plugin.panels?.length
}

/** Status returns field IDs only; secret values never enter the renderer. */
export function missingRequiredSecrets(plugin: PluginInfo, configured: readonly string[]): string[] {
  return (plugin.config?.fields ?? [])
    .filter(field => field.required && field.type === 'secret' && !configured.includes(field.id))
    .map(field => field.id)
}
