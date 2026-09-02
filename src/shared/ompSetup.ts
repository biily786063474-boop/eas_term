// 引导面板的**判据**：下一步该让用户做什么、冒烟失败算哪一类、有哪些服务商可选。
//
// 全是纯函数与常量，零 IO、零 electron —— 面板与主进程两侧照同一份说话。
// 提出来的理由：这个状态机有七个分支，**每个分支对应用户要做的一件不同的事**，
// 合并任意两条都会把人引错方向（最典型的是「柜子锁着」被当成「还没填 key」，
// 用户会去改一把其实好好的 key）。埋在组件里这种错没人测得到。
//
// ── 为什么在 `shared/` 而不是 `main/agentChat/omp/` ────────────────────────
// 上面那句「两侧照同一份说话」原来做不到：`tsconfig.web.json` 只 include
// `src/renderer/src` 与 `src/shared`，而 composite 工程要求列全文件 ——
// 渲染层 import `main/agentChat/omp/setupModel.ts` 直接 TS6307。
// 就算放宽 include 也还有第二道：它 import 的 `omp/config.ts` 带着 `node:path`，
// 会被打进渲染层的 bundle。
//
// 所以判据搬到 shared，`main/agentChat/omp/setupModel.ts` 退化成再导出的壳
// （那边额外持有 `keyVarOf` —— 它要 `config.ts` 的 `ompKeyEnvName`，
// 是唯一不能跟过来的一个，渲染层也不需要：变量名走 `omp:keyVar` 这条 IPC 拿）。

/** 一家模型服务商。**清单写死在这里**，不从 omp 那边动态拉：
 *  omp 认识几十家，一股脑摆出来对第一次配置的人是灾难；
 *  而这几家是「填一把 key 就能用」的那批。要加就在这里加。 */

// ── 2026-09-02：**密钥柜那条路整条删掉了** ─────────────────────────────────
//
// 用户原话：「取消密钥柜的概念呢，单纯用 oh my pi 成熟的登录流程然后 UI 化。」
//
// 他是对的，而且这不是口味问题 —— 我们原来维护着**一套和 omp 平行的凭证系统**：
// 密钥柜存 key、spawn 时注环境变量、`models.yml` 里写 `apiKey: EAS_OMP_<ID>_KEY`。
// 而 omp 的 `auth-broker` 早就把这件事做完了，**69 家**（含 DeepSeek、Moonshot、
// Qwen、两个 MiniMax、本地 Ollama / LM Studio）都能 `auth-broker login`，
// 需要 API key 的那些它自己会问、自己存进 `agent.db`、自己续期。
//
// 平行系统的代价这一天全兑现了，每一个 bug 都长在接缝上：
//   · `models.yml` 里的 apiKey **压过** broker 的凭证 → 登录成功却 401
//   · `authMode` 是我们自己记的一个选择 → 保存模型时忘了带，**静默翻转成 apikey**，
//     于是订阅用户被要求去填一把他根本没有的 key（用户截图实拍）
//   · `loggedInAt` 写下去就永远为真 → 面板说「配好了」，一试就翻车
//   · 闸门把 `EAS_OMP_MINIMAX_CODE_CN_KEY` 摆到用户脸上
//
// 现在只剩一条路：**选一家 → 用 omp 自己的登录流程登进去 → 选模型**。
// 没有 authMode、没有密钥柜、没有环境变量注入，`models.yml` 恒为 `providers: {}`。
// 少一套账本，就少一整类「账本和现实对不上」的 bug。

/** 引导面板停在哪一步。**顺序即依赖**：前一步没完成，后一步无从谈起。 */
export type OmpStep =
  /** 随包的二进制不在 —— 用户什么也做不了，只能报修 */
  | { k: 'blocked'; why: 'no-binary' }
  /** 还没选服务商 */
  | { k: 'provider' }
  /** 选了，但 omp 还没有这家的凭证 —— 走它自己的 `auth-broker login` */
  | { k: 'login' }
  /** 登进去了，还没挑模型 */
  | { k: 'model' }
  /** 齐了 */
  | { k: 'ready' }

export interface OmpSetupState {
  /** 随包的二进制在不在 */
  installed: boolean
  provider?: string
  /** **omp 认不认这家**。判据是它列不列得出这家的模型，见 `ompLoggedInFrom` */
  loggedIn: boolean
  /** 选中的模型。**值是 `<provider>/<model>`**（omp 按 selector 认模型，
   *  裸名字它解析不到 provider —— 2026-09-02 那个 1004 就是这么来的） */
  model?: string
}

