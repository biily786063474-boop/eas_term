// 密钥柜：标题栏的钥匙按钮 + 弹层。
//
// **文案红线**（见 docs/密钥管理器-设计与可行性.html）：
// 这里绝不能出现「AI 读不到」「对 AI 不可见」这类说法 —— 那是做不到的
// （密钥注入终端后，在那个终端里跑命令的 AI `echo $KEY` 就能看见）。
// 能承诺的、也是这个功能真正解决的问题是：**密钥不会出现在对话里，也不会上传**。
// 一句话写歪，整个功能的诚信就没了。
//
// 值永远不摊在屏幕上：列表只有名字和变量名；点「查看」也只露头尾各四位（mask()），
// 完整值只经 secrets:reveal 进内存、经复制按钮进剪贴板 —— 那是唯一能把值交到渲染层的通道。
//
// **一条 = 一组变量**：AK/SK、数据库那套 host/user/password 本来就是一个整体，
// 拆成几条会出现「删了一半」「自动注入只开了一半」这种半残状态。

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SecretMeta, SecretsStatus } from '../../../../shared/types'
import { KeyIcon, LockIcon, PencilIcon, TrashIcon, CopyIcon, PlusIcon, CloseIcon } from '../../ui/Icons'
import './workspace.css'

/** 表单里的一行。from = 这行原来叫什么（编辑态才有），
 *  留着是为了「改名但不改值」时后端能找到旧密文 */
interface DraftVar {
  varName: string
  value: string
  from?: string
}
interface Draft {
  id?: string
  name: string
  note: string
  vars: DraftVar[]
  autoInject: boolean
}
const emptyDraft = (): Draft => ({
  name: '',
  note: '',
  vars: [{ varName: '', value: '' }],
  autoInject: true // 新加的多半就是要用的，默认开省一步；不想要的当场关掉就行
})

