import { VaultGate } from './VaultGate'
import { useT } from '../../i18n.ts'
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
import type { SecretsStatus, SecretMeta } from '../../../../shared/types'
import { KeyIcon, CloseIcon } from '../../ui/Icons'
import {
  currentSecretRequest,
  resolveSecretRequest,
  subscribeSecretRequest
} from './secretRequest'
import './workspace.css'

/** 回给 AI 的取消原因（发给 AI 的文字，不翻） */
const CANCELLED_REASON = '用户取消了这次密钥请求' // i18n-allow: 回给 AI 的文字

export interface SecretRequest {
  /** 这一组叫什么（AI 给的，原样显示） */
  name: string
  /** 要哪些环境变量 */
  vars: string[]
  /** AI 说它要来干嘛 —— 原样显示，一个字都不改。
   *  fix 模式下这里是服务返回的错误原话 */
  purpose: string
  /** 去哪申请（可选，只接受 http/https） */
  docsUrl?: string
  /** 'fix' = AI 用着报错了，请用户改一个。默认是首次索要 */
  mode?: 'ask' | 'fix' | 'unlock'
  /** 请求来自哪个项目（项目名，取自 EAS_PROJECT / 所在 Frame，不是 AI 自报——不可伪造）。 */
  project?: string
  /** 请求来自哪个节点/任务（发起这次请求的画布节点标题）。 */
  origin?: string
}

export interface SecretRequestResult {
  saved: boolean
  /** 用户拒绝时的原因，回给 AI 让它别干等 */
  reason?: string
  /** **只包含真的写成功的变量名。** 别把没写进去的也报上来 */
  vars?: string[]
  autoInject?: boolean
  /** 存进了哪一组 —— 用来授权这个终端能取它 */
  group?: string
  groups?: string[]
}

/** 这些词出现在变量名或组名里就红牌警告。
 *  正经的 API 凭证不会叫「验证码」，AI 开口要这些基本可以确定是钓鱼。 */
const DANGER = [
  'password',
  'passwd',
  'pwd',
  '密码', // i18n-allow: 匹配变量名/组名里的中文关键词，不是界面文案
  'otp',
  'mfa',
  '2fa',
  'verify',
  'verification',
  '验证码', // i18n-allow: 匹配变量名/组名里的中文关键词，不是界面文案
  '短信', // i18n-allow: 匹配变量名/组名里的中文关键词，不是界面文案
  'sms',
  'cvv',
  'cvc',
  '身份证', // i18n-allow: 匹配变量名/组名里的中文关键词，不是界面文案
  'idcard',
  'ssn',
  '银行', // i18n-allow: 匹配变量名/组名里的中文关键词，不是界面文案
  'bank',
  'card',
  '信用卡', // i18n-allow: 匹配变量名/组名里的中文关键词，不是界面文案
  'seed',
  'mnemonic',
  '助记词', // i18n-allow: 匹配变量名/组名里的中文关键词，不是界面文案
  'private_key',
  'privatekey',
  '私钥' // i18n-allow: 匹配变量名/组名里的中文关键词，不是界面文案
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
  return <SecretRequestModal key={req.name + req.vars.join()} req={req} onDone={(result) => resolveSecretRequest(result, req)} />
}

