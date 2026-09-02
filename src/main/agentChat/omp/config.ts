// omp 的受管配置：**只产内容字符串，不碰磁盘**。落盘（含删旧文件、拷 skill 目录）是
// setup.ts / spawnEnv.ts 的事——这里保持纯函数，才能在 `node --test` 里当值比对，
// 也才不会在测试里意外写到用户真的 `~/.omp`（红线：不动用户自装的 omp）。
//
// 三件事：config.yml 的内容、models.yml 的内容、eas-term skill 副本的 SKILL.md 尾巴。
//
// **为什么是 config.yml 而不是 settings.json**（这条错了会「改了没反应，还查不出来」）：
// omp 的主配置文件名是 `MAIN_CONFIG_FILENAMES = ['config.yml','config.yaml']`
// （omp `utils/src/dirs.ts:27`）。`settings.json` 只在 config.yml **不存在**时被读一次
// （`config/settings.ts:1299-1305` → `#migrateFromLegacy`），读完 deep-merge 进 config.yml
// 并把源文件 `rename` 成 `.bak`（`settings.ts:1613-1621`）。也就是说往 settings.json 里写
// 只生效一次，之后每次重写都是死文件——换 provider、收紧 deny 全部静默无效。
//
// **为什么点分键要拆成嵌套**：omp 读设置走 `getByPath(obj, 'tools.approvalMode'.split('.'))`
// （`settings.ts:165-178`），一层层往下取属性。文件里写一个字面量键 `"tools.approvalMode": …`
// 时 `obj['tools']` 是 undefined，**取不到就用默认值，不报错、不警告** —— 这正是最难发现的
// 那种失效（approvalMode 悄悄退回 `yolo`）。
//
// **代价（已知，非 bug）**：调用方按 P.4 每次 spawn 前整份重写这个文件，omp 自己写进
// config.yml 的任何状态（settings.set 会 `#writeYamlAtomically` 回来）都会被覆盖。
// 这就是文件头那句「手改无效」的另一面。调用方若哪天要保留 omp 的自留地，
// 改成「读回来 + 只覆盖下面这些键」，这个函数的返回值仍是那份权威清单。

import path from 'node:path'

/** omp `models-config-schema-bundle.ts:85-87` 的 ApiSchema，一字不差抄过来。
 *  写错的后果不是忽略，是整个 models.yml 校验失败（provider 一个都注册不上）。 */
export type OmpApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'azure-openai-responses'
  | 'anthropic-messages'
  | 'bedrock-converse-stream'
  | 'google-generative-ai'
  | 'google-gemini-cli'
  | 'google-vertex'

// ── 最小 YAML 序列化器 ─────────────────────────────────────────────────────
//
// **为什么不引 `yaml` 依赖**：主进程新增运行时依赖要过 `01-系统上下文` 那道边界，
// 而这里要序列化的值只有 布尔 / 字符串 / 字符串数组 / 字符串记录 / 对象数组 五种。
// 上游自己也是拿 Bun 内置的 `YAML.stringify` 出这份文件的（`config/config-file.ts:11`），
// 我们只是把同一件事用 40 行做完。
//
// **接受性的判断依据**：omp 解析这份文件用的是 `import { YAML } from "bun"`
// （`settings.ts:31`、`settings.ts:1377`），即 Bun 的 YAML 1.2 解析器。本文件的输出
// 已用同一个解析器实测过（`bun -e 'YAML.parse(...)'`，见 config.test.ts 里那条
// 「用 omp 同款解析器解回来」的用例——有 bun 才跑，没有就跳过）。
//
// **字符串一律走 `JSON.stringify` 双引号**，不用裸标量：
// ① JSON 是 YAML 1.2 的子集，双引号标量的转义规则与 JSON 完全兼容；
// ② Windows 的 agentDir 里有反斜杠 —— 裸写 `C:\Users\x` 无事，但一旦有别的原因要加引号
//    就会变成非法转义序列，索性统一；`JSON.stringify` 会把 `\` 转成 `\\`，这是唯一正确的写法；
// ③ 躲开 `no` / `on` / `1.0` 这类会被当成布尔或数字的裸标量（YAML 的老坑）。
type YamlValue = string | number | boolean | YamlValue[] | { [k: string]: YamlValue | undefined }

