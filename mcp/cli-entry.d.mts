export interface CliInvocation { command: string; args: string[]; env?: Record<string, string> }
export function resolveCliInvocation(kind: string, binary: string, args: string[], env: NodeJS.ProcessEnv, runner: CliInvocation, platform?: NodeJS.Platform): CliInvocation
export function resolveCapabilityCli(kind: string, env: NodeJS.ProcessEnv, platform?: NodeJS.Platform, probe?: (path: string) => string | undefined): string
export function resolveNpmEntry(kind: string, shim: string, arch?: string): { script?: string; command?: string; args?: string[]; env?: Record<string,string> }