/** 一次冒烟的结果。 */
export interface OmpSmokeResult {
  ok: boolean
  at: number
  message?: string
}

/** `omp:status` 回什么。**两侧共用这一份，别在渲染层手抄。**
 *
 *  手抄那份漏过 `loggedIn`，代价是订阅用户完全走不通（2026-09-02 真机）。
 *  放在这里，再漏字段就是一个编译错误而不是一个「只在真机上出现」的 bug。 */
export interface OmpStatus {
  installed: boolean
  /** 主进程按它知道的事实算出来的下一步 */
  step: OmpStep
  provider?: string
  /** omp 有没有这家的凭证 */
  loggedIn: boolean
  model?: string
  lastSmoke?: OmpSmokeResult
}

/** 「omp 认不认这家」——**判据是问 omp，不是查我们自己的账本**。
 *
 *  2026-09-02 用户撞到的那一屏：面板说「配好了」，一点「试一句」就回
 *  「还没配好模型服务商」。根因是整条链路只读我们的账本，而权威在 omp 那边
 *  （凭证在 `agent.db`）。而写下去的记录**永远为真** —— 凭证会过期、会被吊销、
 *  会因为换了配置目录读不到，账本一概不知道。
 *
 *  判据换成：**omp 列不列得出这家的模型**。没凭证时
 *  `omp models ls --json` 回 `{"models":[]}`（18.1.2 实测，约 0.55s）。
 *
 *  这个判据现在**无条件成立**：`models.yml` 恒为 `providers: {}`，
 *  所以列出来的每一家都只可能来自 broker 里那份真凭证。
 *  （拆掉密钥柜之前它有个坑：models.yml 里声明过的 provider 零凭证也照列，
 *  于是那条路上它恒为真 —— 现在那条路没了，坑也跟着没了。）
 *
 *  **`models` 为 `undefined` 表示「没探到」，不是「空清单」** —— 二进制起不来、
 *  超时，这时退回我们自己的记录：探不到就把人锁在门外，是拿一次探测失败
 *  去否定一件他明明做过的事。 */
export function ompLoggedInFrom(i: {
  /** omp 报的模型清单。`undefined` = 探测失败（≠ 空清单） */
  models?: { id: string }[]
  providerId?: string
  /** 我们自己记的「登录过」。**只在探测失败时**当兜底 */
  hint: boolean
}): boolean {
  if (!i.providerId) return false
  if (!i.models) return i.hint
  const prefix = `${i.providerId}/`
  return i.models.some((m) => m.id.startsWith(prefix))
}

/** 存下来的那个模型，omp 现在还认吗。
 *
 *  换过套餐、模型下架、或者存的是上一家的 —— 留着它的后果是起会话时
 *  omp 解析不到，报一句跟「模型」毫无关系的错，而界面上模型明明选着。
 *
 *  **探不到（`undefined`）时不判它坏**：探不到 ≠ 不存在。 */
export function ompModelUsable(models: { id: string }[] | undefined, model: string | undefined): boolean {
  if (!model) return false
  if (!models) return true
  return models.some((m) => m.id === model)
}

/** 把主进程报的配置拼成 `nextStepOf` 的入参。
 *
 *  **单独摘成纯函数**：判据搬到 shared 本来就是为了「两侧照同一份说话」，
 *  但入参曾经是两侧各自拼的 —— 渲染层那份漏了字段，判据一致、入参分叉，
 *  单测全绿而真机全错（2026-09-02）。所以入参也只许在这里拼一次。 */
export function ompStateFrom(i: {
  installed: boolean
  provider?: string
  loggedIn: boolean
  model?: string
}): OmpSetupState {
  return { installed: i.installed, provider: i.provider, loggedIn: i.loggedIn, model: i.model }
}

/**
 * 下一步。**顺序不是随意排的**：
 * · 二进制不在排最前 —— 它之后的每一步都做不成。
 * · 「选模型」排在「登录」之后：模型清单要 omp 认了这家才拿得到。
 */
