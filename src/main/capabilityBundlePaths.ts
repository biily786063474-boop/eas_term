import path from 'node:path'
/** Only trusted application resource paths are passed here, never a plugin-supplied root. */
export function capabilityBundleRoot(host: { isPackaged: boolean; resourcesPath: string; appPath: string }): string {
  return host.isPackaged ? path.join(host.resourcesPath, 'plugins', 'eas-capabilities') : path.join(host.appPath, 'resources', 'plugins', 'eas-capabilities')
}
export function capabilityGuidanceDir(host: Parameters<typeof capabilityBundleRoot>[0]): string {
  return path.join(capabilityBundleRoot(host), 'guidance')
}
