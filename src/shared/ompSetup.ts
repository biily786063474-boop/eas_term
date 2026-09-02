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
export interface OmpProvider {
  /** 与 `models.yml` 里的键、以及 `EAS_OMP_<ID>_KEY` 的中段一致。
   *  **只允许小写字母数字与横线** —— 它会被拼进环境变量名与文件路径。 */
  id: string
  label: string
  /** 去哪儿弄这把 key。没有这个字段，用户拿到一个输入框却不知道去哪申请 */
  keyUrl: string
  /** omp 自己认识这家（内置 provider）。
   *  内置的**只写 apiKey、不写 models 数组** —— 上游 `models-config.ts:44-96` 规定
   *  「列了 models 就必须给 baseUrl」，而内置的用的是 omp 自带模型表，
   *  硬写会让整份 models.yml 校验失败、provider 一个都注册不上。 */
  builtin: boolean
}

export const OMP_PROVIDERS: OmpProvider[] = [
  { id: 'anthropic', label: 'Anthropic（Claude）', keyUrl: 'https://console.anthropic.com/settings/keys', builtin: true },
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', builtin: true },
  // omp 内置的智谱叫 zai（`ZAI_API_KEY`），也是唯一在 18.x 上真跑通过的那家
  { id: 'zai', label: '智谱 GLM', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', builtin: true },
  { id: 'deepseek', label: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys', builtin: true }
]

export function providerById(id: string | undefined): OmpProvider | undefined {
  return OMP_PROVIDERS.find((p) => p.id === id)
}

/** 面板此刻该停在哪一步。 */
export type OmpStep =
  /** 什么都做不了：包里没二进制、系统加密不可用、或柜子是别人机器上的 */
  | { k: 'blocked'; why: 'no-binary' | 'no-encryption' | 'foreign-vault' }
  | { k: 'vault-setup' }
  /** 订阅那条路：去 omp 那边跑一次 OAuth 登录 */
  | { k: 'login' }
  | { k: 'vault-unlock' }
  | { k: 'provider' }
  | { k: 'key' }
  | { k: 'model' }
  | { k: 'ready' }

export interface OmpSetupState {
  /** 随包的二进制在不在 */
  installed: boolean
  vault: { available: boolean; configured: boolean; locked: boolean; foreign: boolean }
  provider?: string
  /** **怎么连上这家服务商。两条并列的路，判据完全不同。**
   *
   *  · `'subscription'` —— 用已经买了的订阅登录（Claude Pro/Max、ChatGPT Plus/Pro、
   *    智谱 GLM Coding Plan、Kimi、Copilot…）。凭证是 OAuth 令牌，**要能刷新**，
   *    所以存在 omp 自己的 `agent.db` 里由它管，不进我们的密钥柜。
   *  · `'apikey'` —— 填一把 key。进密钥柜，起会话时按变量名注入。
   *
   *  不分开的话，订阅用户会卡在「还没填 key」那一步 —— 而他压根没有 key 可填，
   *  也不该被逼着去申请一把。 */
  authMode?: 'subscription' | 'apikey'
  /** 这家的 key 已经在柜里（`secretsHas` 说 inVault && readable）。只对 `'apikey'` 有意义 */
  keyInVault: boolean
  /** 订阅登录成功过。只对 `'subscription'` 有意义 */
  loggedIn?: boolean
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
 *  手抄那份漏过 `loggedIn`，而漏掉的代价是订阅用户完全走不通
 *  （2026-09-02 真机）。抄一份就有了第二份，迟早分叉；放在这里，
 *  再漏字段就是一个编译错误而不是一个「只在真机上出现」的 bug。 */
export interface OmpStatus {
  installed: boolean
  status: { loggedIn: boolean; account?: string }
  /** 主进程按它知道的事实算出来的下一步。**渲染层还会用柜子的真实状态重算一次** */
  step: OmpStep
  /** 带「去哪儿取 key」链接的推荐几家。**不是全集** ——
   *  订阅登录那条路的全名单走 `omp:listAuthProviders`（70 家，由 omp 自己报）。 */
  providers: { id: string; label: string; keyUrl: string }[]
  provider?: string
  /** 上次是用订阅还是填 key 配的。**两条路的判据完全不同** */
  authMode?: 'subscription' | 'apikey'
  /** 订阅登录**成功过**。只对 `'subscription'` 有意义。
   *  **必须上线**：渲染层要自己算一次 `nextStepOf`，缺了它订阅用户永远停在「还没登录」。 */
  loggedIn: boolean
  model?: string
  lastSmoke?: OmpSmokeResult
}

/** 「真的登录上了吗」——**判据是问 omp，不是查我们自己的账本**。
 *
 *  2026-09-02 用户撞到的那一屏：面板说「配好了」，一点「试一句」就回
 *  「还没配好模型服务商」。查下来是结构问题而不是某行写错 ——
 *  `omp-setup.json` 是我们自己记的一套（provider / authMode / loggedInAt / model），
 *  真正的权威在 omp 那边（broker 凭证在 `agent.db`）。**整条链路只读账本**，
 *  只有最后 `session/new` 那一下读现实，两者一分叉用户就被打脸。
 *
 *  而 `loggedInAt` 是一条**写下去就永远为真**的记录 —— 凭证会过期、会被吊销、
 *  会因为换了配置目录读不到，它一概不知道。（立档里「标记永久为真」那条老教训
 *  是同一个形状。）
 *
 *  所以判据换成：**omp 列不列得出这家的模型**。没凭证时
 *  `omp models ls --json` 回 `{"models":[]}`（18.1.2 实测，约 0.55s）。
 *
 *  ── **只对订阅那条路成立，这是硬边界** ──────────────────────────────────
 *  同一天实测：**只要 provider 在 `models.yml` 里被声明过，哪怕一条凭证都没有，
 *  `models ls` 照样把它的模型全列出来**（跟有凭证时一模一样）。
 *
 *    零凭证 ＋ 空 models.yml         → `{"models":[]}`
 *    零凭证 ＋ models.yml 声明了这家  → 9 个模型
 *
 *  所以「列得出」只证明「配置里有这家」，不证明「认证得了」——
 *  它只在 `providers: {}` 时才是认证凭据，而那恰好只有订阅那条路
 *  （填 key 那条我们会把 provider 连同 apiKey 变量名一起写进 models.yml）。
 *  **`nextStepOf` 的 apikey 分支因此一个字都不看 `loggedIn`**，只看 `keyInVault`。
 *  拿它去判填 key 那条路，会得到一个「永远说已登录」的判据 —— 比没有判据更糟。
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

/** 把「主进程报的配置」与「渲染层查到的密钥柜状态」拼成 `nextStepOf` 的入参。
 *
 *  **单独摘成纯函数，是因为这一步已经错过一次，而且错法很隐蔽。**
 *  判据（`nextStepOf`）搬到 shared 本来就是为了「两侧照同一份说话」，
 *  但**入参是两侧各自拼的** —— 渲染层那份漏了 `authMode` 与 `loggedIn`，
 *  于是订阅这条路在渲染层永远走 apikey 分支：登录成功也被判成「还没填 key」，
 *  而那一屏又渲染不出来（订阅那些 id 不在我们四家的推荐清单里），
 *  落到兜底按钮上 —— 用户看到的是「先挑一家服务商」。
 *  两侧的判据一致、入参不一致，比判据本身写错更难查：单测全绿，真机全错。
 *  2026-09-02 真机撞到，用户原话：「跳回到了一个设置的最初页面…很疑惑。」
 *
 *  所以入参也只许在这里拼一次。 */
export function ompStateFrom(i: {
  installed: boolean
  provider?: string
  authMode?: 'subscription' | 'apikey'
  /** 订阅登录成功过。**必须传** —— 漏了它订阅用户永远停在「还没登录」 */
  loggedIn?: boolean
  model?: string
  vault: OmpSetupState['vault']
  keyInVault: boolean
}): OmpSetupState {
  return {
    installed: i.installed,
    vault: i.vault,
    provider: i.provider,
    authMode: i.authMode,
    keyInVault: i.keyInVault,
    loggedIn: i.loggedIn,
    model: i.model
  }
}

/**
 * 下一步。**顺序不是随意排的**，每一条都有理由：
 *
 * · 三种 blocked 排最前 —— 它们之后的每一步都做不成，先让用户看到一句实话
 *   比让他填到一半才被打回强。
 * · **「柜子锁着」排在「选 provider / 填 key」之前**：反过来的话，用户填完点保存
 *   才撞上锁定，白填一遍。而柜子 15 分钟不动会自动锁 —— 去找一趟 key 回来正好赶上。
 * · 「选模型」排在「填 key」之后：模型清单要起一次 omp 才拿得到，没 key 拿不到。
 */
export function nextStepOf(s: OmpSetupState): OmpStep {
  if (!s.installed) return { k: 'blocked', why: 'no-binary' }
  // **订阅那条路整条绕开密钥柜。** 它的凭证是 OAuth 令牌，存在 omp 的 agent.db 里
  // 由它自己刷新 —— 拿柜子锁没锁去拦订阅登录，是把两条无关的路绑在了一起
  // （用户会看到「密钥柜锁着」，而他要做的事跟密钥柜毫无关系）。
  if (s.authMode === 'subscription') {
    if (!s.provider) return { k: 'provider' }
    if (!s.loggedIn) return { k: 'login' }
    if (!s.model) return { k: 'model' }
    return { k: 'ready' }
  }
  if (!s.vault.available) return { k: 'blocked', why: 'no-encryption' }
  if (s.vault.foreign) return { k: 'blocked', why: 'foreign-vault' }
  if (!s.vault.configured) return { k: 'vault-setup' }
  if (s.vault.locked) return { k: 'vault-unlock' }
  if (!s.provider) return { k: 'provider' }
  if (!s.keyInVault) return { k: 'key' }
  if (!s.model) return { k: 'model' }
  return { k: 'ready' }
}

/** 起进程之前那道闸：现在到底能不能起。
 *
 *  **两条路的判据完全不同**，所以判断在这里做一次、`launch.ts` 照做：
 *  · 订阅 —— 凭证在 omp 的 agent.db 里，我们检查不了也不该检查，直接放行；
 *    真没登录的话它自己会报，那句话比我们编的准。
 *  · 填 key —— 三道闸各自对应用户要做的一件**不同**的事，所以原因不能合并成
 *    一句「配置有问题」。
 *
 *  纯函数：`launch.ts` 那边要 electron（密钥柜、MCP 桥），判据放在这里才测得到。 */
export function ompLaunchGate(i: {
  authMode?: 'subscription' | 'apikey'
  provider?: string
  /** 要注入的变量名（填 key 那条路算出来的） */
  keyVarNames: string[]
  /** 那些变量在柜里且解得开 */
  keysReadable: boolean
  /** 柜子现在没锁 */
  vaultUnlocked: boolean
}): { ok: true } | { ok: false; reason: 'no-provider' | 'no-key' | 'vault-locked'; message: string } {
  if (i.authMode === 'subscription') return { ok: true }
  if (!i.provider || i.keyVarNames.length === 0) {
    return { ok: false, reason: 'no-provider', message: '还没选模型服务商，先在设置里选一个。' }
  }
  if (!i.keysReadable) {
    // **不许把变量名写进这句话。** `EAS_OMP_<ID>_KEY` 是我们的实现细节，
    // 用户在界面上从来没见过它，也不需要知道 —— 他要做的事是「把这家的 key 填进去」，
    // 而那件事在面板上有专门一屏。2026-09-02 用户截图里就摆着这么一串全大写名字。
    return { ok: false, reason: 'no-key', message: '还没填这家服务商的 API key。' }
  }
  if (!i.vaultUnlocked) return { ok: false, reason: 'vault-locked', message: '密钥柜锁着，解锁之后才能起会话。' }
  return { ok: true }
}

/** 「key 不对」长什么样。**在错误原文上匹配，不看结构**。
 *
 *  为什么不复用 `cliAuth/detect.ts` 的 `unauthedInLine`：它先用
 *  `"type":"error|turn.failed|result"` 预过滤，而 ACP 的 JSON-RPC 行**没有 `type` 字段**，
 *  所以那条路对 omp 恒不命中 —— 复用的结果是每次都落到 unknown，
 *  用户看到一堆原始报文而不是「这把 key 不对，回去改」。
 *
 *  认不出的一律 `unknown`：把别的故障（网络不通、baseUrl 写错）硬说成「key 不对」，
 *  会让人去反复更换一把其实没问题的 key。 */
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