/** 常见的成对凭证，点一下把变量名铺好 —— AK/SK 这类没人记得住准确拼写 */
const PRESETS: { label: string; vars: string[] }[] = [
  { label: '阿里云', vars: ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET'] },
  { label: 'AWS', vars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
  { label: '腾讯云', vars: ['TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY'] }
]

/** 显示时只露头尾各 4 位，中间打码。
 *  「查看」的真实用途是核对「是不是这一把」，头尾就够了；
 *  屏幕上摊开整串是白送给截图、录屏和旁边那位。要完整值走复制按钮。
 *  短于 9 位的一律全码 —— 那种长度露头尾就等于露全部，星号个数也不跟真实长度走。 */
function mask(v: string): string {
  if (v.length <= 8) return '*'.repeat(8)
  return v.slice(0, 4) + '*'.repeat(Math.min(v.length - 8, 16)) + v.slice(-4)
}

/** 解析粘贴进来的 .env 文本。云控制台「复制凭证」给的多半就是这个格式，
 *  一个个抠出来填太蠢了。认 export 前缀、# 注释、单双引号 */
function parseEnv(text: string): DraftVar[] {
  const out: DraftVar[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const varName = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) continue
    let value = line.slice(eq + 1).trim()
    const q = value[0]
    if ((q === '"' || q === "'") && value.endsWith(q) && value.length > 1) value = value.slice(1, -1)
    out.push({ varName, value })
  }
  return out
}

export function SecretsPanel(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState<SecretsStatus | null>(null)
  const [items, setItems] = useState<SecretMeta[]>([])
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [paste, setPaste] = useState<string | null>(null)
  // 忘了六位码的两步：先看清后果（confirm），再设新码（set）
  const [forgot, setForgot] = useState<'confirm' | 'set' | null>(null)
  const [revealed, setRevealed] = useState<{ id: string; vars: { varName: string; value: string }[] } | null>(
    null
  )
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
      setPaste(null)
      setForgot(null)
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
  // 会进每个新终端的**变量个数**（不是条数）—— 用户关心的是环境里多了几个东西
  const autoVars = items.filter((x) => x.autoInject).reduce((n, x) => n + x.vars.length, 0)

  const submitCode = async (): Promise<void> => {
    setErr('')
    const r =
      forgot === 'set'
        ? await window.api.secrets.resetCode(code) // 忘了码：换一个，密钥不动
        : st.configured
          ? await window.api.secrets.unlock(code)
          : await window.api.secrets.setup(code)
    setCode('')
    if (!r.ok) {
      setErr(r.error ?? '出错了')
      setSt(r.status)
      return
    }
    setForgot(null)
    setSt(r.status)
    setItems(await window.api.secrets.list())
  }

  const patchVar = (i: number, patch: Partial<DraftVar>): void => {
    if (!draft) return
    setDraft({ ...draft, vars: draft.vars.map((v, j) => (i === j ? { ...v, ...patch } : v)) })
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    setErr('')
    const r = await window.api.secrets.save({
      id: draft.id,
      name: draft.name,
      note: draft.note || undefined,
      autoInject: draft.autoInject,
      vars: draft.vars.map((v) => ({
        varName: v.varName.trim(),
        value: v.value,
        from: v.from
      }))
    })
    if (!r.ok) {
      setErr(r.error ?? '保存失败')
      return
    }
    setSt(r.status)
    setItems(await window.api.secrets.list())
    setDraft(null)
    setPaste(null)
  }

  /** 直接在列表上切「自动注入」，不用进编辑态。
   *  每行不带 value = 主进程沿用已存的密文，值不会被动 */
  const toggleAuto = async (it: SecretMeta): Promise<void> => {
    setErr('')
    const r = await window.api.secrets.save({
      id: it.id,
      name: it.name,
      note: it.note,
      autoInject: !it.autoInject,
      vars: it.vars.map((v) => ({ varName: v.varName }))
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
    if (!r.ok || !r.vars) {
      setErr(r.error ?? '取不出来')
      return
    }
    setRevealed({ id: it.id, vars: r.vars })
  }

  /** 整组复制成 .env，直接贴进项目里就能用 */
  const copyAsEnv = (vars: { varName: string; value: string }[]): void => {
    void window.api.clipboard.writeText(vars.map((v) => `${v.varName}=${v.value}`).join('\n'))
  }

  const lockNow = async (): Promise<void> => {
    setSt(await window.api.secrets.lock())
    setItems([])
    setRevealed(null)
    setDraft(null)
    setPaste(null)
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
              存在这里的密钥 <b>不会出现在你和 AI 的对话里，也不会上传</b>
              —— 用的时候由本机直接注入终端环境变量。
            </p>

            {/* 有多少会进每一个新终端，得一眼看见：这个数字直接等于
                「终端里跑的任何东西（含 npm 包的 postinstall）能读到几个变量」 */}
            {!st.locked && autoCount > 0 && (
              <div className="sec-auto-sum">
                新开的终端会自动带上 <b>{autoCount}</b> 条
                {autoVars !== autoCount && <>（共 {autoVars} 个变量）</>}
              </div>
            )}

            {!st.available && (
              <div className="sec-warn">这台机器上系统加密不可用，暂时不能安全地存密钥。</div>
            )}

            {st.foreign && (
              <div className="sec-warn">
                这份密钥库像是从别的机器（或改名前的版本）来的，多半解不开 —— 需要重新录入。
              </div>
            )}

            {/* ── 三态：没启用 / 锁着 / 开着 ── */}
            {!st.configured || st.locked ? (
              forgot === 'confirm' ? (
                // 「忘记了」的第一步：先把后果摆清楚。
                // 这不是找回，是换一把新锁 —— 说成「找回」就是骗人
                <div className="sec-lock">
                  <div className="sec-lock-t">换一个新的六位码</div>
                  <div className="sec-lock-d">
                    你的 <b>{st.count}</b> 条密钥<b>一条都不会丢</b> ——
                    它们是系统钥匙串加密的，跟这六位数没关系。
                    <br />
                    <br />
                    但也别把这当成"安全找回"：<b>换完柜子就是开的</b>，
                    里面的密钥立刻可以查看和注入。之所以敢给这个按钮，是因为
                    <b>六位码本来就不是加密边界</b> —— 能改这台机器上文件的人，
                    不用这个按钮也能绕过去。
                  </div>
                  <div className="sec-form-acts" style={{ marginTop: 10 }}>
                    <button className="sec-mini" onClick={() => setForgot(null)}>
                      算了
                    </button>
                    <button className="sec-primary sm" onClick={() => setForgot('set')}>
                      明白，换一个
                    </button>
                  </div>
                </div>
              ) : (
              <div className="sec-lock">
                <div className="sec-lock-t">
                  {forgot === 'set'
                    ? '设置新的六位码'
                    : st.configured
                      ? '输入六位码解锁'
                      : '设置一个六位码'}
                </div>
                <div className="sec-lock-d">
                  {forgot === 'set'
                    ? `设完直接进柜子，${st.count} 条密钥原样都在`
                    : st.configured
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
                  // 退避只挡"猜码"。换新锁不用猜，所以 forgot==='set' 时输入框和下面的
                  // 按钮都得放行 —— 只放行按钮不放行输入框，等于按钮永远点不亮
                  disabled={!st.available || (st.lockedOutMs > 0 && forgot !== 'set')}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.length === 6) void submitCode()
                  }}
                  autoFocus
                />
                <button
                  className="sec-primary"
                  disabled={
                    code.length !== 6 ||
                    !st.available ||
                    // 退避只挡"猜码"，不挡"换一把锁"——重置根本不用猜
                    (st.lockedOutMs > 0 && forgot !== 'set')
                  }
                  onClick={() => void submitCode()}
                >
                  {forgot === 'set' ? '换成这个' : st.configured ? '解锁' : '启用密钥柜'}
                </button>
                {st.lockedOutMs > 0 && forgot !== 'set' && (
                  <div className="sec-err">
                    错太多次了，等 {Math.ceil(st.lockedOutMs / 1000)} 秒再试
                  </div>
                )}
                {/* 忘了码的出路。放在最下面、做成弱按钮：它是给自己人的备用门，
                    不该跟"解锁"抢注意力 */}
                {st.configured && forgot === null && (
                  <button
                    className="sec-forgot"
                    onClick={() => {
                      setCode('')
                      setErr('')
                      setForgot('confirm')
                    }}
                  >
                    忘记六位码了？
                  </button>
                )}
                {forgot === 'set' && (
                  <button className="sec-forgot" onClick={() => { setForgot(null); setCode('') }}>
                    返回，我再想想
                  </button>
                )}
              </div>
              )
            ) : (
              <>
                <div className="sec-list">
                  {items.length === 0 && !draft && (
                    <div className="sec-empty">还没有密钥。加一条，之后开终端时就能勾选注入。</div>
                  )}
                  {items.map((it) => {
                    const broken = it.vars.some((v) => !v.readable)
                    return (
                      <div key={it.id} className={`sec-row${broken ? ' broken' : ''}`}>
                        <div className="sec-row-main">
                          <div className="sec-row-name">{it.name}</div>
                          <div className="sec-vars">
                            {it.vars.map((v) => (
                              <code key={v.varName} className={`sec-var${v.readable ? '' : ' bad'}`}>
                                {v.varName}
                              </code>
                            ))}
                          </div>
                          {/* 「自动注入」直接在列表上切 —— 这是最常改的一项，
                              塞进编辑表单里要多点两下 */}
                          <button
                            className={`sec-auto${it.autoInject ? ' on' : ''}`}
                            data-tip={
                              it.autoInject
                                ? '新开的终端会自动带上这一组 · 点击关闭'
                                : '目前不会自动注入 · 点击打开'
                            }
                            onClick={() => void toggleAuto(it)}
                          >
                            <span className="sec-auto-dot" />
                            {it.autoInject ? '自动注入' : '不注入'}
                          </button>
                          {it.note && <div className="sec-row-note">{it.note}</div>}
                          {broken && (
                            <div className="sec-row-note bad">这台机器上解不开，需要重新录入</div>
                          )}
                          {revealed?.id === it.id && (
                            <div className="sec-reveal">
                              {revealed.vars.map((v) => (
                                <div key={v.varName} className="sec-reveal-row">
                                  <code>
                                    <b>{v.varName}</b>={mask(v.value)}
                                  </code>
                                  <button
                                    className="sec-mini"
                                    data-tip="复制完整值"
                                    onClick={() => void window.api.clipboard.writeText(v.value)}
                                  >
                                    <CopyIcon size={11} />
                                  </button>
                                </div>
                              ))}
                              <div className="sec-reveal-tip">
                                屏幕上只露头尾四位，复制拿到的是完整值
                                {revealed.vars.length > 1 && (
                                  <button className="sec-mini" onClick={() => copyAsEnv(revealed.vars)}>
                                    整组复制成 .env
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="sec-row-acts">
                          <button
                            className="sec-mini"
                            data-tip={revealed?.id === it.id ? '收起' : '查看值'}
                            disabled={broken}
                            onClick={() => void reveal(it)}
                          >
                            {revealed?.id === it.id ? '隐藏' : '查看'}
                          </button>
                          <button
                            className="sec-mini"
                            data-tip="编辑"
                            onClick={() => {
                              setPaste(null)
                              setDraft({
                                id: it.id,
                                name: it.name,
                                note: it.note ?? '',
                                // 编辑态不带值：value 留空 = 沿用原密文，from 记着原名好支持改名
                                vars: it.vars.map((v) => ({
                                  varName: v.varName,
                                  value: '',
                                  from: v.varName
                                })),
                                autoInject: it.autoInject
                              })
                            }}
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
                    )
                  })}
                </div>

                {draft ? (
                  <div className="sec-form">
                    <input
                      className="sec-input"
                      placeholder="名字（阿里云 主账号）"
                      value={draft.name}
                      autoFocus
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />

                    {paste !== null ? (
                      // 从云控制台复制出来的多半就是 .env 那一坨，让它整段进来
                      <div className="sec-paste">
                        <textarea
                          className="sec-input mono sec-paste-box"
                          placeholder={'把 .env 整段贴进来，比如\nAWS_ACCESS_KEY_ID=AKIA...\nAWS_SECRET_ACCESS_KEY=...'}
                          value={paste}
                          autoFocus
                          onChange={(e) => setPaste(e.target.value)}
                        />
                        <div className="sec-form-acts">
                          <button className="sec-mini" onClick={() => setPaste(null)}>
                            取消
                          </button>
                          <button
                            className="sec-mini"
                            disabled={!parseEnv(paste).length}
                            onClick={() => {
                              const got = parseEnv(paste)
                              // 已经填了一半的空行别留着碍事
                              const keep = draft.vars.filter((v) => v.varName.trim() || v.value)
                              setDraft({ ...draft, vars: [...keep, ...got] })
                              setPaste(null)
                            }}
                          >
                            认出 {parseEnv(paste).length} 个变量，加进来
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="sec-vars-edit">
                          {draft.vars.map((v, i) => (
                            <div className="sec-var-row" key={i}>
                              <input
                                className="sec-input mono"
                                placeholder="变量名（ACCESS_KEY_ID）"
                                value={v.varName}
                                onChange={(e) => patchVar(i, { varName: e.target.value })}
                              />
                              <input
                                className="sec-input mono"
                                type="password"
                                autoComplete="off"
                                placeholder={v.from ? '值（留空 = 不改）' : '值'}
                                value={v.value}
                                onChange={(e) => patchVar(i, { value: e.target.value })}
                              />
                              <button
                                className="sec-mini danger"
                                data-tip="去掉这个变量"
                                disabled={draft.vars.length <= 1}
                                onClick={() =>
                                  setDraft({ ...draft, vars: draft.vars.filter((_, j) => j !== i) })
                                }
                              >
                                <CloseIcon size={10} />
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="sec-var-tools">
                          <button
                            className="sec-mini"
                            onClick={() =>
                              setDraft({ ...draft, vars: [...draft.vars, { varName: '', value: '' }] })
                            }
                          >
                            <PlusIcon size={10} />
                            再加一个变量
                          </button>
                          <button className="sec-mini" onClick={() => setPaste('')}>
                            从 .env 粘贴
                          </button>
                          {!draft.id &&
                            PRESETS.map((p) => (
                              <button
                                key={p.label}
                                className="sec-mini"
                                data-tip={p.vars.join(' · ')}
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    name: draft.name || p.label,
                                    vars: p.vars.map((varName) => ({ varName, value: '' }))
                                  })
                                }
                              >
                                {p.label}
                              </button>
                            ))}
                        </div>
                      </>
                    )}

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
                      <span>新开的终端自动带上这一组</span>
                    </label>
                    <div className="sec-form-acts">
                      <button
                        className="sec-mini"
                        onClick={() => {
                          setDraft(null)
                          setPaste(null)
                        }}
                      >
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
