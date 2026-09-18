export interface PluginRequirements {
  minHostVersion?: string
  platforms?: string[]
  architectures?: string[]
  capabilities?: string[]
}
export interface PluginHostCapabilities {
  version: string
  platform: string
  architecture: string
  capabilities: readonly string[]
}
