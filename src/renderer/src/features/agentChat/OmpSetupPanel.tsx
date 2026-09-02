// omp（随包底座）的首次设置灯箱：**选服务商 → 填 key → 选模型 → 试一句 → 就绪**。
//
// ── 为什么不是 CliSetupPanel ────────────────────────────────────────────────
// 那条路是「装 CLI → 用 CLI 自己的账号登录」，`cliAuth` 那套只认 claude / codex
// （`STATUS_ARGS` / `LOGIN_ARGS` 是 `Record<'claude'|'codex'>`），把 omp 送进去
// 主进程直接抛。omp 根本不登录 —— 它要的是一把 provider key。两件不同的事，
// 硬塞进同一个面板的结果是用户点「登录」什么也不会发生。
//
// 骨架（灯箱 / 捕获阶段 Esc / 忙态不让关）照 CliSetupPanel 抄，因为对用户来说
// 「让这个 CLI 能用」是同一类事，长得不一样只会让人以为撞上了两个不同的东西。
//
// ── 三条硬约束（与 CliSetupPanel 文件头同源，照搬）─────────────────────────
// ① **串成一条链**：一步做完自动接下一步，不让人被同一条路拦好几次、点好几回。
//    顶上那条面包屑就是这条链的可视化。
// ② **不编进度百分比**：拉模型清单要起一次 omp、冒烟要等模型回话，两件事都没有
//    可解析的进度。硬凑一个数字是骗人 —— 卡在 87% 比没有进度条更让人焦虑。
//    这里只有不确定态的动画条 + 一句真话。
// ③ **失败必须看得到输出**：公司网络 / 代理 / key 不对时，一句「设置失败」什么忙
//    也帮不上。冒烟失败时把 omp 的原话原样摆出来。
//
// ── 判据不在这个文件里 ──────────────────────────────────────────────────────
// 「下一步该做什么」全部来自 `shared/ompSetup.ts` 的 `nextStepOf()`（纯函数、15 条
// 单测）。组件只负责「把 nextStepOf 要的事实凑齐」和「把某一步画出来」。
// **别在这里重写任何一条判断** —— 那七个分支每条都对应用户要做的一件不同的事，
// 埋进组件里的错没人测得到。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { CheckIcon, KeyIcon, LockIcon } from '../../ui/Icons'
import { useStore } from '../../store'
import {
  authFailureInTail,
  nextStepOf,
  OMP_PROVIDERS,
  providerById,
  type OmpSetupState,
  type OmpStep
} from '../../../../shared/ompSetup'
import type { ChatEvent, CliInfo } from '../../../../shared/agentChat'
import type { SecretsStatus } from '../../../../shared/types'

/** 冒烟发的那句话。**故意短到不能再短** —— 它只用来证明「key 通、模型在、能回话」，
 *  多一个字都是在替用户花钱和等时间。 */
const SMOKE_MSG = '请只回复两个字：你好'

/** 等回话的上限。60 秒是**冷启动**的量级：omp 起进程 + ACP 握手 + 第一次连服务商，
 *  比 Claude/Codex 那条路慢得多。设短了会把「慢」误报成「坏」，
 *  而用户下一步的动作（去换一把好好的 key）完全是白费。 */
const SMOKE_TIMEOUT_MS = 60_000

/** `omp:status` 的返回形状。**这里重新声明一份，不从 `main/agentChat/omp/setup.ts` import** ——
 *  `tsconfig.web.json` 只 include `src/renderer/src` 与 `src/shared`，composite 工程
 *  要求列全文件，跨过去就是 TS6307；preload 那侧本来也只声明成 `Promise<unknown>`。
 *  字段按需取、缺了就当没有，不做整体断言。 */
interface OmpStatusWire {
  installed?: boolean
  provider?: string
  model?: string
  lastSmoke?: { ok: boolean; at: number; message?: string }
}

/** 面板叠在 `nextStepOf` 之上的**临时态**。
 *
 *  它和「下一步该做什么」是两件事：`nextStepOf` 回答的是「按当前事实，用户还缺什么」，
 *  而这些是「此刻正在发生什么」（正在存、正在试）。混成一个枚举的话，
 *  一次失败的保存会把状态机推到一个事实上并不成立的分支上去。 */
type Busy =
  | { k: 'idle' }
  /** 正在跟主进程打交道。`what` 是**真话**，不是编的进度 */
  | { k: 'busy'; what: string }
  /** 正在试一句。`out` 攒的是 omp 自己说的话，失败时原样给用户看 */
  | { k: 'smoke'; out: string[] }
  | { k: 'smoke-failed'; message: string; out: string[]; auth: boolean }
  | { k: 'done' }

