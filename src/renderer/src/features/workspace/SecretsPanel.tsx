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
import { useStore } from '../../store'
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
  { label: '腾讯云', vars: ['TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY'] },
  { label: 'Lovart', vars: ['LOVART_ACCESS_KEY', 'LOVART_SECRET_KEY'] },
  { label: '数据库', vars: ['DB_HOST', 'DB_USER', 'DB_PASSWORD'] }
]

/**
 * 变量名输入框的补全候选。
 *
 * **这一条直接决定这个功能对普通用户成不成立。** 密钥柜注入的是环境变量，
 * 而各家 CLI/SDK 读的变量名是写死在它们代码里的 —— 用户存成 OPENAI_KEY
 * 而不是 OPENAI_API_KEY，注入了也一样用不上，而且报错是「没配置 key」，
 * 完全看不出是名字差了两个字母。让他从列表里选，比让他记住强。
 *
 * 收录标准：这个名字是**工具自己会去读的那个**（官方文档写死的），不是我们编的。
 */
const KNOWN_VARS = [
  // AI / 模型
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY',
  'GOOGLE_API_KEY', 'MISTRAL_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY',
  'DASHSCOPE_API_KEY', 'MOONSHOT_API_KEY', 'SILICONFLOW_API_KEY',
  'HF_TOKEN', 'REPLICATE_API_TOKEN', 'ELEVENLABS_API_KEY',
  'LOVART_ACCESS_KEY', 'LOVART_SECRET_KEY',
  // 云 / 部署
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_REGION',
  'ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
  'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY',
  'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  'VERCEL_TOKEN', 'NETLIFY_AUTH_TOKEN', 'RAILWAY_TOKEN', 'FLY_API_TOKEN',
  // 代码托管 / CI
  'GH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'NPM_TOKEN',
  // 数据库 / 后端
  'DATABASE_URL', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'MONGODB_URI',
  'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY',
  // 监控 / 支付 / 其它
  'SENTRY_AUTH_TOKEN', 'SENTRY_DSN', 'STRIPE_SECRET_KEY',
  'JWT_SECRET', 'SESSION_SECRET', 'ENCRYPTION_KEY'
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
  /** 刚存完一条，给一句「接下来会怎样」—— 不说的话用户会回到旧终端里发现用不了 */
  const [justSaved, setJustSaved] = useState<{
    name: string
    vars: string[]
    conflicts: { varName: string; file: string }[]
  } | null>(null)
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
    // 闲置到期自动上锁时主进程会推一下。没有这个订阅的话，标题栏那把钥匙会一直
    // 显示「已解锁」直到你去点它 —— 而这期间新开的终端其实已经拿不到密钥了。
    // 一个说谎的安全状态指示比没有指示更糟。
    return window.api.secrets.onLocked(() => {
      setSt((s) => (s ? { ...s, locked: true } : s))
      setItems([])
      setRevealed(null)
      setDraft(null)
    })
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
    // 存完给一句「接下来会怎样」。不说的话最常见的下一步是：用户回到已经开着的终端里
    // 让 AI 用这个 key，AI 读到空值，双方都以为密钥柜没生效。
    const names = draft.vars.map((v) => v.varName)
    // shell 配置里如果也设了同名变量，它会**覆盖**我们注入的值（rc 在 PTY 起来之后才执行）。
    // 不当场说，用户就会遇到「明明存了新 key，终端里还是旧的」而完全查不到原因。
    const conflicts = await window.api.secrets.rcConflicts(names)
    setJustSaved(draft.id ? null : { name: draft.name, vars: names, conflicts })
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

  /** 删除要问一次。
   *  这是全套功能里**唯一会让用户数据永久消失**的路径：没有撤销、没有回收站、
   *  也没有备份（密钥绑在本机钥匙串上，删了只能回云控制台重新生成）。
   *  而那个 11px 的垃圾桶就贴在 11px 的铅笔旁边，间距 3px。 */
  const removeOne = (it: SecretMeta): void => {
    setErr('')
    useStore.getState().requestConfirm({
      message:
        `删除「${it.name}」？这一组 ${it.vars.length} 个变量（${it.vars.map((v) => v.varName).join('、')}）` +
        '会一起消失。\n\n删除不可撤销，密钥柜也没有备份 —— 要用的话得回原来的服务重新生成一份。',
      confirmLabel: '删除',
      onConfirm: () => {
        void (async () => {
          const r = await window.api.secrets.remove(it.id)
          if (!r.ok) {
            setErr(r.error ?? '删除失败')
            return
          }
          setSt(r.status)
          setItems(await window.api.secrets.list())
        })()
      }
    })
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
            {/* 变量名补全候选。放在弹层里而不是表单里：表单会反复挂载卸载，
                datalist 每次重建没必要，而且 id 要全局唯一 */}
            <datalist id="eas-known-vars">
              {KNOWN_VARS.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
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

            {/* 有多少会进每一个新终端，得一眼看见：这个数字就是
                「终端里跑的任何东西（含 npm 包的 postinstall）能拿到几个变量」的上界。
                **这个上界靠 secrets.ts 的 ptyGrants 撑着**：eas-secret 取值时会认终端凭证，
                只放行「这个终端本来就会注入的组」+「用户当场授权给它的组」。
                一度不成立过——那会儿 /secret-env 只认全局 token，任何终端都能取整柜，
                这行字就成了假的。改这块前先确认那道门还在。 */}
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
                            onClick={() => removeOne(it)}
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
                                // 名字打错是这个功能最隐蔽的失败方式，给补全比让他自己记靠谱
                                list="eas-known-vars"
                                placeholder="变量名（输入几个字母有提示）"
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
                  <>
                    {justSaved && (
                      <div className={`sec-saved${justSaved.conflicts.length ? ' warn' : ''}`}>
                        <b>「{justSaved.name}」已存好</b>
                        <span>
                          之后<b>新开的终端</b>会自动带上它。
                          <br />
                          现在已经开着的终端读不到 —— 进程的环境变量在启动那一刻就定死了。
                          在那些终端里让 AI 用的话，它会自己走 <code>eas-secret</code> 现取。
                        </span>
                        {/* 这条比上面那句要紧：它是一个「看起来一切正常但根本没生效」的坑 */}
                        {justSaved.conflicts.length > 0 && (
                          <span className="sec-saved-bad">
                            <b>但它现在不会生效。</b>你的{' '}
                            {[...new Set(justSaved.conflicts.map((c) => c.file))].map((f) => (
                              <code key={f}>{f}</code>
                            ))}{' '}
                            里也设了{' '}
                            {[...new Set(justSaved.conflicts.map((c) => c.varName))].map((v) => (
                              <code key={v}>{v}</code>
                            ))}
                            。shell 配置是在终端起来<b>之后</b>执行的，会把这里存的值盖掉。
                            <br />
                            要用密钥柜这份，就把那个文件里对应的行删掉（或注释掉）。
                          </span>
                        )}
                        <button className="sec-mini" onClick={() => setJustSaved(null)}>
                          知道了
                        </button>
                      </div>
                    )}
                    <button
                      className="sec-add"
                      onClick={() => {
                        setJustSaved(null)
                        setDraft(emptyDraft())
                      }}
                    >
                      <PlusIcon size={12} />
                      加一条密钥
                    </button>
                  </>
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
