import { useEffect, useId, useRef, useState } from 'react'
import type { SecretsStatus } from '../../../../shared/types'
import { LockIcon } from '../../ui/Icons'
// 用不订阅语言的 t（不是 useT）：这个组件的单测用假 hooks 跑，且门禁弹窗存活期间不会切语言
import { t } from '../../i18n.ts'
// 文案键 settings.vault.help / helpTip

/** 建柜和日常解锁的唯一输入面。码只留组件内存，卸载即丢弃。 */
export function VaultGate({ status, onUnlocked }: { status: SecretsStatus; onUnlocked: (status: SecretsStatus) => void }): JSX.Element {
  const codeId = useId()
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [st, setSt] = useState(status)
  const [step, setStep] = useState<'create' | 'confirm'>('create')
  const [first, setFirst] = useState('')
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [step])
  useEffect(() => {
    const timer = window.setInterval(() => { void window.api.secrets.status().then(setSt) }, 1000)
    return () => window.clearInterval(timer)
  }, [])
  const submit = async (): Promise<void> => {
    if (pending.current || busy || code.length !== 6 || !st.available || st.lockedOutMs > 0) return
    setError('')
    if (!st.configured && step === 'create') { setFirst(code); setCode(''); setStep('confirm'); return }
    if (!st.configured && code !== first) { setError(t('settings.vault.mismatch')); setCode(''); input.current?.focus(); return }
    pending.current = true
    setBusy(true)
    try {
      const r = st.configured ? await window.api.secrets.unlock(code, remember) : await window.api.secrets.setup(code, remember)
      if (!mounted.current) return
      setSt(r.status)
      if (r.ok) { setFirst(''); setCode(''); onUnlocked(r.status) }
      else { setError(r.error ?? t('settings.vault.unlockFailed')); setCode('') }
    } catch { if (mounted.current) setError(t('settings.vault.connFailed')) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const confirming = !st.configured && step === 'confirm'
  return <div className="vault-gate">
    <div className="vault-emblem"><LockIcon size={21} /></div>
    <h2>{st.configured ? t('settings.vault.titleUnlock') : confirming ? t('settings.vault.titleConfirm') : t('settings.vault.titleSetup')}</h2>
    <p className="vault-lead">{st.configured ? t('settings.vault.leadUnlock') : confirming ? t('settings.vault.leadConfirm') : t('settings.vault.leadSetup')}</p>
    <label className="vault-code-label" htmlFor={codeId}>{confirming ? t('settings.vault.labelConfirm') : st.configured ? t('settings.vault.labelCode') : t('settings.vault.labelCreate')}</label>
    <div className="vault-code-field">
      <div className="vault-digit-row" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i}>{i < code.length ? '●' : '·'}</span>)}</div>
      <input ref={input} id={codeId} aria-label={confirming ? t('settings.vault.labelConfirm') : t('settings.vault.labelCode')} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={code} disabled={busy || !st.available || st.lockedOutMs > 0} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter') void submit() }} />
    </div>
    {!st.available && <p role="alert" className="sec-err">{t('settings.vault.unavailable')}</p>}
    {st.lockedOutMs > 0 && <p role="status" className="sec-err">{t('settings.vault.wait', { sec: Math.ceil(st.lockedOutMs / 1000) })}</p>}
    {error && <p role="alert" className="sec-err">{error}</p>}
    <label className="vault-trust-option"><input type="checkbox" checked={remember} disabled={busy || !st.available} onChange={e => setRemember(e.target.checked)} /><span>{t('settings.vault.trust')}<small>{t('settings.vault.trustHint')}</small></span></label>
    <button className="vault-primary" disabled={busy || code.length !== 6 || !st.available || st.lockedOutMs > 0} onClick={() => void submit()}>{busy ? t('settings.vault.busy') : st.configured ? t('settings.vault.unlockContinue') : confirming ? t('settings.vault.enable') : t('settings.vault.continue')}</button>
    {confirming && <button className="vault-secondary" disabled={busy} onClick={() => { setStep('create'); setFirst(''); setCode(''); setError('') }}>{t('settings.vault.back')}</button>}
    {!st.configured && !confirming && <span
      className="vault-help"
      tabIndex={0}
      data-tip={t('settings.vault.helpTip')}
    >{t('settings.vault.help')}</span>}
  </div>
}
