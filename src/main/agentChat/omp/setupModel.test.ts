import { test } from 'node:test'
import assert from 'node:assert/strict'

import { authFailureInTail, nextStepOf, ompStateFrom, OMP_PROVIDERS, providerById } from './setupModel.ts'

// ── 下一步该让用户做什么 ──────────────────────────────────────────────────
//
// 这是引导面板的**唯一**判据来源。写成纯函数是因为它有六七个分支，
// 而每个分支都对应「用户此刻要做的一件不同的事」—— 合并任意两条都会把人引错方向。

const base = {
  installed: true,
  vault: { available: true, configured: true, locked: false, foreign: false },
  provider: undefined as string | undefined,
  keyInVault: false,
  model: undefined as string | undefined
}

test('二进制不在 → blocked，且**不是**「去配 provider」', () => {
  // 包坏了跟没配好是两件事：前者用户什么也做不了，后者他能自己解决。
  assert.equal(nextStepOf({ ...base, installed: false }).k, 'blocked')
})

test('系统加密不可用 / 柜子是别人的 → blocked（面板只显示一句话，没有出口）', () => {
  assert.equal(nextStepOf({ ...base, vault: { ...base.vault, available: false } }).k, 'blocked')
  assert.equal(nextStepOf({ ...base, vault: { ...base.vault, foreign: true } }).k, 'blocked')
})

test('柜子还没建 → 先建柜', () => {
  assert.equal(nextStepOf({ ...base, vault: { ...base.vault, configured: false } }).k, 'vault-setup')
})

test('柜子锁着 → 先解锁（**排在选 provider 之前**）', () => {
  // 反过来的话，用户填完 key 点保存才被打回，白填一遍。
  assert.equal(nextStepOf({ ...base, vault: { ...base.vault, locked: true } }).k, 'vault-unlock')
})

test('柜子好了但没选 provider → 选 provider', () => {
  assert.equal(nextStepOf(base).k, 'provider')
})

test('选了 provider、key 不在柜里 → 填 key', () => {
  assert.equal(nextStepOf({ ...base, provider: 'zai' }).k, 'key')
})

test('key 在柜里但没选模型 → 选模型', () => {
  assert.equal(nextStepOf({ ...base, provider: 'zai', keyInVault: true }).k, 'model')
})

test('全齐 → ready', () => {
  assert.equal(nextStepOf({ ...base, provider: 'zai', keyInVault: true, model: 'zai/glm' }).k, 'ready')
})

test('**中途锁柜要能打回来** —— 柜子 15 分钟不动会自动锁', () => {
  // 用户去找 key 找了一刻钟回来，面板不能还停在「填 key」，
  // 否则他填完点保存才撞上「柜子锁着」。
  const s = nextStepOf({ ...base, provider: 'zai', keyInVault: true, model: 'm', vault: { ...base.vault, locked: true } })
  assert.equal(s.k, 'vault-unlock')
})

// ── 冒烟失败是哪一类 ──────────────────────────────────────────────────────

test('**401 / invalid api key 认成 auth** —— 那是「key 不对」，要把人打回填 key 那步', () => {
  for (const line of [
    '{"jsonrpc":"2.0","id":1,"error":{"message":"401 Unauthorized"}}',
    'Error: invalid api key',
    'authentication_error: bad token',
    'HTTP 401'
  ]) {
    assert.equal(authFailureInTail([line]), 'auth', line)
  }
})

test('别的错误认成 unknown（原话给用户看，别硬套成 key 不对）', () => {
  assert.equal(authFailureInTail(['ECONNREFUSED 127.0.0.1:443']), 'unknown')
  assert.equal(authFailureInTail([]), 'unknown')
})

test('**不复用 cliAuth 那套判据** —— 它对 ACP 的行零命中', () => {
  // `unauthedInLine` 先用 `"type":"error|turn.failed|result"` 预过滤，
  // 而 ACP 的 JSON-RPC 行没有 type 字段，所以那条路对 omp 恒不命中。
  // 这里直接对错误原文做匹配，所以**没有 type 字段也要认得出来**。
  assert.equal(authFailureInTail(['{"error":{"code":-32000,"message":"Incorrect API key provided"}}']), 'auth')
})

// ── 服务商表 ──────────────────────────────────────────────────────────────

test('每个服务商都有取 key 的地址 —— 没有的话用户不知道去哪弄', () => {
  for (const p of OMP_PROVIDERS) assert.ok(p.keyUrl.startsWith('https://'), p.id)
})

test('服务商 id 只允许小写字母数字和横线 —— 它会被拼进环境变量名与文件路径', () => {
  for (const p of OMP_PROVIDERS) assert.match(p.id, /^[a-z0-9-]+$/)
})

