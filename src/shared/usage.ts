/** Accounting only: no prompts, tool payloads or native session secrets. */
export interface Meter { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export interface UsageMeta { session: string; project: string; projectName: string; cli: string; model: string }
export interface UsageRow extends UsageMeta {
  id: string; startedAt: number; endedAt?: number
  status: 'running' | 'completed' | 'interrupted'
  meter?: Meter; costUsd?: number; stage?: string
}
export interface UsageSummary {
  rounds: number; known: number; tokens: number; input: number; output: number
  cacheRead: number; cacheWrite: number; cacheKnown: number; cacheWriteKnown: number; costUsd: number; costKnown: number
  interrupted: number; maxTokens: number
}
export interface UsageQuery { from: number; to: number; project?: string; page?: number }
export interface UsageSnapshot {
  summary: UsageSummary
  projects: {path: string; name: string; summary: UsageSummary; trend: (number|null)[]}[]
  cli: {name: string; summary: UsageSummary}[]
  stages: {name: string; summary: UsageSummary}[]
  buckets: {at: number; summary: UsageSummary}[]
  sessions: {id: string; summary: UsageSummary}[]
  rows: UsageRow[]; matched: number; page: number; since: number; retainedFrom: number; error?: string
}
