import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  ompConfigYml,
  ompModelsYml,
  ompKeyEnvName,
  ompSkillMarkdown,
  ompSkillsDir,
  ompEasTermSkillDir,
  OMP_SKILL_ADDENDUM,
} from './config.ts'

// 这些行号指向 omp 18.0.11 的 `packages/coding-agent/src/config/settings-schema.ts`。
// 键名与默认值 2026-09-02 逐个核对过；18.1.2 拿到后按 §14.1 复跑一次 grep。
const AGENT_DIR = '/tmp/eas-omp/agent'

// ── config.yml：整份内容 ───────────────────────────────────────────────────

// 整份钉住，不是为了「覆盖率」：这个文件每次 spawn 都被整份重写，
// 多一个键少一个键都会静默改掉 omp 的行为，diff 出来比逐键断言更早看见。
const EXPECTED_CONFIG = `# 由 Eas-Term 生成，**每次起 omp 会话前整份重写** —— 手改这里无效，改动会被覆盖。
# 想调这些值请改 src/main/agentChat/omp/config.ts（依据写在那里的注释里）。
tools:
  approvalMode: "always-ask"
  approval:
    generate_image: "deny"
    browser: "deny"
    computer: "deny"
    tts: "deny"
  xdev: false
generate_image:
  enabled: false
speechgen:
  enabled: false
computer:
  enabled: false
browser:
  enabled: false
secrets:
  enabled: true
skills:
  customDirectories:
    - "/tmp/eas-omp/agent/skills"
retry:
  modelFallback: false
`

test('config.yml 就是这一份 —— 多一个键少一个键都要在 diff 里被看见', () => {
  assert.equal(ompConfigYml(AGENT_DIR), EXPECTED_CONFIG)
})

test('**点分键必须拆成嵌套** —— 扁平写 omp 静默用默认值，不报错', () => {
  const yml = ompConfigYml(AGENT_DIR)
  // omp 读设置是 getByPath(obj, 'tools.approvalMode'.split('.'))（settings.ts:165-178），
  // 一层层取属性。字面量键 "tools.approvalMode" 永远取不到 → 退回默认 yolo，且无任何提示。
  for (const dotted of [
    'tools.approvalMode',
    'tools.approval',
    'tools.xdev',
    'generate_image.enabled',
    'speechgen.enabled',
    'computer.enabled',
    'browser.enabled',
    'secrets.enabled',
    'skills.customDirectories',
    'retry.modelFallback',
  ]) {
    assert.ok(!yml.includes(`${dotted}:`), `${dotted} 被写成了扁平点分键`)
  }
})

test('五个「与上游默认相反」的键一个都不能漏 —— 漏了就是默认值在管事', () => {
  const yml = ompConfigYml(AGENT_DIR)
  // 括号里是 settings-schema.ts 的行号与该键的上游默认值
  assert.match(yml, /approvalMode: "always-ask"/) //   :4061 默认 yolo
  assert.match(yml, /\n {2}xdev: false\n/) //          :4670 默认 true
  assert.match(yml, /browser:\n {2}enabled: false/) // :4486 默认 true（四个开关里唯一默认开着的）
  assert.match(yml, /secrets:\n {2}enabled: true/) //  :5250 默认 false（不开就没有脱敏）
  assert.match(yml, /retry:\n {2}modelFallback: false/) // :1813 默认 true
})

test('deny 表的键是**工具名**（tts）不是开关名（speechgen）', () => {
  const yml = ompConfigYml(AGENT_DIR)
  // approval.ts:126-127 用 `tool.name` 查这张表：工具叫 tts（tools/tts.ts:322），
  // 开关叫 speechgen（settings-schema.ts:4260）。写错名字 = 这道锁根本不存在。
  const approvalBlock = yml.slice(yml.indexOf('  approval:'), yml.indexOf('  xdev:'))
  assert.ok(approvalBlock.includes('tts: "deny"'))
  assert.ok(!approvalBlock.includes('speechgen'), 'deny 表里不该出现开关名')
  for (const t of ['generate_image', 'browser', 'computer']) {
    assert.ok(approvalBlock.includes(`${t}: "deny"`), `${t} 没被 deny`)
  }
})

test('customDirectories 指向装 skill 的那一层，不是 skill 目录本身', () => {
  // extensibility/skills.ts:268-280 对每个条目跑 scanSkillsFromDir（扫子目录）。
  // 直接填到 .../skills/eas-term 的话一个 skill 都扫不出来。
  assert.equal(ompSkillsDir(AGENT_DIR), path.join(AGENT_DIR, 'skills'))
  assert.equal(ompEasTermSkillDir(AGENT_DIR), path.join(AGENT_DIR, 'skills', 'eas-term'))
  assert.ok(ompConfigYml(AGENT_DIR).includes('- "/tmp/eas-omp/agent/skills"'))
})

test('Windows 的 agentDir：反斜杠必须转义，否则是非法转义序列', () => {
  const win = ompConfigYml('C:\\Users\\bi ily\\AppData\\Roaming\\Eas-Term\\omp\\agent')
  // 双引号标量里 `\U` 不是合法转义。JSON.stringify 出来的 `\\` 才是。
  assert.ok(win.includes('"C:\\\\Users\\\\bi ily\\\\'), win)
})

