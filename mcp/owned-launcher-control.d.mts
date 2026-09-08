import type { ChildProcess } from 'node:child_process'
export function ownCodexLauncher(proc: ChildProcess): void
export function stopAgentProcess(proc: ChildProcess | undefined, signal?: NodeJS.Signals): void
