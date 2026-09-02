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
    // 脱敏按变量名里的 KEY/SECRET/TOKEN 收 —— 所以我们的注入变量名带 `KEY`（见 ompKeyEnvName）。
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

/** provider key 的注入变量名。
 *
 *  **内置 provider 也用这个名字，绝不改成 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`**（决定 13）：
 *  `model-registry.ts:1377-1379` 对任意 providerName（含内置）在 apiKey 存在时都装上，
 *  并且明写「wins over OAuth tokens」，所以自定义名字照样生效；而用标准名字的后果是
 *  omp 起的 bash 里再跑 `claude` / `codex` 会继承它 —— Claude Code 从订阅 OAuth
 *  静默切成 API key 计费。那是最难发现的一种「影响 CC」。
 *
 *  名字里带 `KEY` 也是有意的：omp 的 secrets 脱敏按变量名含 KEY/SECRET/TOKEN 收。 */
export function ompKeyEnvName(providerId: string): string {
  const upper = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!upper) throw new Error(`omp models: provider id 里没有可用字符：${JSON.stringify(providerId)}`)
  return `EAS_OMP_${upper}_KEY`
}

export interface OmpModelDef {
  id: string
  name?: string
  /** provider 层没给 api 时，每个模型都必须自己给（`models-config.ts:83-90`） */
  api?: OmpApi
  contextWindow?: number
  maxTokens?: number
}

/** 一个 provider 的可配置面。**这里没有放 key 的地方，是故意的**——
 *  key 永远只以变量名的形式出现在文件里，真值走 spawn env，不经过这个模块。 */
export interface OmpProviderConfig {
  id: string
  baseUrl?: string
  api?: OmpApi
  models?: OmpModelDef[]
}

/** `<agentDir>/models.yml` 的整份内容。
 *
 *  这里**照抄了 omp 自己的校验**（`config/models-config.ts:36-96` 的
 *  `validateProviderConfiguration`，mode = 'models-config'），宁可在我们这一侧抛，
 *  也不要写出一份 omp 会整体拒绝的文件 —— 那种失败发生在 `session/new` 里，
 *  用户看到的只是「起不来」。 */
export function ompModelsYml(providers: OmpProviderConfig[]): string {
  const byEnv = new Map<string, string>()
  const providersTree: Record<string, YamlValue | undefined> = {}

  for (const p of providers) {
    if (!p.id) throw new Error('omp models: provider id 不能为空')
    if (Object.hasOwn(providersTree, p.id)) {
      // YAML 重复键是「后者覆盖前者」的静默行为，不能让它发生
      throw new Error(`omp models: provider id 重复：${p.id}`)
    }
    const env = ompKeyEnvName(p.id)
    const clash = byEnv.get(env)
    // 'a-b' 与 'a_b' 会规范化成同一个变量名，两个 provider 就会共用一把 key
    if (clash) throw new Error(`omp models: ${p.id} 与 ${clash} 的 key 变量名撞了（都是 ${env}）`)
    byEnv.set(env, p.id)

    const models = p.models ?? []
    if (models.length > 0 && !p.baseUrl) {
      throw new Error(`omp models: ${p.id} 列了自定义模型就必须给 baseUrl（omp models-config.ts:64-67）`)
    }
    for (const m of models) {
      if (!m.id) throw new Error(`omp models: ${p.id} 有个模型没写 id`)
      if (!p.api && !m.api) {
        throw new Error(`omp models: ${p.id}/${m.id} 没有 api —— provider 层或模型层至少给一个`)
      }
    }

    providersTree[p.id] = {
      baseUrl: p.baseUrl,
      api: p.api,
      // 只写变量名。omp 侧 `resolve-config-value.ts:21-27`：先查同名环境变量，
      // 查不到就**把这串字面量当成 key 用**（不是报错）—— 所以变量没注入时
      // 表现是 401 而不是「没配」，冒烟那一步要能认出这个形状。
      apiKey: ompKeyEnvName(p.id),
      models:
        models.length > 0
          ? models.map((m) => ({
              id: m.id,
              name: m.name,
              api: m.api,
              contextWindow: m.contextWindow,
              maxTokens: m.maxTokens,
            }))
          : undefined,
    }
  }

  const header = [
    '# 由 Eas-Term 生成 —— provider 的 key **只写环境变量名，不写值**，真值在 spawn 时注入。',
    '# 手改这里会在下次保存 provider 时被覆盖。',
    '',
  ].join('\n')

  return header + toYaml({ providers: providersTree })
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