export function nextStepOf(s: OmpSetupState): OmpStep {
  if (!s.installed) return { k: 'blocked', why: 'no-binary' }
  if (!s.provider) return { k: 'provider' }
  if (!s.loggedIn) return { k: 'login' }
  if (!s.model) return { k: 'model' }
  return { k: 'ready' }
}

/** 起进程之前那道闸。
 *
 *  **只剩一条判据了。** 拆掉密钥柜之后，凭证在不在、过没过期，全是 omp 自己的事 ——
 *  它比我们清楚，报的话也比我们编的准。我们唯一还该拦的是「压根没选服务商」，
 *  因为那时候连起哪一家都不知道。
 *
 *  纯函数：`launch.ts` 那边要 electron，判据放在这里才测得到。 */
export function ompLaunchGate(i: { provider?: string }): { ok: true } | { ok: false; reason: 'no-provider'; message: string } {
  if (!i.provider) {
    return { ok: false, reason: 'no-provider', message: '还没选模型服务商，先在设置里选一家。' }
  }
  return { ok: true }
}

const AUTH_RE = /\b401\b|unauthori[sz]ed|invalid[ _-]?api[ _-]?key|incorrect api key|authentication[_ ]error|api key not valid/i

export function authFailureInTail(lines: string[]): 'auth' | 'unknown' {
  return lines.some((l) => AUTH_RE.test(l)) ? 'auth' : 'unknown'
}

/** 连不上。**必须和「key 不对」分开** —— 把网络故障说成 key 错，
 *  用户会去反复更换一把其实好好的密钥。 */
const NET_RE =
  /econnrefused|enotfound|etimedout|eai_again|econnreset|network|fetch failed|timeout|timed out|socket hang up|certificate|proxy/i
/** 他自己取消的。不当成错误吓唬他。 */
const CANCEL_RE = /cancell?ed|aborted|interrupted|sigint/i
/** 额度 / 频率。**下一步跟 key 不对完全不同**：key 没问题，是账上没钱或太频繁了。 */
const QUOTA_RE =
  /\b429\b|quota|rate[ _-]?limit|too many requests|insufficient|credit|balance|billing|exceeded your/i
/** 模型名用不了。换个模型就行，跟凭证无关。 */
const MODEL_RE = /model[^\n]{0,40}(not found|not exist|unavailable|not support|unknown|invalid)|\bno such model\b/i

/** 失败要怎么跟用户说。
 *
 *  **一句人话 + 一个明确的下一步。**
 *  用户 2026-09-02 的原话：「不要让用户在软件中看到开发者看的东西。」
 *  折叠起来让他自己展开也算 —— 那还是把终端输出摆在了他面前，
 *  而且「要不要展开」这个选择本身就是在让他替我们做分类。
 *
 *  同一天他又说：「登录未完成的时候用户并不知道是什么原因。」
 *  **这两句不矛盾。** 矛盾的是「倒一整段」和「一个字都不说」这两个极端 ——
 *  服务商自己那句错误描述是**原因**，堆栈帧、源码回显、JSON 才是日志。
 *  所以：分类给一句结论（`title`），再从输出里摘一句原因（`detail`）。
 */
export interface OmpLoginFailure {
  /** 一句话说清哪儿不对。**不含任何原始输出** */
  title: string
  /** 可选的一句补充，告诉他接下来能做什么 */
  hint?: string
  /** 从输出里摘出来的**一句**原因原话（已清洗：没有堆栈、没有 JSON、没有路径）。
   *  摘不到就没有 —— 宁可不说，也不胡说。 */
  detail?: string
  /** 界面该把他送回哪一步。`input` = 回到那个输入框重填；`retry` = 从头再试一次 */
  retry: 'input' | 'retry'
}

/** 这一屏是在做什么。**同一段输出，两种上下文要说两种话** ——
 *  用户点的是「试一句」，界面却回他「登录没有完成」，他会以为自己漏了一步登录。
 *  2026-09-02 截图实拍到过。 */
export type OmpFailContext = 'login' | 'smoke'

