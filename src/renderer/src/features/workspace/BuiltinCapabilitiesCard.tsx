import { useCallback, useEffect, useRef, useState } from 'react'
import { capabilitySummary } from '../../../../shared/builtinCapabilities'
import { t, useT } from '../../i18n.ts'
import type { CapabilityBundleStatus, CapabilityModule, CapabilityState } from '../../../../shared/builtinCapabilities'

const rows: Array<{ id: CapabilityModule }> = [{ id: 'workbench' }, { id: 'bizone' }, { id: 'guidance' }]
function moduleName(id: CapabilityModule): string {
  return t(`settings.builtin.${id}` as const)
}
function dependencyLabel(dep: CapabilityState['dependency']): string {
  return t(`settings.builtin.dep.${dep}` as const)
}
function summary(id: CapabilityModule, state: CapabilityState): string {
  if (id !== 'guidance' || !state.enabled || state.dependency !== 'available') return capabilitySummary(state)
  if (state.session === 'ready') return t('settings.builtin.sessionReady')
  if (state.session === 'failed') return t('settings.builtin.sessionFailed')
  if (state.session === 'waiting' || state.session === 'reconnecting') return t('settings.builtin.sessionWaiting')
  return t('settings.builtin.sessionNone')
}

/** Mounted only by the visible inline settings panel; no hidden-instance polling. */
export function BuiltinCapabilitiesCard(): JSX.Element {
  const tr = useT()
  const [status, setStatus] = useState<CapabilityBundleStatus | null>(null)
  const [busy, setBusy] = useState<CapabilityModule | 'refresh' | null>(null)
  const [error, setError] = useState('')
  const active = useRef(false)
  const inFlight = useRef(false)
  const generation = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current || !active.current) return
    inFlight.current = true
    const request = ++generation.current
    setBusy('refresh')
    setError('')
    try {
      const next = await window.api.capabilities.status()
      if (!active.current || request !== generation.current) return
      setStatus(next)
      setError(next.error ? tr('settings.builtin.errState') + next.error : '')
    } catch {
      if (active.current && request === generation.current) setError(tr('settings.builtin.errRead'))
    } finally {
      if (active.current && request === generation.current) {
        inFlight.current = false
        setBusy(null)
      }
    }
  }, [])

  useEffect(() => {
    active.current = true
    void refresh()
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      active.current = false
      inFlight.current = false
      generation.current++
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const toggle = async (module: CapabilityModule, enabled: boolean): Promise<void> => {
    if (inFlight.current || !active.current) return
    inFlight.current = true
    const request = ++generation.current
    setBusy(module)
    setError('')
    try {
      const next = await window.api.capabilities.setModule(module, enabled)
      if (!active.current || request !== generation.current) return
      setStatus(next)
      setError(next.error ? tr('settings.builtin.errConfirm') + next.error : next.modules[module].enabled !== enabled ? tr('settings.builtin.errNoEffect') : '')
    } catch {
      if (active.current && request === generation.current) setError(tr('settings.builtin.errSave'))
    } finally {
      if (active.current && request === generation.current) {
        inFlight.current = false
        setBusy(null)
      }
    }
  }

  return (
    <section aria-label={tr('settings.builtin.aria')} aria-busy={busy !== null}>
      <div className="fp-row">
        <div className="fp-row-h">
          <span className="fp-name">{status?.displayName || tr('settings.builtin.defaultName')}</span>
          {status?.version && <span className="fp-tag">v{status.version}</span>}
          <button type="button" className="fp-mini" disabled={busy !== null} onClick={() => void refresh()}>
            {busy === 'refresh' ? tr('settings.builtin.refreshing') : tr('settings.builtin.refresh')}
          </button>
        </div>
        <div className="fp-desc">{tr('settings.builtin.desc')}</div>
        {error && <div className="fp-note" role="alert">{error}</div>}
        {!status && !error && <div className="fp-desc" role="status">{tr('settings.builtin.reading')}</div>}
      </div>
      {status && rows.map(({ id }) => {
        const name = moduleName(id)
        const state = status.modules[id]
        return (
          <div key={id} className={'fp-row' + (state.enabled ? ' on' : '')}>
            <div className="fp-row-h">
              <span className="fp-name">{name}</span>
              <span className={'fp-tag ' + (state.enabled ? 'ok' : 'off')}>{state.enabled ? tr('settings.builtin.enabled') : tr('settings.builtin.disabled')}</span>
              <label className="cset-cli-toggle">
                <span>{busy === id ? tr('settings.builtin.saving') : tr('settings.builtin.enable')}</span>
                <input type="checkbox" role="switch" aria-label={tr('settings.builtin.enableLabel', { name })}
                  checked={state.enabled} disabled={busy !== null || Boolean(status.error)}
                  onChange={event => void toggle(id, event.target.checked)} />
              </label>
            </div>
            <div className="fp-desc">{dependencyLabel(state.dependency)} · {summary(id, state)}</div>
          </div>
        )
      })}
    </section>
  )
}