/** 只有能安全裸写的键才裸写；provider id 是用户输入的，可能带点、带空格 */
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/

function yamlKey(k: string): string {
  return PLAIN_KEY.test(k) ? k : JSON.stringify(k)
}

function yamlScalar(v: string | number | boolean): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

function isMapping(v: unknown): v is Record<string, YamlValue | undefined> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function emitMapping(obj: Record<string, YamlValue | undefined>, pad: string, out: string[]): void {
  for (const [k, v] of Object.entries(obj)) {
    // undefined 的键**整条不写**——写成 `k: null` 在 omp 那边不是「没配」，
    // 而是「显式配成了 null」，会覆盖掉默认值。
    if (v === undefined) continue
    if (Array.isArray(v)) {
      if (v.length === 0) {
        out.push(`${pad}${yamlKey(k)}: []`)
        continue
      }
      out.push(`${pad}${yamlKey(k)}:`)
      for (const item of v) emitSeqItem(item, `${pad}  `, out)
      continue
    }
    if (isMapping(v)) {
      const before = out.length
      out.push(`${pad}${yamlKey(k)}:`)
      emitMapping(v, `${pad}  `, out)
      // 空映射要写成 `k: {}`：只留一个 `k:` 会被解析成 null，同样是「显式 null」
      if (out.length === before + 1) out[before] = `${pad}${yamlKey(k)}: {}`
      continue
    }
    out.push(`${pad}${yamlKey(k)}: ${yamlScalar(v)}`)
  }
}

function emitSeqItem(item: YamlValue, pad: string, out: string[]): void {
  if (Array.isArray(item)) {
    // 我们的两份配置里不存在数组套数组；真出现了是调用方传错，宁可当场炸
    throw new Error('omp config: 不支持数组套数组')
  }
  if (isMapping(item)) {
    const sub: string[] = []
    emitMapping(item, `${pad}  `, sub)
    if (sub.length === 0) {
      out.push(`${pad}- {}`)
      return
    }
    // 首行提到 `- ` 后面，其余行保持 pad+2 的缩进，正好对齐首行的键
    out.push(`${pad}- ${sub[0].slice(pad.length + 2)}`)
    for (let i = 1; i < sub.length; i++) out.push(sub[i])
    return
  }
  out.push(`${pad}- ${yamlScalar(item)}`)
}

function toYaml(tree: Record<string, YamlValue | undefined>): string {
  const out: string[] = []
  emitMapping(tree, '', out)
  return `${out.join('\n')}\n`
}

// ── config.yml ─────────────────────────────────────────────────────────────

/** 主配置文件名。**顺序即优先级**：`#readExistingMainYaml`（`settings.ts:1515-1528`）
 *  与 extension 发现（`discovery/omp-extension-roots.ts:191-207`）都是命中第一个就 return，
 *  所以只要 config.yml 在，同目录残留的 config.yaml 读都不会被读到。调用方仍建议删掉它
 *  ——理由是「排障时别对着一个永远不生效的文件想半天」，不是它会生效。 */
export const OMP_MAIN_CONFIG_FILENAMES = ['config.yml', 'config.yaml'] as const

/** skill 副本的落点。`skills.customDirectories` 收的是**装着若干 skill 目录的那一层**
 *  （`extensibility/skills.ts:268-280` 对每个条目跑 `scanSkillsFromDir`），
 *  所以配的是 `<agentDir>/skills`，副本本身在它下面一层。 */
export function ompSkillsDir(agentDir: string): string {
  return path.join(agentDir, 'skills')
}

/** eas-term skill 副本的目录（决定 21：整个目录原样拷进来） */
export function ompEasTermSkillDir(agentDir: string): string {
  return path.join(ompSkillsDir(agentDir), 'eas-term')
}

