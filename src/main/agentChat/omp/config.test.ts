import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  ompConfigYml,
  ompModelsYml,
  ompSkillMarkdown,
  ompSkillsDir,
  ompEasTermSkillDir,
  OMP_SKILL_ADDENDUM,
  ompModelsFromJson,
  ompModelSelector,
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

// ── models.yml：**它恒为空，这就是全部要测的** ────────────────────────────
//
// 原来这里有 11 条测试，测的是「怎么把 provider 连同
// `apiKey: EAS_OMP_<ID>_KEY` 写进去」—— 那是密钥柜那条路的产物。
//
// **2026-09-02 密钥柜整条删掉了**（用户：「取消密钥柜的概念呢，单纯用
// oh my pi 成熟的登录流程然后 UI 化」），那些测试连同被测的代码一起删。
//
// 留下的这两条钉的是**新的不变量**：这份文件永远不许出现 apiKey。
// 上游 `model-registry.ts:1377-1379` 明写 apiKey 会
// 「wins over OAuth tokens from the broker」—— 一旦有人把 provider 写回去，
// 就会用一个不存在的变量名顶掉 omp 存好的凭证，症状是**登录成功却 401**
// （用户当天看到的 MiniMax 1004 就是这么来的）。

test('models.yml 就是空的 providers，一个字都不多', () => {
  const yml = ompModelsYml()
  assert.ok(yml.includes('providers: {}'))
  // 只留一个裸键会被解析成显式 null —— 那和「空对象」在 omp 那边不是一回事
  assert.ok(!yml.match(/providers:\s*\n/))
})

test('**数据里永远不许出现 apiKey / 变量名** —— 它会压过 broker 的凭证', () => {
  // 只查**非注释行**：文件头那几句注释正是在解释这个危险，
  // 连它一起禁掉就成了「不许写下为什么」。数据干净、说明照写。
  const data = ompModelsYml()
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')
  assert.ok(!/apiKey/i.test(data), `models.yml 的数据里出现了 apiKey：\n${data}`)
  assert.ok(!/EAS_OMP/.test(data))
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

// ── 2026-09-02 真机事故：订阅登录成功了，一发消息还是 401 ──────────────────
//
// 用户原话：「登录后发信息展示 401 login fail: Please carry the API secret key
// in the 'Authorization' field of the request header (1004)」
//
// 查下来跟凭证一点关系都没有 —— 凭证好好地躺在 `agent.db` 里
// （`provider=minimax-code-cn`、`credential_type=api_key`、没禁用）。
// 病根是**我们把模型名截短了**。`omp models ls --json` 每条同时给：
//
//     { "id": "MiniMax-M3", "selector": "minimax-code-cn/MiniMax-M3", ... }
//
// 我们存的是 `id`。**但 omp 是按 selector 认模型的** —— 只给裸名字，
// 它不知道该走哪个 provider，于是解析不到那条 broker 凭证，
// 拿着空 Authorization 去请求，MiniMax 回 1004。
//
// 下面这段 JSON 是真机上抓的（`omp models ls --json`，18.1.2）。

const REAL_MODELS_JSON = JSON.stringify({
  models: [
    {
      provider: 'minimax-code-cn',
      id: 'MiniMax-M3',
      selector: 'minimax-code-cn/MiniMax-M3',
      name: 'MiniMax-M3',
      contextWindow: 204800
    },
    {
      provider: 'minimax-code-cn',
      id: 'MiniMax-M2.1-lightning',
      selector: 'minimax-code-cn/MiniMax-M2.1-lightning',
      name: 'MiniMax M2.1 Lightning (Coding Plan CN)'
    }
  ]
})

test('**模型的值必须是 selector，不是裸 id** —— 裸 id 就是那个 1004', () => {
  const out = ompModelsFromJson(REAL_MODELS_JSON)
  assert.equal(out[0].id, 'minimax-code-cn/MiniMax-M3')
  assert.ok(
    out.every((m) => m.id.includes('/')),
    '有一条不带 provider 前缀 —— 那条选中之后就会 401'
  )
})

test('label 用 name（给人看的），id 用 selector（给 omp 用的）—— 两者不能混', () => {
  const out = ompModelsFromJson(REAL_MODELS_JSON)
  assert.equal(out[1].label, 'MiniMax M2.1 Lightning (Coding Plan CN)')
  assert.equal(out[1].id, 'minimax-code-cn/MiniMax-M2.1-lightning')
})

test('老版本没有 selector 字段时，用 provider/id 拼一个', () => {
  const j = JSON.stringify({ models: [{ provider: 'zai', id: 'glm-5', name: 'GLM-5' }] })
  assert.equal(ompModelsFromJson(j)[0].id, 'zai/glm-5')
})

test('provider 和 selector 都没有 → 这条丢掉，不留一个会 401 的裸名字', () => {
  const j = JSON.stringify({ models: [{ id: 'mystery', name: 'Mystery' }, { provider: 'zai', id: 'ok' }] })
  const out = ompModelsFromJson(j)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'zai/ok')
})

test('不是 JSON / 空的 → 空数组，别抛（它在起会话那条路上）', () => {
  assert.deepEqual(ompModelsFromJson('not json at all'), [])
  assert.deepEqual(ompModelsFromJson('{}'), [])
})

// ── 已经存下来的那些裸名字要能自愈 ────────────────────────────────────────
//
// 修好之后新存的都带前缀了，但**用户机器上已经存着一个裸的**
// （真机现场：`"model": "MiniMax-M3"`）。不修的话他还是 401，
// 而且看不出为什么 —— 界面上模型明明选着。

test('**存量的裸模型名，读的时候补上 provider 前缀**', () => {
  assert.equal(ompModelSelector('minimax-code-cn', 'MiniMax-M3'), 'minimax-code-cn/MiniMax-M3')
})

test('已经带前缀的原样不动（别拼成 a/a/b）', () => {
  assert.equal(
    ompModelSelector('minimax-code-cn', 'minimax-code-cn/MiniMax-M3'),
    'minimax-code-cn/MiniMax-M3'
  )
})

test('前缀是**别家**的也原样不动 —— 那是用户自己选的，我们不改他的选择', () => {
  // 用户可能在工具栏里换成了另一家的模型。硬套当前 provider 会把它改错。
  assert.equal(ompModelSelector('minimax-code-cn', 'zai/glm-5'), 'zai/glm-5')
})

test('没有模型 / 没有 provider → undefined，不要凭空造一个', () => {
  assert.equal(ompModelSelector('minimax-code-cn', undefined), undefined)
  assert.equal(ompModelSelector(undefined, 'MiniMax-M3'), undefined)
})