/** 一行里长得像日志的部分。摘原因时要把它们剔掉。 */
const NOISE_LINE =
  /^\d+ \||^\^+$|^\s*at \S+ \(|\$bunfs|^\s*[[\]{}]|^[\w-]+:\s*[["{]|^\s*(status|headers|code|stack)\s*[:=]/i
/** 值得当「原因」的那种句子。 */
const REASON_HINT = /error|fail|refus|invalid|unauthor|denied|not found|missing|timeout|expire|quota|limit/i

/** 从一段输出里摘出**一句能给人看的原因**。摘不到就回 undefined。
 *
 *  只做减法，不做改写：去掉异常类名前缀、切掉后面那坨 JSON、剔掉堆栈行。
 *  剩下的是对方自己说的那句话 —— 那是原因，不是日志。 */
export function humanReasonIn(lines: string[]): string | undefined {
  for (const raw of lines) {
    let t = raw.trim()
    if (!t || NOISE_LINE.test(t)) continue
    if (!REASON_HINT.test(t)) continue
    // 切掉 JSON / 对象那一坨（`…: {"type":"error"}`、`… { status: 401 }`）
    const brace = t.search(/[{[]/)
    if (brace >= 0) t = t.slice(0, brace).trim().replace(/[:：,，]\s*$/, '')
    // 去掉异常类名前缀：`ProviderHttpError: xxx` → `xxx`。类名是给开发者的。
    t = t.replace(/^[\w.$]*(?:Error|Exception|Failure)\s*:\s*/i, '').trim()
    // 去掉行首的 `Error:` 之类残留与多余空白
    t = t.replace(/\s+/g, ' ').trim()
    if (!t || NOISE_LINE.test(t)) continue
    // 一行放不下就不是「一句话」了 —— 那种多半是被塞进来的结构化数据
    if (t.length > 140) continue
    return t
  }
  return undefined
}

/** 两种上下文各自的兜底说法。 */
const FALLBACK: Record<OmpFailContext, { title: string; hint: string }> = {
  login: { title: '登录没有完成', hint: '可以再试一次。' },
  smoke: { title: '这一句没能跑通', hint: '可以再试一次，或者换个模型。' }
}

export function explainOmpFailure(i: {
  ctx: OmpFailContext
  lines: string[]
  error?: string
  /** 这句 `error` 是**我们自己写的**（`ChatEvent` 的 `kind: 'setup'`、闸门的 message、
   *  超时那句…）。**它已经是给用户看的中文，原样透出，不许再进分类器。**
   *
   *  这条是 2026-09-02 那一屏的正主：闸门明明说了「密钥柜里还没有
   *  EAS_OMP_MINIMAX_CODE_CN_KEY，先在设置里填」，却被兜底成「登录没有完成」。
   *  分类器是为了翻译 omp 的英文而写的，把我们自己的话也喂进去，就是自己盖掉自己。 */
  ours?: boolean
}): OmpLoginFailure {
  const { ctx, lines, error, ours } = i
  if (ours && error?.trim()) {
    // 送他回上一步去补，而不是「再试一次」—— 这类错重试一百遍也还是那样。
    return { title: error.trim(), retry: 'input' }
  }
  const hay = [...lines, error ?? ''].join('\n')
  const detail = humanReasonIn([...lines, ...(error ? [error] : [])])
  if (AUTH_RE.test(hay)) {
    return {
      title: ctx === 'login' ? '这把密钥不对' : '模型服务商拒绝了这把密钥',
      hint: '对方拒绝了它。回去检查一下有没有复制全、或者是不是过期了。',
      detail,
      retry: 'input'
    }
  }
  if (NET_RE.test(hay)) {
    return { title: '连不上这家服务商', hint: '检查一下网络（或代理），然后再试一次。', detail, retry: 'retry' }
  }
  if (QUOTA_RE.test(hay)) {
    return {
      title: '这个账号的额度不够了',
      hint: '对方按额度拒绝了这次请求。去服务商那边看一眼余额或套餐。',
      detail,
      retry: 'retry'
    }
  }
  if (MODEL_RE.test(hay)) {
    return { title: '这个模型用不了', hint: '换一个模型再试 —— 你的账号可能没开通它。', detail, retry: 'retry' }
  }
  if (CANCEL_RE.test(hay)) {
    return { title: ctx === 'login' ? '登录取消了' : '试的这一句被中断了', detail, retry: 'retry' }
  }
  const f = FALLBACK[ctx]
  return {
    title: f.title,
    // 摘得到原因就把原因给他；摘不到才说那句「告诉我们你选的是哪一家」。
    hint: detail ? f.hint : `${f.hint}如果一直不行，告诉我们你选的是哪一家。`,
    detail,
    retry: 'retry'
  }
}