export interface OmpConfigOptions {
  /** 留给 §14.2 第 7 条：万一 `~/.claude/skills/eas-term` 原版赢了，就把它按名字忽略掉。
   *  **默认不写**——上游 `skills.ts:318-334` 明写 customDirectories 的同名 skill
   *  会顶掉 DEFAULT-path provider 的那份（issue #7190），所以正常情况下我们的副本已经赢了。 */
  ignoredSkills?: string[]
}

/** `<agentDir>/config.yml` 的整份内容。
 *
 *  下面每个键都在 omp 18.0.11 的 `config/settings-schema.ts` 里逐个核对过（行号在注释里），
 *  **默认值一并核对**——与默认相同的键仍然显式写，为的是上游改默认时我们不跟着变。 */
export function ompConfigYml(agentDir: string, opts?: OmpConfigOptions): string {
  const ignored = opts?.ignoredSkills?.length ? opts.ignoredSkills : undefined

  const tree: Record<string, YamlValue | undefined> = {
    tools: {
      // schema:4061，默认 **yolo**。`approval.ts:37-41` 的 APPROVAL_MODE_MAX_TIER 是
      // { 'always-ask':'read', write:'write', yolo:'exec' } —— `write` 是「写也自动放行」，
      // 只有 always-ask 才是「读自动、写与执行都问」，才和 Claude 侧要弹卡的粒度一致。
      approvalMode: 'always-ask',
      // schema:4045，默认 {}。`approval.ts:126-153` 按 `tool.name` 查这张表，
      // **不校验是不是 builtin**，且 deny 在每种模式下都先于 mode 判定生效（第二道锁）。
      // 键名就是工具名：`tools/image-gen.ts:1220` 的 `generate_image`、`tools/tts.ts:322` 的 `tts`
      // （注意开关叫 speechgen、工具叫 tts，两者不同名）、`browser` / `computer` 见
      // `tools/builtin-names.ts` 的 BUILTIN_TOOL_NAMES。
      approval: { generate_image: 'deny', browser: 'deny', computer: 'deny', tts: 'deny' },
      // schema:4670，默认 **true**。开着时罕用工具挂在 `xd://` 设备上、经 read/write 转发，
      // 于是「白名单里给了 write」等于给所有已挂载工具开了后门。必须关。
      xdev: false,
    },
    // schema:4270，默认已是 false。显式写，防上游改默认（生图红线）
    generate_image: { enabled: false },
    // schema:4260，默认已是 false。它管的是 tts 工具
    speechgen: { enabled: false },
    // schema:4307，默认已是 false
    computer: { enabled: false },
    // schema:4486，默认 **true** —— 四个里唯一默认开着的，不写就是开着
    browser: { enabled: false },
    // schema:5250，默认 false。不开就没有脱敏：bash 跑一句 `env`，key 明文进会话记录并发给模型。
    // 脱敏按变量名里的 KEY/SECRET/TOKEN 收。（我们自己不再注入任何 key —— 密钥柜那条路已删。）
    secrets: { enabled: true },
    skills: {
      // schema:5194，默认 []
      customDirectories: [ompSkillsDir(agentDir)],
      // schema:5196，默认 []
      ignoredSkills: ignored,
      // `skills.enableClaudeUser`（schema:5182，默认 true）**故意不写**：
      // 用户自己的其他 Claude skill 该照常可见。
    },
    // schema:1813，默认 **true**。这条是真的在改行为：用户选了哪个模型就用哪个，
    // 不许重试时悄悄换成别的模型（换了之后工具栏显示的还是原来那个，账也对不上）。
    retry: { modelFallback: false },
  }

  const header = [
    '# 由 Eas-Term 生成，**每次起 omp 会话前整份重写** —— 手改这里无效，改动会被覆盖。',
    '# 想调这些值请改 src/main/agentChat/omp/config.ts（依据写在那里的注释里）。',
    '',
  ].join('\n')

  return header + toYaml(tree)
}

