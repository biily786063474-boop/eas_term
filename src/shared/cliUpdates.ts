export type UpdatableCli = 'codex' | 'claude'
export interface CliUpdateRow {
  id: UpdatableCli
  enabled: boolean
  current?: string
  pending?: string
  previous?: string
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'failed'
  error?: string
}
export type CliUpdateSnapshot = CliUpdateRow[]