test('id 不重复，且查得到', () => {
  const ids = OMP_PROVIDERS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(providerById(ids[0])?.id, ids[0])
  assert.equal(providerById('没有这个'), undefined)
})

// ── 订阅登录：与「填 API key」并列的第二条路（2026-09-02 加） ────────────────
//
// omp 认识 70 家，头几个正是最要紧的订阅（Claude Pro/Max、ChatGPT Plus/Pro、
// 智谱 GLM Coding Plan、Kimi、Copilot…）。**订阅用户没有 API key，
// 也不该被逼着去申请一把** —— 所以这条路上的判据必须和填 key 那条分开走。

import { ompLaunchGate } from './setupModel.ts'

const sub = { ...base, provider: 'anthropic', authMode: 'subscription' as const }

test('**订阅路上不问 key 在不在柜里** —— 那条路根本没有 key', () => {
  // 不分开的话，订阅用户会卡在「还没填 key」那一步，而他压根没有 key 可填。
  // 登录过了、模型还没选 → 下一步是选模型，**不是**「去填 key」。
  assert.equal(nextStepOf({ ...sub, loggedIn: true, keyInVault: false }).k, 'model')
})

test('订阅但还没登录成功 → 停在登录那一步', () => {
  assert.equal(nextStepOf({ ...sub, provider: undefined }).k, 'provider')
  assert.equal(nextStepOf({ ...sub, loggedIn: false }).k, 'login')
})

test('订阅登录过了、也选了模型 → ready', () => {
  assert.equal(nextStepOf({ ...sub, loggedIn: true, model: 'anthropic/claude' }).k, 'ready')
})

test('**柜子的状态不该拦住订阅路** —— 订阅凭证不进密钥柜', () => {
  // 凭证在 omp 自己的 agent.db 里（OAuth 令牌要它自己刷新）。
  // 拿柜子锁没锁去拦订阅登录，是把两条无关的路绑在了一起。
  const locked = { ...sub, loggedIn: true, model: 'm', vault: { ...base.vault, locked: true } }
  assert.equal(nextStepOf(locked).k, 'ready')
})

test('填 key 那条路照旧要过柜子那几关', () => {
  const k = { ...base, provider: 'zai', authMode: 'apikey' as const, keyInVault: true, model: 'm' }
  assert.equal(nextStepOf({ ...k, vault: { ...base.vault, locked: true } }).k, 'vault-unlock')
  assert.equal(nextStepOf(k).k, 'ready')
})

// ── 起进程前那道闸，两条路的判据不一样 ────────────────────────────────────

test('订阅路：不检查 key，直接放行', () => {
  assert.deepEqual(ompLaunchGate({ authMode: 'subscription', provider: 'anthropic', keyVarNames: [], keysReadable: false, vaultUnlocked: false }), { ok: true })
})

test('填 key 路：没选服务商 / 没填 key / 柜子锁着，三种要分开说', () => {
  const g = (o: Partial<Parameters<typeof ompLaunchGate>[0]>) =>
    ompLaunchGate({ authMode: 'apikey', provider: 'zai', keyVarNames: ['K'], keysReadable: true, vaultUnlocked: true, ...o })
  assert.equal(g({ provider: undefined, keyVarNames: [] }).ok, false)
  assert.equal(g({ keysReadable: false }).ok, false)
  assert.equal(g({ vaultUnlocked: false }).ok, false)
  assert.equal(g({}).ok, true)
  // **三种原因不能合并成一句「配置有问题」**：每种对应用户要做的一件不同的事
  const reasons = [g({ provider: undefined, keyVarNames: [] }), g({ keysReadable: false }), g({ vaultUnlocked: false })]
    .map((r) => (r.ok ? '' : r.reason))
  assert.equal(new Set(reasons).size, 3)
})

// ── 登录失败要说人话，不给用户看日志（2026-09-02 用户提的）─────────────────
//
// 用户原话：「如果真的失败，不要给用户看日志，而是 popup 的形式告诉用户填错了
// 还是其他的什么，不要让用户在软件中看到开发者看的东西。」
//
// 所以要把 omp 的输出**分类**成一句人话 + 一个明确的下一步动作。
// 分不出来的也不能倒日志 —— 那时就诚实说「没成功」，并把日志留给日志文件。

import { explainOmpFailure, humanReasonIn } from './setupModel.ts'

const login = (lines: string[], error?: string, ours?: boolean) =>
  explainOmpFailure({ ctx: 'login', lines, error, ours })
const smoke = (lines: string[], error?: string, ours?: boolean) =>
  explainOmpFailure({ ctx: 'smoke', lines, error, ours })