test('ignoredSkills 默认不写 —— 上游 customDirectories 本来就顶得掉同名 skill', () => {
  // skills.ts:318-334：customDirectories 里的同名 skill 会顶掉 DEFAULT-path provider
  // （~/.claude/skills/eas-term）那一份（上游 issue #7190）。所以默认不需要这把锁。
  assert.ok(!ompConfigYml(AGENT_DIR).includes('ignoredSkills'))
  const forced = ompConfigYml(AGENT_DIR, { ignoredSkills: ['eas-term'] })
  assert.match(forced, /ignoredSkills:\n {4}- "eas-term"/)
})

test('空数组写成 []、空对象写成 {} —— 只留一个裸键会被解析成显式 null', () => {
  assert.ok(ompModelsYml([]).includes('providers: {}'))
  assert.ok(!ompModelsYml([]).match(/providers:\s*\n/))
})

// ── models.yml ─────────────────────────────────────────────────────────────

const ZAI = {
  id: 'zai-coding-plan',
  baseUrl: 'https://api.z.ai/api/coding/paas/v4',
  api: 'openai-completions' as const,
  models: [{ id: 'glm-5.3', name: 'GLM 5.3', contextWindow: 200_000 }],
}

test('apiKey 写的是**环境变量名**，不是值', () => {
  const yml = ompModelsYml([ZAI])
  assert.ok(yml.includes('apiKey: "EAS_OMP_ZAI_CODING_PLAN_KEY"'), yml)
  // 这个模块的签名里根本没有放 key 的地方——真值只在 spawn env 里，永不进文件
  assert.ok(!yml.includes('sk-'))
})

test('**内置 provider 也写 EAS_OMP_ 前缀**，绝不用 ANTHROPIC_API_KEY（决定 13）', () => {
  // model-registry.ts:1377-1379 对内置 provider 一样装 apiKey 且「wins over OAuth tokens」，
  // 所以自定义名字照样生效；改成标准名的代价是 omp 起的 bash 里再跑 claude 会继承它，
  // Claude Code 从订阅 OAuth 静默切成 API key 计费——最难发现的一种「影响 CC」。
  const yml = ompModelsYml([{ id: 'anthropic' }, { id: 'openai' }])
  assert.ok(yml.includes('apiKey: "EAS_OMP_ANTHROPIC_KEY"'))
  assert.ok(yml.includes('apiKey: "EAS_OMP_OPENAI_KEY"'))
  for (const std of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
    assert.ok(!yml.includes(std), `文件里出现了标准 provider 变量名 ${std}`)
  }
})

test('变量名带 KEY —— omp 的脱敏按名字里的 KEY/SECRET/TOKEN 收', () => {
  assert.equal(ompKeyEnvName('zai'), 'EAS_OMP_ZAI_KEY')
  assert.equal(ompKeyEnvName('my.proxy v2'), 'EAS_OMP_MY_PROXY_V2_KEY')
  assert.ok(ompKeyEnvName('anything').endsWith('_KEY'))
})

test('两个 provider 规范化成同一个变量名 → 当场抛（否则两家共用一把 key）', () => {
  assert.throws(() => ompModelsYml([{ id: 'a-b' }, { id: 'a_b' }]), /变量名撞了/)
})

test('provider id 重复 → 当场抛（YAML 重复键是静默后者覆盖前者）', () => {
  assert.throws(() => ompModelsYml([{ id: 'zai' }, { id: 'zai' }]), /重复/)
})

test('照抄 omp 的校验：列了模型就必须给 baseUrl / api，缺了在我们这边抛', () => {
  // models-config.ts:64-90。不抄的话，错误发生在 session/new 里，
  // 用户看到的只是「起不来」，看不到是哪一条配错了。
  assert.throws(
    () => ompModelsYml([{ id: 'zai', models: [{ id: 'glm-5.3', api: 'openai-completions' }] }]),
    /baseUrl/,
  )
  assert.throws(
    () => ompModelsYml([{ id: 'zai', baseUrl: 'https://x', models: [{ id: 'glm-5.3' }] }]),
    /没有 api/,
  )
  // provider 层给了 api 就够，模型层可以不写
  assert.ok(ompModelsYml([ZAI]).includes('- id: "glm-5.3"'))
})

test('模型数组的缩进：`- id:` 之后的键要对齐，不能掉到上一层', () => {
  const yml = ompModelsYml([ZAI])
  assert.ok(yml.includes('    models:\n      - id: "glm-5.3"\n        name: "GLM 5.3"\n'), yml)
})

// ── 用 omp 同款解析器解回来 ────────────────────────────────────────────────