// ── models.yml ─────────────────────────────────────────────────────────────

export const OMP_MODELS_FILENAME = 'models.yml'

/** `<agentDir>/models.yml` 的整份内容。**它恒为空。**
 *
 *  ── 这个函数为什么不再收 provider ────────────────────────────────────────
 *  它原本能写出 `providers.<id>.apiKey = "EAS_OMP_<ID>_KEY"` —— 那是密钥柜那条路
 *  的产物：我们把 key 存柜里，spawn 时按这个变量名注进去。
 *
 *  **2026-09-02 密钥柜整条删掉了**（用户：「取消密钥柜的概念呢，单纯用
 *  oh my pi 成熟的登录流程然后 UI 化」），这段代码随之够不着。
 *  但**够不着不等于该留**：上游 `model-registry.ts:1377-1379` 明写 `apiKey`
 *  会「wins over OAuth tokens from the broker」——只要有人把它重新接回去，
 *  就会用一个不存在的变量名顶掉 omp 刚存好的凭证，症状是
 *  **登录成功却 401**（用户当天看到的 MiniMax 1004 就是这么来的）。
 *
 *  一个能把已修好的事故原样带回来的函数，留着就是留一颗雷。所以连同
 *  `ompKeyEnvName` / `OmpProviderConfig` / `OmpModelDef` 一起删干净 ——
 *  真要再支持自定义 provider，那时重写一份、连同「apiKey 会压过 broker」
 *  这条约束一起想清楚，比让它在这里等着被误用强。 */
export function ompModelsYml(): string {
  return [
    '# 由 Eas-Term 生成。**这份恒为空** —— 模型表与凭证都是 omp 自己的事',
    '# （auth-broker 存在 agent.db 里）。往这里写 provider，其中的 apiKey 会压过',
    '# broker 的凭证，症状是「登录成功却 401」。手改这里会被覆盖。',
    '',
    'providers: {}',
    ''
  ].join('\n')
}

// ── eas-term skill 副本的尾巴 ──────────────────────────────────────────────

/** 围栏起始标记。**匹配只认这个前缀**，后面那串说明文字改了也仍然幂等。 */
const FENCE_BEGIN_PREFIX = '<!-- omp:begin'
const FENCE_END = '<!-- omp:end -->'

const FENCE_BEGIN =
  '<!-- omp:begin ——由 Eas-Term 在每次起 omp 会话前追加，改原版请去 skills/eas-term/，别改这里 -->'

/** 决定 21 里那段唯一的 omp 专属文字。原版 SKILL.md 一个字不改，只在末尾追加它。
 *  存在的理由：`request_secret` / `secret_check` / `report_secret_invalid` 按 ptyId 授权，
 *  omp 会话没有 ptyId —— 工具**看得见、调不通**，不说清楚模型会一直去撞。 */
const FENCE_BODY = [
  '## 本会话是 omp 底座，只有这一条不同',
  '上面「触发情境 C」与工具表里的 `request_secret` / `secret_check` / `report_secret_invalid`',
  '在本会话里**看得见但调不通**（它们按终端授权，这个会话不是终端）。缺 key、401/403、鉴权失败时：',
  '直接告诉用户「去 AI 对话面板的设置里检查模型服务商」——**别指定他该做什么**：',
  '订阅那条路要重新登录，填 key 那条路才是改 key，你分不清他用的是哪条。',
  '不要调那三个工具，也绝不让密钥进对话。其余规则原样适用。',
].join('\n')

export const OMP_SKILL_ADDENDUM = `${FENCE_BEGIN}\n${FENCE_BODY}\n${FENCE_END}`

/** 给定原版 SKILL.md 全文，返回追加好围栏段落的文本。
 *
 *  **幂等**：已经有围栏就把那一段整个换掉，不往后越追越长（调用方每次 spawn 都会跑一遍，
 *  而且下一次拷进来的可能是已经带尾巴的旧副本）。
 *
 *  **原文按字节保留**：只在末尾接东西，前面一个字符都不动。所以断言可以写成
 *  `out.startsWith(原文)`——这条断言就是「原版一个字不改」的机器可读版本。 */