test('**key 填错了 → 直接说 key 不对，并让他回去重填**', () => {
  const r = login(['Validating API key...', 'Error: 401 invalid api key'])
  assert.equal(r.retry, 'input')
  assert.match(r.title, /密钥|key/i)
  // 不能把原始那行塞进给用户看的文案里
  assert.ok(!r.title.includes('401'))
  assert.ok(!(r.hint ?? '').includes('Error:'))
})

test('连不上 → 说网络，不说 key（把网络问题说成 key 错，用户会去换一把好好的 key）', () => {
  for (const l of ['fetch failed: ECONNREFUSED', 'getaddrinfo ENOTFOUND api.example.com', 'network timeout']) {
    const r = login([l])
    assert.equal(r.retry, 'retry', l)
    assert.match(r.title, /连不上|网络/)
  }
})

test('用户自己取消 / 中途关掉 → 不当成错误吓唬他', () => {
  const r = login(['Login cancelled'])
  assert.equal(r.retry, 'retry')
  assert.match(r.title, /取消/)
})

test('**认不出来时也不倒日志** —— 诚实说没成功，别塞原文进去', () => {
  const r = login(['Segmentation fault at 0xdeadbeef', '  at foo.ts:12'], '退出码 1')
  assert.equal(r.retry, 'retry')
  assert.ok(!r.title.includes('0xdeadbeef'))
  assert.ok(!(r.hint ?? '').includes('foo.ts'))
  assert.ok(!(r.detail ?? '').includes('0xdeadbeef'), 'detail 也不许')
  assert.ok(!(r.detail ?? '').includes('foo.ts'))
})

test('空输入也要给得出一句话，不能是 undefined', () => {
  assert.ok(login([]).title.length > 0)
  assert.ok(smoke([]).title.length > 0)
})

// ── 2026-09-02 第二轮：用户说「登录未完成的时候用户并不知道是什么原因」──────
//
// 截图里的那一屏最能说明问题：面包屑是「服务商 → **密钥** → 模型 → **试一句**」
// （用户在跑冒烟、走的是填 key 那条路），文案却是「**登录**没有完成」。
// 词用错了是一层；更糟的一层是 —— 那次失败的真实原因**我们本来就知道**：
//
//   lastSmoke.message = "密钥柜里还没有 EAS_OMP_MINIMAX_CODE_CN_KEY，先在设置里填。"
//
// 那是 `ompLaunchGate` 写的、已经说得明明白白的中文。而分类器（本来是为了
// 「把 omp 的英文翻成人话」写的）把它当成待分类的原料，一路落到兜底那句
// 「登录没有完成」上 —— **我们自己说清楚的话，被自己的分类器碾掉了。**

test('**我们自己写的那句话原样透出，不许被分类器碾掉**', () => {
  const mine = '密钥柜里还没有 EAS_OMP_MINIMAX_CODE_CN_KEY，先在设置里填。'
  const r = smoke([], mine, true)
  assert.equal(r.title, mine, '我们自己写的中文已经是给用户看的，不该再翻译一遍')
  assert.equal(r.retry, 'input', '这种错要送他回上一步去补，不是「再试一次」')
})

test('**冒烟失败不许说「登录」** —— 他刚点的是「试一句」', () => {
  const r = smoke(['something odd happened'], '退出码 1')
  assert.ok(!r.title.includes('登录'), `冒烟那一屏说了「登录」：${r.title}`)
  assert.ok(!(r.hint ?? '').includes('登录'))
})

test('同一段输出，两种上下文说两种话', () => {
  const lines = ['Login cancelled']
  assert.notEqual(login(lines).title, smoke(lines).title)
})

// ── 「不知道是什么原因」的正面解法：把对方说的那**一句**摘出来 ──────────────
//
// 「不给用户看日志」和「让用户知道原因」不矛盾 —— 矛盾的是「倒一整段」和
// 「一个字都不说」这两个极端。服务商自己那句错误描述是**原因**，不是日志；
// 堆栈帧、源码回显、JSON 才是。所以摘一句、洗干净、单独一行给他。

test('从真机那段 Bun 崩溃里，摘出的是「原因」那一句，不是堆栈', () => {
  const real = [
    '42710 |   return new Es(r, t.status, { headers: t.headers, code: o });',
    '                 ^',
    'ProviderHttpError: MiniMax Token Plan (China) API key validation failed (401): {"type":"error"}',
    '  status: 401,',
    '      at dNt (/$bunfs/root/omp-darwin-arm64:42710:10)'
  ]
  const d = humanReasonIn(real)
  assert.ok(d, '这段里明明有一句人话，摘不出来等于白说')
  assert.match(d, /API key validation failed/)
  assert.ok(!d.includes('ProviderHttpError:'), '类名是给开发者的，去掉')
  assert.ok(!d.includes('{'), 'JSON 不许跟进来')
  assert.ok(!d.includes('$bunfs'), '路径不许跟进来')
  assert.ok(!d.includes('42710'), '源码行号不许跟进来')
})

