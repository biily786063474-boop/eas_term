// AI 索要密钥的弹窗（MCP 工具 request_secret 触发）。
//
// **这个组件的全部意义在于「不被 AI 借刀」。** 它显示的文字有一部分是 AI 写的，
// 而它要用户交出的是密钥 —— 这是整个应用里最容易被拿来钓鱼的一块 UI。
// 三条不能动的规矩（见 docs/密钥管理器-设计与可行性.html「两个必须防的坑」）：
//
//   1. 醒目标注**这是 AI 发起的请求**，视觉上和系统提示区分开（橙色警示条 + 图标）。
//   2. AI 给的理由**原样显示**，不润色、不改写、不帮它说得更正当。
//      渲染成纯文本（React 默认转义），绝不 dangerouslySetInnerHTML。
//   3. 名字里出现 password / 验证码 / 身份证 这类词要额外警告 ——
//      正经的 API key 不叫这些名字，AI 张口要这些多半是在骗人。
//
// 还有一条藏在文案里：**永远不要写「AI 看不到你输入的值」以外的承诺**。
// 值确实不回传给 AI，但密钥一旦注入终端，那个终端里跑的 AI `echo $VAR` 就能看见。

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { SecretsStatus } from '../../../../shared/types'
import { KeyIcon, CloseIcon } from '../../ui/Icons'
import {
  currentSecretRequest,
  resolveSecretRequest,
  subscribeSecretRequest
} from './secretRequest'
import './workspace.css'

export interface SecretRequest {
  /** 这一组叫什么（AI 给的，原样显示） */
  name: string
  /** 要哪些环境变量 */
  vars: string[]
  /** AI 说它要来干嘛 —— 原样显示，一个字都不改 */
  purpose: string
  /** 去哪申请（可选，只接受 http/https） */
  docsUrl?: string
}

export interface SecretRequestResult {
  saved: boolean
  /** 用户拒绝时的原因，回给 AI 让它别干等 */
  reason?: string
  vars?: string[]
  autoInject?: boolean
}

/** 这些词出现在变量名或组名里就红牌警告。
 *  正经的 API 凭证不会叫「验证码」，AI 开口要这些基本可以确定是钓鱼。 */
const DANGER = [
  'password',
  'passwd',
  'pwd',
  '密码',
  'otp',
  'mfa',
  '2fa',
  'verify',
  'verification',
  '验证码',
  '短信',
  'sms',
  'cvv',
  'cvc',
  '身份证',
  'idcard',
  'ssn',
  '银行',
  'bank',
  'card',
  '信用卡',
  'seed',
  'mnemonic',
  '助记词',
  'private_key',
  'privatekey',
  '私钥'
]
function dangerHits(req: SecretRequest): string[] {
  const hay = [req.name, ...req.vars].join(' ').toLowerCase()
  return DANGER.filter((d) => hay.includes(d))
}

/** 挂在 App 上的常驻宿主：有 AI 在要密钥时才渲染弹窗 */
export function SecretRequestHost(): JSX.Element | null {
  const req = useSyncExternalStore(subscribeSecretRequest, currentSecretRequest)
  if (!req) return null
  // key：换一个请求就重建，免得上一个请求填了一半的值串到下一个
  return <SecretRequestModal key={req.name + req.vars.join()} req={req} onDone={resolveSecretRequest} />
}