/** 用户主动要求回去改某一步。**这不是判据，是意图** ——
 *  `nextStepOf` 说的是「还缺什么」，全都齐了它只会说 ready；
 *  而「我想换一家 / 这把 key 我要重填」是用户自己的决定，状态机答不了。
 *  所以单独一个覆盖位，而不是去伪造事实（比如假装 key 不在柜里）把状态机骗回去。 */
type Editing = 'provider' | 'key' | 'model' | null

export function OmpSetupPanel(props: {
  cli: CliInfo
  onDone: (ok: boolean) => void
  onCancel: () => void
}): React.JSX.Element {
  const { cli, onDone, onCancel } = props

  // ── 事实（两处拼出来的）───────────────────────────────────────────────────
  const [omp, setOmp] = useState<OmpStatusWire | null>(null)
  const [vault, setVault] = useState<SecretsStatus | null>(null)
  const [keyInVault, setKeyInVault] = useState(false)

  // ── 草稿。**刻意与事实分开存** ──────────────────────────────────────────
  // 柜子 15 分钟不动会自动锁，用户去申请 key 的这一趟正好赶上。
  // 回来时状态被打回「先解锁」，但他已经粘进去的那半截 key 必须还在 ——
  // 把草稿并进事实里刷新一次就没了，那是最气人的一种「白填一遍」。
  const [keyText, setKeyText] = useState('')
  const [code, setCode] = useState('')
  const [query, setQuery] = useState('')

  const [busy, setBusy] = useState<Busy>({ k: 'idle' })
  const [editing, setEditing] = useState<Editing>(null)
  const [err, setErr] = useState('')
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null)
  /** key 已经被别的密钥组占着（用户自己手填过同名变量）。
   *  这时**不新建组、也不改那组的自动注入开关**，只更新值 —— 并把这件事说给他听。 */
  const [keyHolder, setKeyHolder] = useState<{ id: string; name: string; shared: boolean } | null>(null)

  const aliveRef = useRef(true)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // 冒烟那一路的清理句柄。**必须挂在 ref 上** —— 超时、成功、卸载三条路都要能收尾，
  // 少收一条就是一个在后台自己跑着的 omp 进程（用户既看不到也关不掉）
  const smokeRef = useRef<{ settled: boolean; sessionId?: string; off?: () => void; timer?: number }>({
    settled: true
  })

  // 冒烟要一个工作目录。**从当前项目取，不自己造一个临时目录** ——
  // omp 起来会读那个目录的 AGENTS.md / skill 配置，换个空目录等于在测一套
  // 跟用户真实使用不一样的环境，测过了也不说明什么。
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const smokeCwd = useMemo(
    () => projects.find((p) => p.id === activeProjectId)?.path ?? projects[0]?.path ?? '',
    [projects, activeProjectId]
  )

  // ── 拼事实 ────────────────────────────────────────────────────────────────
  //
  // **两处都要查，缺一不可。** 主进程那侧不知道柜子此刻锁没锁：它 15 分钟不动就
  // 自动锁，隔一次 IPC 往返就可能变。所以 `omp:status` 里柜子那三项一律填「好的」，
  // 真正的判定在这里用 `secrets.status()` 补齐后重算。
  const refresh = useCallback(async (): Promise<void> => {
    const [o, v] = await Promise.all([
      window.api.omp.status() as Promise<OmpStatusWire | null>,
      window.api.secrets.status()
    ])
    if (!aliveRef.current) return
    setOmp(o ?? {})
    setVault(v)
    // 这家的 key 在不在柜里。`has` 不要求解锁，所以锁着也能问 —— 但锁着时 readable
    // 为假，nextStepOf 会先把人送去解锁，不会误判成「还没填 key」
    const pid = o?.provider
    if (!pid) {
      setKeyInVault(false)
      return
    }
    const kv = await window.api.omp.keyVar(pid)
    if (!aliveRef.current) return
    if (!kv) {
      setKeyInVault(false)
      return
    }
    const h = await window.api.secrets.has([kv.varName])
    if (!aliveRef.current) return
    const row = h.vars.find((x) => x.varName === kv.varName)
    setKeyInVault(!!row?.inVault && !!row?.readable)
  }, [])

  useEffect(() => {
    aliveRef.current = true
    void refresh()
    return () => {
      aliveRef.current = false
      // 卸载 = 放弃这次冒烟。留着它在后台跑完，用户既看不到结果也关不掉那个进程
      const s = smokeRef.current
      s.settled = true
      if (s.timer) window.clearTimeout(s.timer)
      s.off?.()
      if (s.sessionId) window.api.agentChat.stop(s.sessionId)
      smokeRef.current = { settled: true }
    }
  }, [refresh])

  // 柜子自动上锁时主进程会推一下。**收到就重查事实，草稿一个字不动** ——
  // 用户此刻多半正在外面那个网页上复制 key，回来时该看到「先解锁」而不是一个空输入框。
  useEffect(() => window.api.secrets.onLocked(() => void refresh()), [refresh])

  // 窗口重新拿到焦点时再查一次柜子。
  // **`onLocked` 覆盖不到手动上锁** —— 标题栏那把钥匙点一下走的是 `secrets:lock`，
  // 它只是把 `unlockedUntil` 归零，不广播任何事件。只靠订阅的话，用户自己锁完回来，
  // 面板还停在「填 key」，点保存才撞上「柜子锁着」。
  useEffect(() => {
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // Esc 关掉。**忙的时候不响应** —— 一下误触会取消掉一次已经在跑的冒烟
  const busyRef = useRef(busy)
  busyRef.current = busy
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (busyRef.current.k === 'busy' || busyRef.current.k === 'smoke') return
      e.stopPropagation()
      onCancelRef.current()
    }
    // 捕获阶段：画布那侧也听 Esc（退出最大化），不抢在前面的话两个会一起响应
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ── 下一步是哪一步。**唯一的判据来源** ───────────────────────────────────
  const step: OmpStep | null = useMemo(() => {
    if (!omp || !vault) return null
    const s: OmpSetupState = {
      installed: omp.installed === true,
      vault: {
        available: vault.available,
        configured: vault.configured,
        locked: vault.locked,
        foreign: vault.foreign
      },
      provider: omp.provider,
      keyInVault,
      model: omp.model
    }
    return nextStepOf(s)
  }, [omp, vault, keyInVault])

  // 服务商清单直接用 shared 那份 —— **主进程用的就是同一个模块**，
  // 没必要再从 `omp:status` 的返回里抄一遍（抄一遍就有了第二份，迟早分叉）
  const provider = providerById(omp?.provider)

  // ── 动作 ──────────────────────────────────────────────────────────────────

  const pickProvider = async (id: string): Promise<void> => {
    setErr('')
    setBusy({ k: 'busy', what: '正在记下这家服务商…' })
    // 换服务商会把上一次的冒烟结果作废（主进程那边清 lastSmoke），
    // 顺手把本地的模型清单也丢掉：那份是上一家的，留着会让人从中选出一个用不了的
    setModels(null)
    setQuery('')
    const r = await window.api.omp.saveProvider({ provider: id })
    if (!aliveRef.current) return
    if (!r.ok) {
      setBusy({ k: 'idle' })
      setErr(r.error ?? '存不下这家服务商')
      return
    }
    setEditing(null)
    await refresh()
    if (aliveRef.current) setBusy({ k: 'idle' })
  }

  const submitCode = async (): Promise<void> => {
    if (!vault) return
    setErr('')
    setBusy({ k: 'busy', what: vault.configured ? '正在解锁…' : '正在建柜…' })
    const r = vault.configured
      ? await window.api.secrets.unlock(code)
      : await window.api.secrets.setup(code)
    if (!aliveRef.current) return
    setCode('')
    setBusy({ k: 'idle' })
    if (!r.ok) {
      setErr(r.error ?? '出错了')
      setVault(r.status)
      return
    }
    await refresh()
  }

  /**
   * 把 key 存进密钥柜。**明文只走 `secrets:save` 这一条通道**，不经 omp 的任何 IPC ——
   * 密钥的明文一次都不该多经过一个通道（`omp:keyVar` 回的只是变量名）。
   *
   * `autoInject` 必须是 false：这把 key 只该进 omp 那个进程。开着的话它会跟进**每一个**
   * 新终端 —— 用户在终端里随手跑个 `env` 就把它打出来了，而他根本不知道有这回事。
   */
  const saveKey = async (): Promise<void> => {
    const pid = omp?.provider
    const p = providerById(pid)
    if (!pid || !p) return
    const val = keyText.trim()
    if (!val) return
    setErr('')
    setBusy({ k: 'busy', what: '正在存进密钥柜…' })

    const kv = await window.api.omp.keyVar(pid)
    if (!aliveRef.current) return
    if (!kv) {
      setBusy({ k: 'idle' })
      setErr('取不到这家服务商的变量名')
      return
    }

    // **已经有人占着这个变量名就必须复用那一条**，否则 `secrets:save` 会以
    // 「XXX 已经被「某某」占用了」直接拒掉 —— 而用户只会看到一句莫名其妙的报错。
    const list = await window.api.secrets.list()
    if (!aliveRef.current) return
    const holder = list.find((g) => g.vars.some((v) => v.varName === kv.varName))
    // 那一组里还有别的变量 = 它是用户自己建的，不是我们的。
    // 这时**只更新值**：不改名、不动它的自动注入开关、更不能把别的变量挤掉
    // （`secrets:save` 是整组替换 `old.vars = next`，少传一个就是删一个）
    const shared = !!holder && holder.vars.length > 1

    const r = await window.api.secrets.save({
      id: holder?.id,
      name: holder?.name ?? `omp · ${p.label}`,
      // 别的变量原样带回去：不给 value 就是「沿用旧密文」，值不经过渲染层
      vars: holder
        ? holder.vars.map((v) => (v.varName === kv.varName ? { varName: v.varName, value: val } : { varName: v.varName }))
        : [{ varName: kv.varName, value: val }],
      // 共用组不碰它原来的开关；我们自己的那条一律 false
      ...(shared ? {} : { autoInject: false })
    })
    if (!aliveRef.current) return
    setBusy({ k: 'idle' })
    if (!r.ok) {
      setVault(r.status)
      setErr(r.error ?? '存不进去')
      return
    }
    setKeyHolder(holder ? { id: holder.id, name: holder.name, shared } : null)
    // 存进去了就把草稿清掉 —— 留着一串明文在内存里没有任何用处
    setKeyText('')
    setEditing(null)
    await refresh()
  }

  const loadModels = useCallback(async (): Promise<void> => {
    setBusy({ k: 'busy', what: '正在问 omp 有哪些模型…' })
    const list = await window.api.omp.listModels()
    if (!aliveRef.current) return
    setModels(list)
    setBusy({ k: 'idle' })
  }, [])

  // 走到「选模型」这一步才去拉清单。**提前拉没有意义** —— 它要起一次 omp，
  // 而在还没填 key 的机器上那一趟必然空手而归
  useEffect(() => {
    if (step?.k === 'model' && models === null && busy.k === 'idle') void loadModels()
  }, [step, models, busy.k, loadModels])

  const pickModel = async (id: string): Promise<void> => {
    const pid = omp?.provider
    if (!pid) return
    setErr('')
    setBusy({ k: 'busy', what: '正在记下这个模型…' })
    const r = await window.api.omp.saveProvider({ provider: pid, model: id })
    if (!aliveRef.current) return
    if (!r.ok) {
      setBusy({ k: 'idle' })
      setErr(r.error ?? '存不下这个模型')
      return
    }
    setEditing(null)
    await refresh()
    if (!aliveRef.current) return
    // **选完直接接上冒烟**，不让用户再点一次「测试」：对他来说「配好了」
    // 本来就包含「确认能用」这一步，摆一颗按钮在中间只是多拦一道
    void runSmoke()
  }

  /**
   * 试一句。**用既有的会话机制，不另起一套** ——
   * `agentChat.start` + `onEvent` 已经处理了进程、ACP 握手、事件缓冲那一整套；
   * 为了冒烟再写一条起进程的代码，等于同一件事有两个实现，迟早只修其中一个。
   *
   * 判过的标准是**看到第一个字**（`text.delta`）：那说明 key 通了、模型在、
   * 链路整条走通了。等 `turn.done` 只是多等几秒，证明不了更多东西。
   */
  const runSmoke = async (): Promise<void> => {
    if (!smokeCwd) {
      setBusy({
        k: 'smoke-failed',
        message: '没有可用的工作目录，试不了 —— 先在左边打开一个项目再回来。',
        out: [],
        auth: false
      })
      return
    }
    setErr('')
    setBusy({ k: 'smoke', out: [] })

    // 这一趟自己的收尾句柄。**不能直接读 smokeRef** ——
    // preload 的按会话缓冲会在 `onEvent()` 调用**当场**回放已经攒下的事件
    // （那套本来是为「订阅之前的事件不许丢」做的），所以首字可能在
    // `smokeRef.current.off = …` 这行赋值**之前**就到了。那时 finish() 读到的是空句柄：
    // 监听器摘不掉、定时器还没挂上，等赋值语句跑完，一个 60 秒后必然开火的
    // 超时就留在了那里 —— 已经成功的这一屏会在一分钟后被一句「没等到回话」盖掉。
    const h: { settled: boolean; off?: () => void; timer?: number; sessionId?: string } = {
      settled: false
    }
    smokeRef.current = h

    const finish = (): void => {
      h.settled = true
      if (h.timer) window.clearTimeout(h.timer)
      h.timer = undefined
      h.off?.()
      h.off = undefined
      if (h.sessionId) window.api.agentChat.stop(h.sessionId)
      h.sessionId = undefined
    }

    // 攒 omp 自己说的话。**失败时这些是唯一有用的东西** ——
    // 「设置失败」四个字帮不上任何忙，而 401 / 连不上 / 模型名不认识
    // 这三种故障用户的下一步动作完全不同
    const out: string[] = []
    const fail = (message: string): void => {
      if (h.settled) return
      finish()
      if (!aliveRef.current) return
      void window.api.omp.noteSmoke({ ok: false, message })
      // 认得出是「key 不对」才把人打回填 key 那步。认不出的一律不猜 ——
      // 把网络故障说成 key 不对，会让人去反复更换一把其实没问题的 key
      setBusy({ k: 'smoke-failed', message, out: [...out], auth: authFailureInTail(out) === 'auth' })
      void refresh()
    }

    const r = await window.api.agentChat.start({ cli: cli.id, cwd: smokeCwd, message: SMOKE_MSG })
    if (!aliveRef.current) {
      if (r.ok) window.api.agentChat.stop(r.sessionId)
      return
    }
    if (!r.ok) {
      out.push(r.error)
      fail(r.error)
      return
    }
    h.sessionId = r.sessionId

    const off = window.api.agentChat.onEvent(r.sessionId, (e: ChatEvent) => {
      if (h.settled) return
      if (e.k === 'text.delta') {
        finish()
        if (!aliveRef.current) return
        void window.api.omp.noteSmoke({ ok: true })
        setBusy({ k: 'done' })
        void refresh()
        onDoneRef.current(true)
        return
      }
      if (e.k === 'error') {
        out.push(e.message)
        // 非致命的先攒着：omp 会先推一条 notice 再继续跑，这时候中断等于误报
        if (e.fatal) fail(e.message)
        else setBusy({ k: 'smoke', out: [...out] })
      }
    })
    // 回放已经在上面那次调用里跑完了 —— 结果出来了就当场摘掉监听、别再挂超时
    if (h.settled) {
      off()
      return
    }
    h.off = off

    h.timer = window.setTimeout(() => {
      fail(`等了 ${SMOKE_TIMEOUT_MS / 1000} 秒还没等到回话`)
    }, SMOKE_TIMEOUT_MS)
  }

  const close = (): void => {
    if (busy.k === 'busy' || busy.k === 'smoke') return
    onCancel()
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  const working = busy.k === 'busy' || busy.k === 'smoke'
  // 面包屑要显示「走到哪了」。**它不是进度百分比**（约束 ②）——
  // 只是把四段链路摆出来、把当前这段标亮，没有任何编出来的数字
  const chain: { k: Editing | 'smoke'; label: string }[] = [
    { k: 'provider', label: '服务商' },
    { k: 'key', label: '密钥' },
    { k: 'model', label: '模型' },
    { k: 'smoke', label: '试一句' }
  ]
  const atChain: (Editing | 'smoke') | null =
    busy.k === 'smoke' || busy.k === 'smoke-failed' || busy.k === 'done'
      ? 'smoke'
      : editing ??
        (step?.k === 'provider' ? 'provider' : step?.k === 'key' ? 'key' : step?.k === 'model' ? 'model' : null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = models ?? []
    if (!q) return all
    return all.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
  }, [models, query])

  /** 走不通 / 柜子没建 / 柜子锁着这三步是**闸门**：它们不成立时后面每一步都做不成。
   *  单独摘出来是因为它们必须压过用户的覆盖位 —— 否则柜子在他去申请 key 的路上
   *  自动锁了，回来点「改 key」还能填，填完点保存才撞上锁定，白填一遍。 */
  const gate =
    step && (step.k === 'blocked' || step.k === 'vault-setup' || step.k === 'vault-unlock')
      ? step.k
      : null

  /** 该画哪一屏。顺序：**临时态 → 闸门 → 覆盖位 → 判据**。
   *
   *  临时态排最前的理由：冒烟跑着跑着事实一变（比如柜子到点自动锁了），
   *  正在跑的那一屏会被换掉，用户以为自己的测试凭空消失了。让它跑完再说 ——
   *  失败分类那一步会重新拉事实，该打回哪就打回哪。 */
  const shown: OmpStep['k'] | 'busy' | 'smoke' | 'smoke-failed' | 'done' =
    busy.k !== 'idle' ? busy.k : gate ?? editing ?? step?.k ?? 'blocked'

  const body = (
    <div
      className="ac-setup-mask"
      onMouseDown={(e) => {
        // **忙的时候点遮罩不关。** 那一下会取消一次已经在跑的冒烟，而点空白处
        // 通常是无意的。要放弃就点右上角那个 ×（那是明确动作）
        if (e.target === e.currentTarget && !working) close()
      }}
    >
      <div className="ac-setup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ac-login-head">
          <span className="ac-login-title">设置 {cli.displayName}</span>
          <span className="ac-setup-head-r">
            <button type="button" className="ac-login-x" onClick={close} aria-label="关闭">
              ×
            </button>
          </span>
        </div>

        {/* 一条链，不是四个各自弹一次的面板 —— 约束 ① */}
        {step && step.k !== 'blocked' && step.k !== 'vault-setup' && step.k !== 'vault-unlock' && (
          <div className="ac-omp-chain">
            {chain.map((c, i) => (
              <span key={c.k} className={`ac-omp-chain-i${c.k === atChain ? ' on' : ''}`}>
                {i > 0 && <i className="ac-omp-chain-sep">→</i>}
                {c.label}
              </span>
            ))}
          </div>
        )}

        {err && <div className="ac-login-err ac-setup-err">{err}</div>}

        {/* ── 读事实中。**不说「加载中…」以外的话** ── */}
        {!step && <div className="ac-login-step">正在看这台机器上的情况…</div>}

        {/* ── 走不通：一句实话，没有假出口 ─────────────────────────────────
            摆一颗点了没反应的按钮，比明说「这条路走不通」更糟 */}
        {shown === 'blocked' && step?.k === 'blocked' && (
          <div className="ac-setup-say">
            {step.why === 'no-binary' && (
              <>
                这个安装包里没带上 <b>{cli.displayName}</b> 的程序本体。
                这多半是安装包坏了 —— 重新下载一次能解决。
              </>
            )}
            {step.why === 'no-encryption' && (
              <>
                这台机器的系统加密不可用（macOS 看钥匙串，Windows 看系统凭据），
                <b>密钥没法安全存下来</b>。在修好之前这条路走不通 —— 不会把你的 key 明文落盘。
              </>
            )}
            {step.why === 'foreign-vault' && (
              <>
                密钥柜是**另一台机器 / 另一个 app** 写的，这台机器解不开它。
                先在密钥面板里处理掉那份，再回来。
              </>
            )}
          </div>
        )}

        {/* ── 柜子：建 / 解锁 ────────────────────────────────────────────────
            **排在选服务商与填 key 之前**（nextStepOf 的顺序）：反过来的话，
            用户填完点保存才撞上锁定，白填一遍 */}
        {(shown === 'vault-setup' || shown === 'vault-unlock') && vault && (
          <>
            <div className="ac-setup-say">
              <LockIcon size={12} />{' '}
              {shown === 'vault-setup' ? (
                <>
                  这把 key 要存进<b>密钥柜</b>。先设一个六位码 ——
                  它只用来确认「是你本人在操作」，<b>不参与加密</b>，真正的保护交给系统钥匙串。
                </>
              ) : (
                <>
                  密钥柜锁着。<b>15 分钟没操作会自动锁上</b> —— 你填的东西还在，解锁就接着走。
                </>
              )}
            </div>
            <div className="ac-omp-row">
              <input
                className="ac-login-input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                placeholder="······"
                value={code}
                disabled={!vault.available || vault.lockedOutMs > 0}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.length === 6) void submitCode()
                }}
                autoFocus
              />
              <button
                type="button"
                className="ac-login-submit"
                disabled={code.length !== 6 || !vault.available || vault.lockedOutMs > 0}
                onClick={() => void submitCode()}
              >
                {shown === 'vault-setup' ? '启用' : '解锁'}
              </button>
            </div>
            {vault.lockedOutMs > 0 && (
              <div className="ac-login-hint">
                错太多次了，等 {Math.ceil(vault.lockedOutMs / 1000)} 秒再试。
              </div>
            )}
          </>
        )}

        {/* ── 选服务商 ─────────────────────────────────────────────────────
            清单写死在 shared/ompSetup.ts：omp 认识几十家，一股脑摆出来
            对第一次配置的人是灾难。这几家是「填一把 key 就能用」的那批 */}
        {shown === 'provider' && (
          <>
            <div className="ac-setup-say">
              <b>{cli.displayName}</b> 不用登录账号，它<b>借你自己的一把 API key 说话</b>。
              先挑一家你有账号的。
            </div>
            <div className="ac-omp-list">
              {OMP_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`ac-omp-item${p.id === omp?.provider ? ' on' : ''}`}
                  onClick={() => void pickProvider(p.id)}
                >
                  <span className="ac-omp-item-l">{p.label}</span>
                  {p.id === omp?.provider && <CheckIcon size={12} />}
                </button>
              ))}
            </div>
            {editing === 'provider' && (
              <div className="ac-setup-row">
                <button type="button" className="ac-login-retry" onClick={() => setEditing(null)}>
                  算了，不换
                </button>
              </div>
            )}
          </>
        )}

        {/* ── 填 key ──────────────────────────────────────────────────────── */}
        {shown === 'key' && provider && (
          <>
            <div className="ac-setup-say">
              把 <b>{provider.label}</b> 的 API key 填进来。它<b>只进这个模型进程</b> ——
              不会跟着你新开的终端跑（那样在终端里随手一句 <code>env</code> 就把它打出来了）。
            </div>
            <div className="ac-setup-cmd-l">
              还没有 key？
              <button
                type="button"
                className="ac-omp-link"
                onClick={() => void window.api.shell.openExternal(provider.keyUrl)}
              >
                去 {provider.label} 申请一个
              </button>
            </div>
            <div className="ac-omp-row">
              <input
                className="ac-login-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="粘贴 API key"
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && keyText.trim()) void saveKey()
                }}
                autoFocus
              />
              <button
                type="button"
                className="ac-login-submit"
                disabled={!keyText.trim()}
                onClick={() => void saveKey()}
              >
                存进密钥柜
              </button>
            </div>
            <div className="ac-setup-row">
              <button type="button" className="ac-login-retry" onClick={() => setEditing('provider')}>
                换一家服务商
              </button>
              {editing === 'key' && (
                <button type="button" className="ac-login-retry" onClick={() => setEditing(null)}>
                  算了，不改
                </button>
              )}
            </div>
          </>
        )}

        {/* 兜底：不该发生（nextStepOf 只在选过服务商之后才说 'key'），
            但真发生了要有出口 —— **一片空白的灯箱比任何错误提示都难查** */}
        {shown === 'key' && !provider && (
          <div className="ac-setup-row">
            <button
              type="button"
              className="ac-login-go ac-setup-primary"
              onClick={() => setEditing('provider')}
            >
              先挑一家服务商
            </button>
          </div>
        )}

        {/* ── 选模型 ───────────────────────────────────────────────────────
            清单可能很长（omp 一家服务商就能列出几十个），所以给搜索框 */}
        {shown === 'model' && (
          <>
            <div className="ac-setup-say">
              选一个模型。<b>之后随时能在工具栏里换</b>，这里只是定个起点。
            </div>
            <input
              className="ac-omp-search"
              type="text"
              placeholder="搜模型名"
              value={query}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="ac-omp-list tall">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`ac-omp-item${m.id === omp?.model ? ' on' : ''}`}
                  onClick={() => void pickModel(m.id)}
                >
                  <span className="ac-omp-item-l">{m.label}</span>
                  {m.id !== m.label && <span className="ac-omp-item-s">{m.id}</span>}
                </button>
              ))}
              {models !== null && filtered.length === 0 && (
                <div className="ac-omp-empty">
                  {models.length === 0
                    ? // **不猜原因**：拿不到清单可能是 key 不对、可能是网络，
                      // 这里只说事实，出口给「重来一次」和「回去改 key」
                      '一个模型都没列出来 —— 多半是这把 key 还没通。'
                    : '没有匹配的模型。'}
                </div>
              )}
            </div>
            <div className="ac-setup-row">
              <button type="button" className="ac-login-retry" onClick={() => void loadModels()}>
                重新拉一次
              </button>
              <button type="button" className="ac-login-retry" onClick={() => setEditing('key')}>
                回去改 key
              </button>
              {editing === 'model' && (
                <button type="button" className="ac-login-retry" onClick={() => setEditing(null)}>
                  算了，不换
                </button>
              )}
            </div>
          </>
        )}

        {/* ── 忙着 ─────────────────────────────────────────────────────────
            不确定态的动画条：表示「还在动」，下面那行字才是真信息（约束 ②） */}
        {(shown === 'busy' || shown === 'smoke') && (
          <>
            <div className="ac-setup-bar" role="progressbar" aria-label="正在处理">
              <span className="ac-setup-bar-run" />
            </div>
            <div className="ac-setup-step">
              {busy.k === 'busy' ? busy.what : `正在让它说一句「你好」…`}
            </div>
            {busy.k === 'smoke' && (
              <>
                <div className="ac-login-hint">
                  第一次要起进程、连服务商，可能要等十几秒。最多等 {SMOKE_TIMEOUT_MS / 1000} 秒。
                </div>
                {/* 跑的过程中它已经说了话就先摆出来 —— 卡住时这些是唯一的线索 */}
                {busy.out.length > 0 && <pre className="ac-setup-out">{busy.out.join('\n')}</pre>}
              </>
            )}
          </>
        )}

        {/* ── 试不通：把原话给他看（约束 ③）───────────────────────────────── */}
        {shown === 'smoke-failed' && busy.k === 'smoke-failed' && (
          <>
            <div className="ac-login-err ac-setup-err">
              {busy.auth ? '这把 key 没通过验证。' : '没能跑通。'}
            </div>
            <div className="ac-setup-say">{busy.message}</div>
            {busy.out.length > 0 && (
              <>
                <div className="ac-setup-cmd-l">它自己说的话</div>
                <pre className="ac-setup-out">{busy.out.join('\n')}</pre>
              </>
            )}
            <div className="ac-setup-row">
              {/* 认出是 key 的问题才给这颗按钮。认不出时给它，等于建议用户
                  去改一把其实没问题的 key */}
              {busy.auth && (
                <button
                  type="button"
                  className="ac-login-go ac-setup-primary"
                  onClick={() => {
                    setBusy({ k: 'idle' })
                    setEditing('key')
                  }}
                >
                  回去改 key
                </button>
              )}
              <button
                type="button"
                className="ac-login-retry"
                onClick={() => {
                  setBusy({ k: 'idle' })
                  void runSmoke()
                }}
              >
                再试一次
              </button>
              <button
                type="button"
                className="ac-login-retry"
                onClick={() => {
                  setBusy({ k: 'idle' })
                  setEditing('model')
                }}
              >
                换个模型
              </button>
              {/* 冒烟没过 ≠ 配置没存下来。**如实回 false** —— 上游据此决定
                  要不要在对话框里继续摆设置入口，谎报成功只会让人在下一屏再撞一次 */}
              <button type="button" className="ac-login-retry" onClick={() => onDone(false)}>
                先这样，我自己再看
              </button>
            </div>
          </>
        )}

        {/* ── 成了 ─────────────────────────────────────────────────────────── */}
        {(shown === 'done' || shown === 'ready') && (
          <>
            <div className="ac-login-ok">
              <CheckIcon size={13} />
              {cli.displayName} 已经可以用了
              {provider ? ` · ${provider.label}` : ''}
              {omp?.model ? ` · ${omp.model}` : ''}
            </div>
            {/* 上一次试的结果如实摆着。**没试过就说没试过，不假装 ok** */}
            <div className="ac-omp-meta">
              {omp?.lastSmoke
                ? omp.lastSmoke.ok
                  ? `上次试过：能回话（${new Date(omp.lastSmoke.at).toLocaleString()}）`
                  : `上次试过：没跑通 —— ${omp.lastSmoke.message ?? '没留下原话'}`
                : '还没试过它能不能回话。'}
            </div>
            {keyHolder?.shared && (
              <div className="ac-omp-meta">
                这个变量名早就在你的「{keyHolder.name}」那一条里了 ——
                <b>只更新了它的值</b>，那一组的其他变量和自动注入开关都没动。
              </div>
            )}
            <div className="ac-setup-row">
              <button
                type="button"
                className="ac-login-go ac-setup-primary"
                onClick={() => onDone(true)}
              >
                开始用
              </button>
              <button type="button" className="ac-login-retry" onClick={() => void runSmoke()}>
                再试一句
              </button>
            </div>
            <div className="ac-setup-row">
              <button type="button" className="ac-login-retry" onClick={() => setEditing('model')}>
                换模型
              </button>
              <button type="button" className="ac-login-retry" onClick={() => setEditing('key')}>
                <KeyIcon size={11} /> 改 key
              </button>
              <button type="button" className="ac-login-retry" onClick={() => setEditing('provider')}>
                换服务商
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  // portal 到 body：灯箱要盖住整个窗口，就不能待在画布节点那棵子树里
  // （节点的 overflow 和层级会把它裁掉）
  return createPortal(body, document.body)
}