test('全是堆栈、没有一句人话 → 摘不出来就不摘（宁可不说，也不胡说）', () => {
  assert.equal(humanReasonIn(['      at k3 (/$bunfs/root/omp:42737:18)', '   ^', '42711 | x']), undefined)
})

test('摘出来的那句不许过长 —— 一行放不下就不是「一句话」了', () => {
  const d = humanReasonIn(['Error: ' + 'x'.repeat(400) + ' failed'])
  assert.ok(!d || d.length <= 140, `摘出来 ${d?.length} 字`)
})

test('认得出的分类，detail 只是补充，不能顶替 title', () => {
  const r = login(['ProviderHttpError: API key validation failed (401): {"a":1}'])
  assert.match(r.title, /密钥|key/i)
  assert.ok((r.detail ?? '').length > 0, '既然摘得出原因，就该让他看见')
  assert.ok(!(r.detail ?? '').includes('{'))
})

// ── 2026-09-02 真机事故：订阅登录完，面板跳回「先挑一家服务商」 ─────────────
//
// 用户原话：「当我选择或者输入了 API key 之后，那个订阅就跳回到了一个设置的最初页面，
// 而且登录好像没有成功，我并不知道这中间发生了什么事，很疑惑。」
//
// 现场证据（`~/Library/Application Support/Eas-Term/omp-setup.json`）：
//   { "provider": { "id": "minimax-code-cn", "authMode": "subscription" } }
// —— provider 与 authMode 都在，**`loggedInAt` 不在**。
//
// 根因有两条，各自都足以单独造成这个现象：
//
//  A. **渲染层自己拼 `nextStepOf` 的入参时漏了 `authMode` 与 `loggedIn`**，
//     于是订阅这条路在渲染层**永远**走 apikey 分支 → 「没 key」→ 'key' 屏；
//     而 `providerById('minimax-code-cn')` 又是 undefined（那 id 不在我们四家的
//     推荐清单里），'key' 屏渲染不出来，落到兜底的那个「先挑一家服务商」按钮上。
//     **就算登录完全成功，也会落到这里** —— 这就是用户看到的那一屏。
//
//     判据搬到 shared 里本来就是为了「两侧照同一份说话」，结果两侧喂的**入参**分叉了。
//     所以这次连拼入参也一起搬进来：`ompStateFrom`。
//
//  B. `omp:saveProvider` 重写 provider 时整个对象重建，**`loggedInAt` 没带上**。
//     于是「登录成功 → 被 A 弹回选服务商 → 再选一次 → 登录记录被抹掉」形成闭环，
//     用户怎么登都登不进去。见 `store.ts` 的 `mergeProviderChoice`。

test('**A 的回归**：订阅 + 已登录 + 没模型 → 选模型，绝不能落到「填 key」', () => {
  const s = ompStateFrom({
    installed: true,
    provider: 'minimax-code-cn',
    authMode: 'subscription',
    loggedIn: true,
    model: undefined,
    vault: { available: true, configured: true, locked: false, foreign: false },
    keyInVault: false // 订阅这条路本来就没有 key 在柜里
  })
  assert.equal(s.authMode, 'subscription', 'authMode 必须传下去')
  assert.equal(s.loggedIn, true, 'loggedIn 必须传下去')
  assert.equal(nextStepOf(s).k, 'model')
})

test('**A 的回归**：订阅 + 还没登录 → 去登录，不是去填 key', () => {
  // 漏传 authMode 的症状就是这里回 'key' —— 而订阅用户压根没有 key 可填。
  const s = ompStateFrom({
    installed: true,
    provider: 'minimax-code-cn',
    authMode: 'subscription',
    loggedIn: false,
    model: undefined,
    vault: { available: true, configured: true, locked: false, foreign: false },
    keyInVault: false
  })
  assert.equal(nextStepOf(s).k, 'login')
})

test('订阅那条路不受密钥柜锁没锁影响（拼入参这一层也不许把它绑进去）', () => {
  const s = ompStateFrom({
    installed: true,
    provider: 'minimax-code-cn',
    authMode: 'subscription',
    loggedIn: true,
    model: 'minimax-code-cn/MiniMax-M2',
    vault: { available: true, configured: true, locked: true, foreign: false },
    keyInVault: false
  })
  assert.equal(nextStepOf(s).k, 'ready')
})

test('填 key 那条路原样：拼出来的入参照旧带柜子状态', () => {
  const s = ompStateFrom({
    installed: true,
    provider: 'deepseek',
    authMode: 'apikey',
    loggedIn: false,
    model: undefined,
    vault: { available: true, configured: true, locked: true, foreign: false },
    keyInVault: false
  })
  assert.equal(nextStepOf(s).k, 'vault-unlock')
})
