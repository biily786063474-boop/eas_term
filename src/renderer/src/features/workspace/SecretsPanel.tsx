// 密钥柜：标题栏的钥匙按钮 + 弹层。
//
// **文案红线**（见 docs/密钥管理器-设计与可行性.html）：
// 这里绝不能出现「AI 读不到」「对 AI 不可见」这类说法 —— 那是做不到的
// （密钥注入终端后，在那个终端里跑命令的 AI `echo $KEY` 就能看见）。
// 能承诺的、也是这个功能真正解决的问题是：**密钥不会出现在对话里，也不会上传**。
// 一句话写歪，整个功能的诚信就没了。
//
// 值永远不显示：列表只有名字和变量名，要看值得单独点「查看」（走 secrets:reveal，
// 那是唯一能把值交到渲染层的通道）。

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SecretMeta, SecretsStatus } from '../../../../shared/types'
import { KeyIcon, LockIcon, PencilIcon, TrashIcon, CopyIcon, PlusIcon, CloseIcon } from '../../ui/Icons'
import './workspace.css'

interface Draft {
  id?: string
  name: string
  varName: string
  note: string
  value: string
  autoInject: boolean
}
const emptyDraft = (): Draft => ({
  name: '',
  varName: '',
  note: '',
  value: '',
  autoInject: true // 新加的多半就是要用的，默认开省一步；不想要的当场关掉就行
})

