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
  /** 这家的 key 已经在柜里（`secretsHas` 说 inVault && readable） */
  keyInVault: boolean
  model?: string
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
  if (!s.vault.available) return { k: 'blocked', why: 'no-encryption' }
  if (s.vault.foreign) return { k: 'blocked', why: 'foreign-vault' }
  if (!s.vault.configured) return { k: 'vault-setup' }
  if (s.vault.locked) return { k: 'vault-unlock' }
  if (!s.provider) return { k: 'provider' }
  if (!s.keyInVault) return { k: 'key' }
  if (!s.model) return { k: 'model' }
  return { k: 'ready' }
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