const bunOk = (() => {
  try {
    return spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
})()

function bunParse(yaml: string): unknown {
  const r = spawnSync('bun', ['-e', 'const {YAML}=require("bun");console.log(JSON.stringify(YAML.parse(process.env.OMP_YAML)))'], {
    encoding: 'utf8',
    env: { ...process.env, OMP_YAML: yaml },
  })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// omp 解析这两份文件用的就是 `import { YAML } from "bun"`（settings.ts:31/1377）。
// 手写的序列化器是否被接受，只有拿同一个解析器解回来才算数——所以这条用例装了 bun 才跑。
test('bun 的 YAML 解析器（omp 用的同一个）解回来就是我们想要的嵌套结构', { skip: bunOk ? false : '本机没有 bun' }, () => {
  const cfg = bunParse(ompConfigYml('C:\\Users\\bi ily\\omp\\agent')) as Record<string, any>
  assert.equal(cfg.tools.approvalMode, 'always-ask')
  assert.equal(cfg.tools.approval.tts, 'deny')
  assert.equal(cfg.tools.xdev, false)
  assert.equal(cfg.browser.enabled, false)
  assert.equal(cfg.secrets.enabled, true)
  assert.equal(cfg.retry.modelFallback, false)
  // 反斜杠原样回来，没被当转义吃掉
  assert.deepEqual(cfg.skills.customDirectories, [path.join('C:\\Users\\bi ily\\omp\\agent', 'skills')])

  const models = bunParse(ompModelsYml([{ id: 'anthropic' }, ZAI])) as Record<string, any>
  assert.equal(models.providers.anthropic.apiKey, 'EAS_OMP_ANTHROPIC_KEY')
  assert.equal(models.providers['zai-coding-plan'].models[0].contextWindow, 200_000)
})

// ── skill 副本的尾巴 ───────────────────────────────────────────────────────

const ORIGINAL = '---\nname: eas-term\ndescription: 原样\n---\n\n# 正文\n\n最后一行。\n'

test('原文一个字不改 —— 只在末尾接东西', () => {
  const out = ompSkillMarkdown(ORIGINAL)
  assert.ok(out.startsWith(ORIGINAL), '前缀被动过了')
  assert.ok(out.trimEnd().endsWith('<!-- omp:end -->'))
})

test('**幂等**：跑第二遍结果一模一样，围栏只有一处', () => {
  const once = ompSkillMarkdown(ORIGINAL)
  const twice = ompSkillMarkdown(once)
  assert.equal(twice, once)
  assert.equal(once.split('<!-- omp:begin').length - 1, 1)
})

test('围栏里的旧内容被**替换**，不是又追加一段', () => {
  const stale = `${ORIGINAL}\n<!-- omp:begin 旧版本 -->\n上一版的说法\n<!-- omp:end -->\n`
  const out = ompSkillMarkdown(stale)
  assert.equal(out.split('<!-- omp:begin').length - 1, 1)
  assert.ok(!out.includes('上一版的说法'))
  assert.ok(out.startsWith(ORIGINAL))
})

test('end 标记丢了（上次写了一半）也不会越追越长', () => {
  const broken = `${ORIGINAL}\n<!-- omp:begin 被截断的 -->\n半句话`
  const a = ompSkillMarkdown(broken)
  const b = ompSkillMarkdown(a)
  assert.equal(a, b)
  assert.equal(a.split('<!-- omp:begin').length - 1, 1)
  assert.ok(!a.includes('半句话'))
})

test('结尾没有换行的原文也照样只隔一个空行', () => {
  const out = ompSkillMarkdown('# 就一行')
  assert.ok(out.startsWith('# 就一行\n\n<!-- omp:begin'))
  assert.equal(ompSkillMarkdown(out), out)
})

test('追加的那段把三个调不通的工具点名说清，并给了替代动作', () => {
  // 决定 21：这三个 MCP 工具按 ptyId 授权，omp 会话没有 ptyId——**看得见、调不通**。
  // 不点名的话模型会一直去撞，用户看到的是「它一直说去找密钥柜」。
  for (const tool of ['request_secret', 'secret_check', 'report_secret_invalid']) {
    assert.ok(OMP_SKILL_ADDENDUM.includes(tool), `没点名 ${tool}`)
  }
  // **替代动作要对两条路都成立**：omp 的鉴权既可能是订阅登录过期、也可能是 key 填错，
  // 写死「去填 key」会把订阅用户支到一个他压根没有的东西上。
  assert.ok(OMP_SKILL_ADDENDUM.includes('去 AI 对话面板的设置里检查模型服务商'))
  assert.ok(!OMP_SKILL_ADDENDUM.includes('设置里填 key'), '别把用户往「只有 key 一条路」上引')
  assert.ok(OMP_SKILL_ADDENDUM.includes('绝不让密钥进对话'))
})

test('拿真的 skills/eas-term/SKILL.md 跑：frontmatter 与正文原样，尾巴在最后', () => {
  // 副本的 description 必须原样——skills.ts 的 scanSkillsFromDir 是 requireDescription: true，
  // 而触发词就写在 description 里，动了它 = 换了触发条件。
  const real = fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', '..', '..', 'skills', 'eas-term', 'SKILL.md'),
    'utf8',
  )
  const out = ompSkillMarkdown(real)
  assert.ok(out.startsWith(real))
  assert.ok(out.endsWith(`${OMP_SKILL_ADDENDUM}\n`))
  assert.equal(ompSkillMarkdown(out), out)
})
