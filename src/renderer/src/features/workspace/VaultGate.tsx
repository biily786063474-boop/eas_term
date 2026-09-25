import { useEffect, useId, useRef, useState } from 'react'
import type { SecretsStatus } from '../../../../shared/types'
import { LockIcon } from '../../ui/Icons'

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
    if (!st.configured && code !== first) { setError('两次数字码不一致，请再试一次'); setCode(''); input.current?.focus(); return }
    pending.current = true
    setBusy(true)
    try {
      const r = st.configured ? await window.api.secrets.unlock(code, remember) : await window.api.secrets.setup(code, remember)
      if (!mounted.current) return
      setSt(r.status)
      if (r.ok) { setFirst(''); setCode(''); onUnlocked(r.status) }
      else { setError(r.error ?? '未能解锁，请重试'); setCode('') }
    } catch { if (mounted.current) setError('连接失败，请重试') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const confirming = !st.configured && step === 'confirm'
  return <div className="vault-gate">
    <div className="vault-emblem"><LockIcon size={21} /></div>
    <h2>{st.configured ? '解锁密钥柜' : confirming ? '确认六位数字码' : '设置密钥柜'}</h2>
    <p className="vault-lead">{st.configured ? '输入六位数字码，继续刚才的操作。' : confirming ? '再输入一次，确认你的数字码。' : '保存一次密钥，之后按需授权使用。'}</p>
    <label className="vault-code-label" htmlFor={codeId}>{confirming ? '再次输入六位数字码' : st.configured ? '六位数字码' : '创建六位数字码'}</label>
    <div className="vault-code-field">
      <div className="vault-digit-row" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i}>{i < code.length ? '●' : '·'}</span>)}</div>
      <input ref={input} id={codeId} aria-label={confirming ? '再次输入六位数字码' : '六位数字码'} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={code} disabled={busy || !st.available || st.lockedOutMs > 0} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter') void submit() }} />
    </div>
    {!st.available && <p role="alert" className="sec-err">系统加密不可用，暂时不能启用密钥柜。</p>}
    {st.lockedOutMs > 0 && <p role="status" className="sec-err">请等待 {Math.ceil(st.lockedOutMs / 1000)} 秒后再试</p>}
    {error && <p role="alert" className="sec-err">{error}</p>}
    <label className="vault-trust-option"><input type="checkbox" checked={remember} disabled={busy || !st.available} onChange={e => setRemember(e.target.checked)} /><span>信任此设备，以后免输六位码<small>仅适合私人电脑；密钥仍由系统安全存储加密。手动锁定会撤销此选择。</small></span></label>
    <button className="vault-primary" disabled={busy || code.length !== 6 || !st.available || st.lockedOutMs > 0} onClick={() => void submit()}>{busy ? '处理中…' : st.configured ? '解锁并继续' : confirming ? '启用密钥柜' : '继续'}</button>
    {confirming && <button className="vault-secondary" disabled={busy} onClick={() => { setStep('create'); setFirst(''); setCode(''); setError('') }}>返回</button>}
    {!st.configured && !confirming && <span
      className="vault-help"
      tabIndex={0}
      data-tip={'密钥只存本机，由系统安全存储保护。\n使用前按会话授权，解锁不等于全部授权。\n六位码仅用于日常解锁，不参与密钥加密。'}
    >密钥如何保护？</span>}
  </div>
}
