import { useCallback, useEffect, useRef, useState } from 'react'
import { capabilitySummary } from '../../../../shared/builtinCapabilities'
import type { CapabilityBundleStatus, CapabilityModule, CapabilityState } from '../../../../shared/builtinCapabilities'

const rows: Array<{ id: CapabilityModule; name: string }> = [
  { id: 'workbench', name: '工作台' },
  { id: 'bizone', name: '笔纵画板' },
  { id: 'guidance', name: '使用指引' }
]
const dependencies: Record<CapabilityState['dependency'], string> = {
  available: '依赖可用', missing: '依赖未安装', unauthenticated: '需要登录', unavailable: '依赖服务不可用'
}
function summary(id: CapabilityModule, state: CapabilityState): string {
  if (id !== 'guidance' || !state.enabled || state.dependency !== 'available') return capabilitySummary(state)
  if (state.session === 'ready') return '已随会话注入'
  if (state.session === 'failed') return '会话指引注入失败'
  if (state.session === 'waiting' || state.session === 'reconnecting') return '等待会话指引注入'
  return '随会话注入 · 尚未注入'
}

/** Mounted only by the visible inline settings panel; no hidden-instance polling. */
export function BuiltinCapabilitiesCard(): JSX.Element {
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
      setError(next.error ? '内置能力状态异常：' + next.error : '')
    } catch {
      if (active.current && request === generation.current) setError('无法读取内置能力状态，请刷新重试。')
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
      setError(next.error ? '设置未能确认：' + next.error : next.modules[module].enabled !== enabled ? '设置未生效，请刷新后重试。' : '')
    } catch {
      if (active.current && request === generation.current) setError('未能确认设置已保存，请刷新后重试。')
    } finally {
      if (active.current && request === generation.current) {
        inFlight.current = false
        setBusy(null)
      }
    }
  }

  return (
    <section aria-label="随包内置能力" aria-busy={busy !== null}>
      <div className="fp-row">
        <div className="fp-row-h">
          <span className="fp-name">{status?.displayName || '内置能力插件'}</span>
          {status?.version && <span className="fp-tag">v{status.version}</span>}
          <button type="button" className="fp-mini" disabled={busy !== null} onClick={() => void refresh()}>
            {busy === 'refresh' ? '刷新中…' : '刷新'}
          </button>
        </div>
        <div className="fp-desc">分别控制工作台、笔纵连接和会话指引；业务插件保持独立。</div>
        {error && <div className="fp-note" role="alert">{error}</div>}
        {!status && !error && <div className="fp-desc" role="status">正在读取能力状态…</div>}
      </div>
      {status && rows.map(({ id, name }) => {
        const state = status.modules[id]
        return (
          <div key={id} className={'fp-row' + (state.enabled ? ' on' : '')}>
            <div className="fp-row-h">
              <span className="fp-name">{name}</span>
              <span className={'fp-tag ' + (state.enabled ? 'ok' : 'off')}>{state.enabled ? '已启用' : '已禁用'}</span>
              <label className="cset-cli-toggle">
                <span>{busy === id ? '保存中…' : '启用'}</span>
                <input type="checkbox" role="switch" aria-label={'启用' + name}
                  checked={state.enabled} disabled={busy !== null || Boolean(status.error)}
                  onChange={event => void toggle(id, event.target.checked)} />
              </label>
            </div>
            <div className="fp-desc">{dependencies[state.dependency]} · {summary(id, state)}</div>
          </div>
        )
      })}
    </section>
  )
}