export function ompSkillMarkdown(original: string): string {
  const beginAt = original.indexOf(FENCE_BEGIN_PREFIX)
  // **规则是「begin 之后的全部内容都是我们的」**，不是「只换 begin..end 之间那段」。
  // 看起来更精细的后者做不到幂等：围栏后面那个换行会被当成尾巴留下来，
  // 每跑一遍多一个空行；而且 end 缺失（上次写了一半）时它会退化成往后追加，
  // 于是越追越长——正是这个函数要防的事。这条规则成立的前提是：
  // 副本每次都从随包原版重新拷贝，所以围栏之后能出现的文字只可能是上一次的我们自己。
  const base = beginAt >= 0 ? original.slice(0, beginAt) : original

  // 与正文之间留一个空行；base 自己带了多少换行就用多少，不去 trim（trim 会改动原文）
  const sep = base.endsWith('\n\n') || base === '' ? '' : base.endsWith('\n') ? '\n' : '\n\n'
  return `${base}${sep}${OMP_SKILL_ADDENDUM}\n`
}

/** `omp models ls --json` 的一条。**`selector` 才是能拿去用的那个值。** */
interface OmpModelRow {
  provider?: unknown
  id?: unknown
  name?: unknown
  selector?: unknown
}

/** 把 `omp models ls --json` 读成「界面挑一个、我们存下来」的形状。
 *
 *  **id 一律用 `selector`（`<provider>/<model>`），绝不用裸的 `id`。**
 *  2026-09-02 真机事故就是这么来的：我们存了裸的 `MiniMax-M3`，
 *  omp 按 selector 认模型 —— 只给名字它不知道走哪个 provider，
 *  于是解析不到 broker 里那条凭证，拿着空 Authorization 去请求，
 *  MiniMax 回 `login fail: Please carry the API secret key ... (1004)`。
 *  用户看到的是「登录成功了，一发消息还是 401」，而凭证其实好好地存着。
 *
 *  **没有 provider 也拼不出 selector 的那条直接丢掉** —— 留着就是留一个
 *  选中之后必然 401 的选项，而用户无从判断它跟别的有什么不同。 */
export function ompModelsFromJson(stdout: string): { id: string; label: string }[] {
  let rows: OmpModelRow[]
  try {
    const j = JSON.parse(stdout) as { models?: OmpModelRow[] }
    rows = Array.isArray(j?.models) ? j.models : []
  } catch {
    return []
  }
  const out: { id: string; label: string }[] = []
  for (const m of rows) {
    const id = typeof m?.id === 'string' ? m.id : ''
    const provider = typeof m?.provider === 'string' ? m.provider : ''
    // 老版本可能没有 selector，用 provider/id 补一个
    const selector = typeof m?.selector === 'string' && m.selector ? m.selector : provider && id ? `${provider}/${id}` : ''
    if (!selector) continue
    out.push({ id: selector, label: typeof m?.name === 'string' && m.name ? m.name : id || selector })
  }
  return out
}

/** 存量修复：把已经存下来的**裸**模型名补成 selector。
 *
 *  修好写入那一侧之后，用户机器上仍然存着一个裸名字（真机现场
 *  `"model": "MiniMax-M3"`）。不补的话他继续 401，而界面上模型明明选着 ——
 *  这种「看起来配好了却用不了」的状态最难自查。
 *
 *  **已经带 `/` 的一律原样不动**，哪怕前缀是别家的：那多半是用户自己
 *  在工具栏里换过，硬套当前 provider 会把他的选择改错。 */
export function ompModelSelector(providerId: string | undefined, model: string | undefined): string | undefined {
  if (!model || !providerId) return undefined
  return model.includes('/') ? model : `${providerId}/${model}`
}