export function SecretsPanel(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState<SecretsStatus | null>(null)
  const [items, setItems] = useState<SecretMeta[]>([])
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const s = await window.api.secrets.status()
    setSt(s)
    setItems(s.locked ? [] : await window.api.secrets.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 打开时刷一次：解锁态可能已经因为超时掉了
  useEffect(() => {
    if (open) void refresh()
    else {
      setCode('')
      setErr('')
      setDraft(null)
      setRevealed(null)
    }
  }, [open, refresh])

  // 点外面关闭。用 mousedown 且不带 capture，按钮和弹层各排除一次 —— 和
  // FootprintPanel / McpIndicator 一字不差的同一段，别改成 click
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  if (!st) return null

  const autoCount = items.filter((x) => x.autoInject).length

  const submitCode = async (): Promise<void> => {
    setErr('')
    const r = st.configured
      ? await window.api.secrets.unlock(code)
      : await window.api.secrets.setup(code)
    setCode('')
    if (!r.ok) {
      setErr(r.error ?? '出错了')
      setSt(r.status)
      return
    }
    setSt(r.status)
    setItems(await window.api.secrets.list())
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    setErr('')
    const r = await window.api.secrets.save({
      id: draft.id,
      name: draft.name,
      varName: draft.varName,
      note: draft.note || undefined,
      value: draft.value,
      autoInject: draft.autoInject
    })
    if (!r.ok) {
      setErr(r.error ?? '保存失败')
      return
    }
    setSt(r.status)
    setItems(await window.api.secrets.list())
    setDraft(null)
  }

  /** 直接在列表上切「自动注入」，不用进编辑态。value 传空 = 不动已存的密钥值 */
  const toggleAuto = async (it: SecretMeta): Promise<void> => {
    setErr('')
    const r = await window.api.secrets.save({
      id: it.id,
      name: it.name,
      varName: it.varName,
      note: it.note,
      autoInject: !it.autoInject
    })
    if (!r.ok) {
      setErr(r.error ?? '改不动')
      return
    }
    setSt(r.status)
    setItems(await window.api.secrets.list())
  }

  const removeOne = async (it: SecretMeta): Promise<void> => {
    setErr('')
    const r = await window.api.secrets.remove(it.id)
    if (!r.ok) {
      setErr(r.error ?? '删除失败')
      return
    }
    setSt(r.status)
    setItems(await window.api.secrets.list())
  }

  const reveal = async (it: SecretMeta): Promise<void> => {
    setErr('')
    if (revealed?.id === it.id) {
      setRevealed(null)
      return
    }
    const r = await window.api.secrets.reveal(it.id)
    if (!r.ok || r.value === undefined) {
      setErr(r.error ?? '取不出来')
      return
    }
    setRevealed({ id: it.id, value: r.value })
  }

  const lockNow = async (): Promise<void> => {
    setSt(await window.api.secrets.lock())
    setItems([])
    setRevealed(null)
    setDraft(null)
  }

  return (
    <>
      <button
        ref={btnRef}
        className={`sec-btn${st.configured && !st.locked ? ' unlocked' : ''}`}
        data-tip={
          !st.configured
            ? '密钥柜 · 还没启用'
            : st.locked
              ? '密钥柜 · 已锁定'
              : `密钥柜 · 已解锁（${st.count} 条）`
        }
        onClick={() => setOpen((v) => !v)}
      >
        {st.configured && st.locked ? <LockIcon size={13} /> : <KeyIcon size={13} />}
      </button>

      {open &&
        createPortal(
          // portal 到 body：标题栏是 overflow:hidden 会裁掉它，
          // 画布里的 webview 也会盖住标题栏内的绝对定位元素
          <div className="sec-pop" ref={popRef}>
            <div className="sec-head">
              <span>密钥柜</span>
              {st.configured && !st.locked && (
                <button className="sec-mini" onClick={() => void lockNow()}>
                  立即锁定
                </button>
              )}
            </div>

            {/* 这段是这个功能的诚信所在，改文案前先看文件头的红线 */}
            <p className="sec-note">
              存在这里的密钥{' '}
              <b>不会出现在你和 AI 的对话里，也不会上传</b>
              —— 用的时候由本机直接注入终端环境变量。
            </p>

            {/* 有多少条会进每一个新终端，得一眼看见：这个数字直接等于
                「终端里跑的任何东西（含 npm 包的 postinstall）能读到几个密钥」 */}
            {!st.locked && autoCount > 0 && (
              <div className="sec-auto-sum">
                新开的终端会自动带上 <b>{autoCount}</b> 条
              </div>
            )}

            {!st.available && (
              <div className="sec-warn">
                这台机器上系统加密不可用，暂时不能安全地存密钥。
              </div>
            )}

            {st.foreign && (
              <div className="sec-warn">
                这份密钥库像是从别的机器（或改名前的版本）来的，多半解不开 —— 需要重新录入。
              </div>
            )}

            {/* ── 三态：没启用 / 锁着 / 开着 ── */}
            {!st.configured || st.locked ? (
              <div className="sec-lock">
                <div className="sec-lock-t">
                  {st.configured ? '输入六位码解锁' : '设置一个六位码'}
                </div>
                <div className="sec-lock-d">
                  {st.configured
                    ? '15 分钟没操作会自动锁上'
                    : '它只用来确认「是你本人在操作」，不参与加密 —— 真正的保护交给系统钥匙串'}
                </div>
                <input
                  className="sec-code"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  placeholder="······"
                  value={code}
                  disabled={!st.available || st.lockedOutMs > 0}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.length === 6) void submitCode()
                  }}
                  autoFocus
                />
                <button
                  className="sec-primary"
                  disabled={code.length !== 6 || !st.available || st.lockedOutMs > 0}
                  onClick={() => void submitCode()}
                >
                  {st.configured ? '解锁' : '启用密钥柜'}
                </button>
                {st.lockedOutMs > 0 && (
                  <div className="sec-err">
                    错太多次了，等 {Math.ceil(st.lockedOutMs / 1000)} 秒再试
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="sec-list">
                  {items.length === 0 && !draft && (
                    <div className="sec-empty">还没有密钥。加一条，之后开终端时就能勾选注入。</div>
                  )}
                  {items.map((it) => (
                    <div key={it.id} className={`sec-row${it.readable ? '' : ' broken'}`}>
                      <div className="sec-row-main">
                        <div className="sec-row-name">{it.name}</div>
                        <code className="sec-var">{it.varName}</code>
                        {/* 「自动注入」直接在列表上切 —— 这是最常改的一项，
                            塞进编辑表单里要多点两下 */}
                        <button
                          className={`sec-auto${it.autoInject ? ' on' : ''}`}
                          data-tip={
                            it.autoInject
                              ? '新开的终端会自动带上它 · 点击关闭'
                              : '目前不会自动注入 · 点击打开'
                          }
                          onClick={() => void toggleAuto(it)}
                        >
                          <span className="sec-auto-dot" />
                          {it.autoInject ? '自动注入' : '不注入'}
                        </button>
                        {it.note && <div className="sec-row-note">{it.note}</div>}
                        {!it.readable && (
                          <div className="sec-row-note bad">这台机器上解不开，需要重新录入</div>
                        )}
                        {revealed?.id === it.id && (
                          <div className="sec-reveal">
                            <code>{revealed.value}</code>
                            <button
                              className="sec-mini"
                              onClick={() => void window.api.clipboard.writeText(revealed.value)}
                            >
                              <CopyIcon size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="sec-row-acts">
                        <button
                          className="sec-mini"
                          data-tip={revealed?.id === it.id ? '收起' : '查看值'}
                          disabled={!it.readable}
                          onClick={() => void reveal(it)}
                        >
                          {revealed?.id === it.id ? '隐藏' : '查看'}
                        </button>
                        <button
                          className="sec-mini"
                          data-tip="编辑"
                          onClick={() =>
                            setDraft({
                              id: it.id,
                              name: it.name,
                              varName: it.varName,
                              note: it.note ?? '',
                              value: '',
                              autoInject: it.autoInject
                            })
                          }
                        >
                          <PencilIcon size={11} />
                        </button>
                        <button
                          className="sec-mini danger"
                          data-tip="删除"
                          onClick={() => void removeOne(it)}
                        >
                          <TrashIcon size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {draft ? (
                  <div className="sec-form">
                    <input
                      className="sec-input"
                      placeholder="名字（OpenAI 生产环境）"
                      value={draft.name}
                      autoFocus
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                    <input
                      className="sec-input mono"
                      placeholder="变量名（OPENAI_API_KEY）"
                      value={draft.varName}
                      onChange={(e) => setDraft({ ...draft, varName: e.target.value })}
                    />
                    <input
                      className="sec-input mono"
                      type="password"
                      autoComplete="off"
                      placeholder={draft.id ? '密钥值（留空 = 不改）' : '密钥值'}
                      value={draft.value}
                      onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                    />
                    <input
                      className="sec-input"
                      placeholder="备注（可空）"
                      value={draft.note}
                      onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    />
                    <label className="sec-check">
                      <input
                        type="checkbox"
                        checked={draft.autoInject}
                        onChange={(e) => setDraft({ ...draft, autoInject: e.target.checked })}
                      />
                      <span>新开的终端自动带上它</span>
                    </label>
                    <div className="sec-form-acts">
                      <button className="sec-mini" onClick={() => setDraft(null)}>
                        取消
                      </button>
                      <button className="sec-primary sm" onClick={() => void saveDraft()}>
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="sec-add" onClick={() => setDraft(emptyDraft())}>
                    <PlusIcon size={12} />
                    加一条密钥
                  </button>
                )}
              </>
            )}

            {err && (
              <div className="sec-err">
                {err}
                <button className="sec-mini" onClick={() => setErr('')}>
                  <CloseIcon size={10} />
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