function SecretRequestModal({
  req,
  onDone
}: {
  req: SecretRequest
  onDone: (r: SecretRequestResult) => void
}): JSX.Element | null {
  const [st, setSt] = useState<SecretsStatus | null>(null)
  const [code, setCode] = useState('')
  const [values, setValues] = useState<string[]>(() => req.vars.map(() => ''))
  const [autoInject, setAutoInject] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.secrets.status().then(setSt)
  }, [])

  const danger = dangerHits(req)
  const locked = !!st && (!st.configured || st.locked)

  useEffect(() => {
    if (!locked) firstRef.current?.focus()
  }, [locked, st])

  if (!st) return null

  const unlock = async (): Promise<void> => {
    setErr('')
    const r = st.configured
      ? await window.api.secrets.unlock(code)
      : await window.api.secrets.setup(code)
    setCode('')
    setSt(r.status)
    if (!r.ok) setErr(r.error ?? '出错了')
  }

  const save = async (): Promise<void> => {
    setErr('')
    if (values.some((v) => !v.trim())) {
      setErr('每个变量都要填')
      return
    }
    setBusy(true)
    const r = await window.api.secrets.save({
      name: req.name,
      note: `AI 索要：${req.purpose}`.slice(0, 200),
      autoInject,
      vars: req.vars.map((varName, i) => ({ varName, value: values[i] }))
    })
    setBusy(false)
    if (!r.ok) {
      setErr(r.error ?? '保存失败')
      return
    }
    onDone({ saved: true, vars: req.vars, autoInject })
  }

  return createPortal(
    <div className="sreq-mask">
      <div className="sreq" role="dialog" aria-modal="true">
        {/* 规矩 1：一眼看出这不是系统在问你，是 AI 在问你 */}
        <div className="sreq-flag">
          <KeyIcon size={13} />
          这是 <b>AI 发起</b>的密钥请求，不是 Eas-Term 在向你索要
        </div>

        <div className="sreq-title">{req.name}</div>

        {/* 规矩 2：AI 的原话原样摆着。React 默认转义，不要改成 innerHTML */}
        <div className="sreq-field">
          <span className="sreq-label">AI 说它要来做什么</span>
          <blockquote className="sreq-quote">{req.purpose}</blockquote>
          <span className="sreq-hint">以上是 AI 的原话，未经改写 —— 自己判断合不合理</span>
        </div>

        <div className="sreq-field">
          <span className="sreq-label">会存成这些环境变量</span>
          <div className="sreq-vars">
            {req.vars.map((v) => (
              <code key={v} className="sec-var">
                {v}
              </code>
            ))}
          </div>
        </div>

        {req.docsUrl && (
          <div className="sreq-field">
            <span className="sreq-label">AI 给的申请地址</span>
            <button
              className="sreq-link"
              onClick={() => void window.api.shell.openExternal(req.docsUrl as string)}
            >
              {req.docsUrl}
            </button>
            <span className="sreq-hint">链接也是 AI 给的，点之前看清域名</span>
          </div>
        )}

        {/* 规矩 3：高危名称红牌 */}
        {danger.length > 0 && (
          <div className="sreq-danger">
            <b>停一下。</b>它要的东西名字里带「{danger.join('、')}」
            —— 正经的 API 凭证不叫这些名字。除非你非常清楚在做什么，否则这里该点取消。
          </div>
        )}

        {locked ? (
          <div className="sreq-lock">
            <div className="sreq-label">
              {st.configured ? '先解锁密钥柜' : '先给密钥柜设一个六位码'}
            </div>
            <input
              className="sec-code"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder="······"
              value={code}
              autoFocus
              disabled={!st.available || st.lockedOutMs > 0}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) void unlock()
              }}
            />
            <button
              className="sec-primary"
              disabled={code.length !== 6 || !st.available || st.lockedOutMs > 0}
              onClick={() => void unlock()}
            >
              {st.configured ? '解锁' : '启用密钥柜'}
            </button>
          </div>
        ) : (
          <>
            <div className="sreq-inputs">
              {req.vars.map((v, i) => (
                <label key={v} className="sreq-input-row">
                  <code>{v}</code>
                  <input
                    ref={i === 0 ? firstRef : undefined}
                    className="sec-input mono"
                    type="password"
                    autoComplete="off"
                    placeholder="粘贴进来"
                    value={values[i]}
                    onChange={(e) =>
                      setValues(values.map((x, j) => (i === j ? e.target.value : x)))
                    }
                  />
                </label>
              ))}
            </div>
            <label className="sec-check">
              <input
                type="checkbox"
                checked={autoInject}
                onChange={(e) => setAutoInject(e.target.checked)}
              />
              <span>以后新开的终端自动带上这一组</span>
            </label>
            {/* 这一句是诚实的关键：别让用户以为填完当前终端就能用 */}
            <div className="sreq-hint">
              存进密钥柜，<b>不会发给 AI</b>。当前这个终端拿不到它 ——
              进程的环境变量在启动那一刻就定死了，得开个新终端才带得上。
            </div>
          </>
        )}

        {err && <div className="sec-err">{err}</div>}

        <div className="sreq-acts">
          <button
            className="sec-mini"
            onClick={() => onDone({ saved: false, reason: '用户取消了这次密钥请求' })}
          >
            <CloseIcon size={10} />
            取消
          </button>
          {!locked && (
            <button className="sec-primary sm" disabled={busy} onClick={() => void save()}>
              {busy ? '保存中…' : '存进密钥柜'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
