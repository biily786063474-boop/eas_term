import { useEffect, useState } from 'react'
import type { CliUpdateSnapshot, UpdatableCli } from '../../../../shared/cliUpdates'
import { useT } from '../../i18n.ts'
import { CliBrandIcon } from '../../ui/CliBrandIcon'

const names = { codex: 'Codex', claude: 'Claude Code' }
export function CliUpdatesPanel(): JSX.Element {
  const tr = useT()
  const [rows, setRows] = useState<CliUpdateSnapshot>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<UpdatableCli | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.api.cliUpdates.onChange(s => { if (alive) setRows(s) })
    void window.api.cliUpdates.get().then(s => { if (alive) setRows(s) }).catch(() => { if (alive) setError(tr('settings.cliUpdates.errRead')) })
    return () => { alive = false; off() }
  }, [])
  async function action(id: UpdatableCli, run: () => Promise<CliUpdateSnapshot>): Promise<void> {
    setSaving(id); setError('')
    try { setRows(await run()) } catch { setError(tr('settings.cliUpdates.errSave')) }
    finally { setSaving(null) }
  }
  return <section className="cset-sec cset-cli-updates" aria-label={tr('settings.cliUpdates.title')}>
    <h3>{tr('settings.cliUpdates.title')}</h3>
    <p className="cset-sub">{tr('settings.cliUpdates.intro')}</p>
    {!rows.length && !error && <p className="cset-sub">{tr('settings.cliUpdates.reading')}</p>}
    {rows.map(row => <div className="cset-cli-update" key={row.id}>
      <div className="cset-row">
        <span className="cset-cli-identity"><CliBrandIcon cliId={row.id} /><span>{names[row.id]}</span></span>
        <label className="cset-cli-toggle"><span>{tr('settings.cliUpdates.auto')}</span><input type="checkbox" role="switch" aria-label={tr('settings.cliUpdates.autoLabel', { name: names[row.id] })} checked={row.enabled} disabled={saving !== null} onChange={e => void action(row.id, () => window.api.cliUpdates.setEnabled(row.id, e.target.checked))} /></label>
      </div>
      <div className="cset-cli-version">{tr('settings.cliUpdates.current')}{row.current || tr('settings.cliUpdates.noVersion')}{row.pending && <span className="cset-cli-pending">{tr('settings.cliUpdates.pending', { version: row.pending })}</span>}</div>
      <div className="cset-sub" role="status">
        {row.phase === 'checking' ? tr('settings.cliUpdates.checking') : row.phase === 'downloading' ? tr('settings.cliUpdates.downloading') : row.phase === 'failed' ? row.error : row.pending ? tr('settings.cliUpdates.ready') : row.enabled ? tr('settings.cliUpdates.onStatus') : tr('settings.cliUpdates.offStatus')}
      </div>
      {(row.phase === 'failed' || row.previous) && <div className="cset-cli-actions">
        {row.phase === 'failed' && row.enabled && <button className="cset-trybtn" aria-label={tr('settings.cliUpdates.retryLabel', { name: names[row.id] })} disabled={saving !== null} onClick={() => void action(row.id, () => window.api.cliUpdates.retry(row.id))}>↻</button>}
        {row.previous && <button className="cset-trybtn" disabled={saving !== null || !!row.pending} onClick={() => void action(row.id, () => window.api.cliUpdates.rollback(row.id))}>{tr('settings.cliUpdates.rollback', { version: row.previous })}</button>}
      </div>}
    </div>)}
    <div className="cset-cli-bundled"><CliBrandIcon cliId="omp" bundled /><span>{tr('settings.cliUpdates.harness')}</span><span className="cset-sub">{tr('settings.cliUpdates.bundled')}</span></div>
    <p className="cset-sub">{tr('settings.cliUpdates.footnote')}</p>
    {error && <p className="cset-sub" role="alert">{error}</p>}
  </section>
}
