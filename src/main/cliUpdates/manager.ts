// 应用专用 CLI 版本：下载只写 pending，只有下一次 boot 能改变 active。
// 固定 userData 子目录；IPC 不接受路径、包名、URL 或命令。
import fs from 'node:fs'
import path from 'node:path'
import type { CliUpdateRow, UpdatableCli } from '../../shared/cliUpdates.ts'

export const CLI_IDS: UpdatableCli[] = ['codex', 'claude']
export const validVersion = (v: unknown): v is string => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)
export function newer(a: string, b?: string): boolean {
  if (!validVersion(a)) return false
  if (!validVersion(b)) return true
  const av = a.split('.').map(Number), bv = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i]
  return false
}
type Saved = Pick<CliUpdateRow, 'enabled' | 'pending' | 'previous'> & { active?: string }
interface Dependencies {
  latest(id: UpdatableCli, signal: AbortSignal): Promise<string>
  stage(id: UpdatableCli, version: string, signal: AbortSignal): Promise<void>
  verify(id: UpdatableCli, version: string): string // 仅返回固定版本目录中的已验证可执行文件
  systemVersion(id: UpdatableCli): Promise<string | undefined>
  changed(): void
}
export class CliUpdateManager {
  private saved: Record<UpdatableCli, Saved> = { codex: { enabled: false }, claude: { enabled: false } }
  private rows: Record<UpdatableCli, CliUpdateRow> = {
    codex: { id: 'codex', enabled: false, phase: 'idle' },
    claude: { id: 'claude', enabled: false, phase: 'idle' }
  }
  private jobs = new Map<UpdatableCli, AbortController>()
  private file: string
  private deps: Dependencies
  constructor(root: string, deps: Dependencies) {
    this.file = path.join(root, 'state.json')
    this.deps = deps
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      for (const id of CLI_IDS) {
        const v = raw?.[id]
        this.saved[id] = { enabled: v?.enabled === true }
        for (const k of ['active', 'pending', 'previous'] as const) {
          if (validVersion(v?.[k])) this.saved[id][k] = v[k]
        }
      }
    } catch { /* 首启/坏文件始终默认关闭 */ }
  }
  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.saved, null, 2), { mode: 0o600 })
    fs.renameSync(`${this.file}.tmp`, this.file)
  }
  snapshot(): CliUpdateRow[] { return CLI_IDS.map(id => ({ ...this.rows[id] })) }
  // 同一软件进程只调用一次；之后 setEnabled/check/rollback 均不会替换运行入口。
  boot(): string[] {
    const bins: string[] = []
    for (const id of CLI_IDS) {
      const s = this.saved[id]
      let error: string | undefined
      if (s.pending) {
        try {
          this.deps.verify(id, s.pending)
          s.previous = s.active
          s.active = s.pending
        } catch { error = '新版本启动校验失败，继续使用原版本。' }
        delete s.pending
      }
      let activeBin: string | undefined
      if (s.active) {
        try { activeBin = this.deps.verify(id, s.active) }
        catch {
          error = '托管版本不可用，已回退到可用的旧版本或系统 CLI。'
          s.active = s.previous
          delete s.previous
          try { if (s.active) activeBin = this.deps.verify(id, s.active) } catch { delete s.active }
        }
      }
      if (activeBin) bins.push(path.dirname(activeBin))
      this.rows[id] = { id, enabled: s.enabled, current: s.active, previous: s.previous, phase: error ? 'failed' : 'idle', error }
    }
    this.persist()
    return bins
  }
  async refreshVersions(): Promise<void> {
    await Promise.all(CLI_IDS.map(async id => {
      if (!this.rows[id].current) this.rows[id].current = await this.deps.systemVersion(id)
    }))
    this.deps.changed()
  }
  setEnabled(id: UpdatableCli, enabled: boolean): void {
    const old = this.saved[id].enabled
    this.saved[id].enabled = enabled
    try { this.persist() } catch (e) { this.saved[id].enabled = old; throw e }
    this.rows[id].enabled = enabled
    if (!enabled) {
      this.jobs.get(id)?.abort()
      this.jobs.delete(id)
      this.rows[id].phase = this.saved[id].pending ? 'ready' : 'idle'
      delete this.rows[id].error
    }
    this.deps.changed()
  }
  async check(id: UpdatableCli): Promise<void> {
    if (!this.saved[id].enabled || this.saved[id].pending || this.jobs.has(id)) return
    const job = new AbortController()
    this.jobs.set(id, job)
    const alive = (): boolean => this.jobs.get(id) === job && !job.signal.aborted
    const row = this.rows[id]
    row.phase = 'checking'; delete row.error; this.deps.changed()
    try {
      const current = row.current ?? await this.deps.systemVersion(id)
      if (!alive()) return
      row.current = current
      // 更新不替代首次安装引导。
      if (!current) throw new Error('尚未安装此 CLI，请先在启动页完成安装。')
      const version = await this.deps.latest(id, job.signal)
      if (!alive()) return
      if (!newer(version, current)) { row.phase = 'idle'; return }
      row.phase = 'downloading'; this.deps.changed()
      await this.deps.stage(id, version, job.signal)
      if (!alive()) return
      this.saved[id].pending = version
      try { this.persist() } catch (e) { delete this.saved[id].pending; throw e }
      row.pending = version; row.phase = 'ready'
    } catch (e) {
      if (alive()) {
        row.phase = 'failed'
        row.error = e instanceof Error && /abort|timeout/i.test(e.name + e.message)
          ? '更新超时，继续使用当前版本。网络恢复后可重试。'
          : e instanceof Error ? e.message : '更新失败，继续使用当前版本。'
      }
    } finally {
      if (alive()) { this.jobs.delete(id); this.deps.changed() }
    }
  }
  rollback(id: UpdatableCli): void {
    const s = this.saved[id]
    if (!s.previous) return
    this.deps.verify(id, s.previous)
    const old = { ...s }
    s.pending = s.previous; s.enabled = false
    try { this.persist() } catch (e) { this.saved[id] = old; throw e }
    this.jobs.get(id)?.abort(); this.jobs.delete(id)
    Object.assign(this.rows[id], { enabled: false, pending: s.pending, phase: 'ready', error: undefined })
    this.deps.changed()
  }
  stop(): void { for (const job of this.jobs.values()) job.abort(); this.jobs.clear() }
}