function SecretRequestModal({
  req,
  onDone
}: {
  req: SecretRequest
  onDone: (r: SecretRequestResult) => void
}): JSX.Element | null {
  const tr = useT()
  const [st, setSt] = useState<SecretsStatus | null>(null)
  const [items, setItems] = useState<SecretMeta[] | null>(null)
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
  const fix = req.mode === 'fix'
  const unlockOnly = req.mode === 'unlock'
  const existing = new Set((items ?? []).flatMap(it => it.vars.map(v => v.varName)))

  // 「请求来自」——哪个项目、哪个节点在要。项目名来自 EAS_PROJECT / 所在 Frame（不可伪造），
  // 不是 AI 自报。解锁弹窗信息最少，这块尤其要有，让越权取密钥能被一眼看见。
  const originBlock = (req.project || req.origin) ? (
    <div className="sreq-origin">
      <span className="sreq-origin-label">{tr('settings.secretRequest.from')}</span>
      <span className="sreq-origin-val">
        {req.project ? <b>{req.project}</b> : null}
        {req.project && req.origin ? <span className="sreq-origin-sep"> · </span> : null}
        {req.origin ? <span>{req.origin}</span> : null}
      </span>
    </div>
  ) : null
  const missingVars = req.vars.filter(v => fix || !existing.has(v))
  useEffect(() => {
    if (st && !locked) void window.api.secrets.list().then(setItems)
  }, [locked, st])

  useEffect(() => {
    if (!locked) firstRef.current?.focus()
  }, [locked, st])

  useEffect(() => {
    if (!locked) return
    const timer = window.setInterval(() => { void window.api.secrets.status().then(setSt) }, 1000)
    return () => window.clearInterval(timer)
  }, [locked])

  if (!st) return null

  const save = async (): Promise<void> => {
    setErr('')
    if (missingVars.some(v => !values[req.vars.indexOf(v)].trim())) {
      setErr(tr('settings.secretRequest.error.fillAll'))
      return
    }
    if (!items) return
    if (unlockOnly) { onDone({ saved: true, vars: [] }); return }
    const groups = items.filter(it => it.vars.some(v => req.vars.includes(v.varName))).map(it => it.name)
    if (!fix && !missingVars.length) { onDone({ saved: true, vars: req.vars, groups }); return }
    setBusy(true)
    let input = {
      name: req.name,
      note: tr('settings.secretRequest.note', { purpose: req.purpose }).slice(0, 200),
      autoInject,
      vars: missingVars.map(varName => ({ varName, value: values[req.vars.indexOf(varName)] }))
    } as Parameters<typeof window.api.secrets.save>[0]

    if (fix) {
      // 修正模式必须**改已有那些条**，不能新建 —— 变量名全局唯一，新建会被直接拒掉。
      // 同组里没被点名的变量原样留着（不带 value = 主进程沿用旧密文）。
      const items = await window.api.secrets.list()
      // 这些变量可能分属**多个组**（agent 一次报两个服务的凭证很常见）。
      // 原来用 find 只取第一个 owner，第二组的新值连保存调用都没进，
      // 却照样回报「都更新了」—— 用户以为两把泄露的 key 都轮换了，其实只换了一把。
      const owners = items.filter((it) => it.vars.some((v) => req.vars.includes(v.varName)))
      if (!owners.length) {
        setBusy(false)
        setErr(tr('settings.secretRequest.error.gone'))
        return
      }
      const written: string[] = []
      for (const owner of owners) {
        const r = await window.api.secrets.save({
          id: owner.id,
          name: owner.name, // 名字和自动注入开关都不动，这次只换值
          note: owner.note,
          vars: owner.vars.map((v) => {
            const i = req.vars.indexOf(v.varName)
            return i >= 0
              ? { varName: v.varName, value: values[i], from: v.varName }
              : { varName: v.varName, from: v.varName }
          })
        })
        if (!r.ok) {
          setBusy(false)
          // 回报只认真写成功的那些，别把没写进去的也说成改好了
          setErr(tr('settings.secretRequest.error.groupSaveFailed', { name: owner.name, reason: r.error ?? tr('settings.secretRequest.error.unknown') }))
          if (written.length) onDone({ saved: true, vars: written, groups: owners.filter(it => it.vars.some(v => written.includes(v.varName))).map(it => it.name) })
          return
        }
        setSt(r.status)
        written.push(...owner.vars.filter((v) => req.vars.includes(v.varName)).map((v) => v.varName))
      }
      setBusy(false)
      onDone({ saved: true, vars: written, groups: owners.filter(it => it.vars.some(v => written.includes(v.varName))).map(it => it.name) })
      return
    }

    const r = await window.api.secrets.save(input)
    setBusy(false)
    if (!r.ok) {
      setErr(r.error ?? tr('settings.secrets.error.saveFailed'))
      return
    }
    onDone({ saved: true, vars: req.vars, autoInject, groups: [...groups, req.name] })
  }

  if (locked) return createPortal(
    <div className="vault-backdrop sreq-mask">
      <div className="sreq vault-gate-dialog" role="dialog" aria-modal="true" aria-label={tr('settings.secrets.vault')}>
        <button className="vault-close" aria-label={tr('settings.secretRequest.closeRequest')} onClick={() => onDone({ saved: false, reason: CANCELLED_REASON })}><CloseIcon size={15} /></button>
        {originBlock}
        {req.vars.length > 0 && (
          <div className="sreq-origin-keys">
            <span className="sreq-origin-label">{tr('settings.secretRequest.keysNeeded')}</span>
            <div className="sreq-vars">
              {req.vars.map((v) => <code key={v} className="sec-var">{v}</code>)}
            </div>
          </div>
        )}
        <VaultGate status={st} onUnlocked={status => { setSt(status); if (unlockOnly) onDone({ saved: true, vars: [] }) }} />
        <p className="vault-footnote">{tr('settings.secretRequest.footnote')}</p>
      </div>
    </div>, document.body
  )

  return createPortal(
    <div className="vault-backdrop sreq-mask">
      <div className="sreq" role="dialog" aria-modal="true">
        {/* 规矩 1：一眼看出这不是系统在问你，是 AI 在问你 */}
        <div className="sreq-flag">
          <KeyIcon size={13} />
          {tr('settings.secretRequest.flagA')}<b>{tr('settings.secretRequest.flagB')}</b>{fix ? tr('settings.secretRequest.flagFix') : tr('settings.secretRequest.flagAsk')}{tr('settings.secretRequest.flagEnd')}
        </div>

        {originBlock}

        <div className="sreq-title">
          {fix ? tr('settings.secretRequest.fixTitle', { vars: req.vars.join(tr('settings.secretRequest.sep')) }) : !missingVars.length ? tr('settings.secretRequest.allowSession') : req.name}
        </div>

        {/* 规矩 2：AI 的原话原样摆着。React 默认转义，不要改成 innerHTML */}
        <div className="sreq-field">
          <span className="sreq-label">
            {unlockOnly ? tr('settings.secretRequest.labelUnlock') : fix ? tr('settings.secretRequest.labelFix') : tr('settings.secretRequest.labelAsk')}
          </span>
          <blockquote className="sreq-quote">{req.purpose}</blockquote>
          {!unlockOnly && <span className="sreq-hint">{tr('settings.secretRequest.quoteHint')}</span>}
        </div>

        {fix && (
          <div className="sreq-hint">
            {tr('settings.secretRequest.fixHintA')}<b>{tr('settings.secretRequest.fixHintB')}</b>{tr('settings.secretRequest.fixHintC')}
          </div>
        )}

        {!unlockOnly && <div className="sreq-field">
          <span className="sreq-label">{tr('settings.secretRequest.envVars')}</span>
          <div className="sreq-vars">
            {req.vars.map((v) => (
              <code key={v} className="sec-var">
                {v}
              </code>
            ))}
          </div>
        </div>}

        {req.docsUrl && (
          <div className="sreq-field">
            <span className="sreq-label">{tr('settings.secretRequest.docsUrl')}</span>
            <button
              className="sreq-link"
              onClick={() => void window.api.shell.openExternal(req.docsUrl as string)}
            >
              {req.docsUrl}
            </button>
            <span className="sreq-hint">{tr('settings.secretRequest.docsHint')}</span>
          </div>
        )}

        {/* 规矩 3：高危名称红牌 */}
        {danger.length > 0 && (
          <div className="sreq-danger">
            <b>{tr('settings.secretRequest.dangerA')}</b>{tr('settings.secretRequest.dangerB', { list: danger.join(tr('settings.secretRequest.sep')) })}
          </div>
        )}

          <>
            <div className="sreq-inputs">
              {req.vars.map((v, i) => !fix && existing.has(v) ? <div className="sreq-hint" key={v}><code>{v}</code>{tr('settings.secretRequest.inVault')}</div> : (
                <label key={v} className="sreq-input-row">
                  <code>{v}</code>
                  <input
                    ref={i === 0 ? firstRef : undefined}
                    className="sec-input mono"
                    type="password"
                    autoComplete="off"
                    placeholder={tr('settings.secretRequest.pastePlaceholder')}
                    value={values[i]}
                    onChange={(e) =>
                      setValues(values.map((x, j) => (i === j ? e.target.value : x)))
                    }
                  />
                </label>
              ))}
            </div>
            {!fix && !unlockOnly && missingVars.length > 0 && (
              <label className="sec-check">
                <input
                  type="checkbox"
                  checked={autoInject}
                  onChange={(e) => setAutoInject(e.target.checked)}
                />
                <span>{tr('settings.secretRequest.autoInject')}</span>
              </label>
            )}
            {/* 这一句是诚实的关键：别让用户以为填完当前终端就自动能用 */}
            <div className="sreq-hint">
              {fix ? tr('settings.secretRequest.honestNewValue') : tr('settings.secretRequest.honestStored')}
              <b>{tr('settings.secretRequest.honestB')}</b>{tr('settings.secretRequest.honestC')}<code>eas-secret</code>{tr('settings.secretRequest.honestD')}
            </div>
          </>

        {err && <div className="sec-err">{err}</div>}

        <div className="sreq-acts">
          <button
            className="sec-mini"
            onClick={() => onDone({ saved: false, reason: CANCELLED_REASON })}
          >
            <CloseIcon size={10} />
            {tr('settings.secretRequest.cancel')}
          </button>
          {!locked && (
            <button className="sec-primary sm" disabled={busy || !items} onClick={() => void save()}>
              {busy ? tr('settings.secretRequest.saving') : unlockOnly ? tr('settings.secretRequest.continue') : !missingVars.length ? tr('settings.secretRequest.authorize') : tr('settings.secretRequest.saveAuthorize')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
