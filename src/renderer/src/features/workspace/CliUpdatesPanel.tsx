import { useEffect, useState } from 'react'
import type { CliUpdateSnapshot, UpdatableCli } from '../../../../shared/cliUpdates'
import { CliBrandIcon } from '../../ui/CliBrandIcon'

const names = { codex: 'Codex', claude: 'Claude Code' }
export function CliUpdatesPanel(): JSX.Element {
  const [rows, setRows] = useState<CliUpdateSnapshot>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<UpdatableCli | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.api.cliUpdates.onChange(s => { if (alive) setRows(s) })
    void window.api.cliUpdates.get().then(s => { if (alive) setRows(s) }).catch(() => { if (alive) setError('无法读取 CLI 更新设置，请重新打开设置。') })
    return () => { alive = false; off() }
  }, [])
  async function action(id: UpdatableCli, run: () => Promise<CliUpdateSnapshot>): Promise<void> {
    setSaving(id); setError('')
    try { setRows(await run()) } catch { setError('设置未保存，请重试。') }
    finally { setSaving(null) }
  }
  return <section className="cset-sec cset-cli-updates" aria-label="CLI 更新">
    <h3>CLI 更新</h3>
    <p className="cset-sub">默认关闭。开启后自动下载稳定版，下次启动软件时生效。更新可能导致部分对话、工具或插件功能不可用。</p>
    {!rows.length && !error && <p className="cset-sub">正在读取版本…</p>}
    {rows.map(row => <div className="cset-cli-update" key={row.id}>
      <div className="cset-row">
        <span className="cset-cli-identity"><CliBrandIcon cliId={row.id} /><span>{names[row.id]}</span></span>
        <label className="cset-cli-toggle"><span>自动更新</span><input type="checkbox" role="switch" aria-label={`${names[row.id]} 自动更新`} checked={row.enabled} disabled={saving !== null} onChange={e => void action(row.id, () => window.api.cliUpdates.setEnabled(row.id, e.target.checked))} /></label>
      </div>
      <div className="cset-cli-version">当前 {row.current || '未检测到可用版本'}{row.pending && <span className="cset-cli-pending">{row.pending} · 重启后生效</span>}</div>
      <div className="cset-sub" role="status">
        {row.phase === 'checking' ? '正在检查官方稳定版…' : row.phase === 'downloading' ? '正在下载并校验，当前对话继续使用原版本…' : row.phase === 'failed' ? row.error : row.pending ? '已准备好。关闭自动更新不会取消这次已完成的更新。' : row.enabled ? '已开启 · 仅在软件运行期间检查更新' : '自动更新已关闭'}
      </div>
      {(row.phase === 'failed' || row.previous) && <div className="cset-cli-actions">
        {row.phase === 'failed' && row.enabled && <button className="cset-trybtn" aria-label={`重试更新 ${names[row.id]}`} disabled={saving !== null} onClick={() => void action(row.id, () => window.api.cliUpdates.retry(row.id))}>↻</button>}
        {row.previous && <button className="cset-trybtn" disabled={saving !== null || !!row.pending} onClick={() => void action(row.id, () => window.api.cliUpdates.rollback(row.id))}>回退至 {row.previous}</button>}
      </div>}
    </div>)}
    <div className="cset-cli-bundled"><CliBrandIcon cliId="omp" bundled /><span>本地 harness</span><span className="cset-sub">随软件版本更新</span></div>
    <p className="cset-sub">应用专用版本不会覆盖系统安装。回退也在重启后生效，并会关闭自动更新。</p>
    {error && <p className="cset-sub" role="alert">{error}</p>}
  </section>
}
