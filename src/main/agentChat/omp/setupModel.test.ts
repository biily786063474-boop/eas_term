import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  authFailureInTail,
  explainOmpFailure,
  humanReasonIn,
  nextStepOf,
  ompLaunchGate,
  ompLoggedInFrom,
  ompModelUsable,
  ompStateFrom
} from './setupModel.ts'

// ── 下一步该让用户做什么 ──────────────────────────────────────────────────
//
// 这是引导面板的**唯一**判据来源。写成纯函数是因为每个分支都对应
// 「用户此刻要做的一件不同的事」—— 合并任意两条都会把人引错方向。
//
// **2026-09-02：从七个分支砍到四个。** 密钥柜那条路（建柜 / 解锁 / 填 key）
// 整个删掉了 —— 用户原话：「取消密钥柜的概念呢，单纯用 oh my pi 成熟的
// 登录流程然后 UI 化。」omp 的 auth-broker 覆盖 69 家、需要 key 的自己会问。
// 那套平行系统制造的 bug 比它解决的多。

const base = { installed: true, provider: undefined as string | undefined, loggedIn: false, model: undefined as string | undefined }

test('二进制不在 → blocked，且**不是**「去配 provider」', () => {
  assert.equal(nextStepOf({ ...base, installed: false }).k, 'blocked')
})

test('没选服务商 → 选服务商', () => {
  assert.equal(nextStepOf(base).k, 'provider')
})

test('选了但 omp 还没这家的凭证 → 去登录（**不是**去填 key，那条路没了）', () => {
  assert.equal(nextStepOf({ ...base, provider: 'minimax-code-cn' }).k, 'login')
})

test('登进去了、还没挑模型 → 选模型', () => {
  assert.equal(nextStepOf({ ...base, provider: 'minimax-code-cn', loggedIn: true }).k, 'model')
})

test('都齐了 → ready', () => {
  assert.equal(
    nextStepOf({ installed: true, provider: 'minimax-code-cn', loggedIn: true, model: 'minimax-code-cn/MiniMax-M3' }).k,
    'ready'
  )
})

test('**入参只在 `ompStateFrom` 拼一次** —— 两侧各拼各的曾经分叉过（单测全绿、真机全错）', () => {
  const s = ompStateFrom({ installed: true, provider: 'zai', loggedIn: true, model: 'zai/glm-5' })
  assert.deepEqual(s, { installed: true, provider: 'zai', loggedIn: true, model: 'zai/glm-5' })
})

// ── 起进程之前那道闸 ──────────────────────────────────────────────────────

test('**闸门只剩一条判据**：没选服务商才拦，其余交给 omp 自己报', () => {
  const no = ompLaunchGate({})
  assert.equal(no.ok, false)
  if (!no.ok) {
    assert.equal(no.reason, 'no-provider')
    // 不许出现环境变量名 —— 用户从没见过 `EAS_OMP_*`，那是我们的实现细节
    assert.ok(!/EAS_OMP|[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(no.message), no.message)
  }
  assert.equal(ompLaunchGate({ provider: 'minimax-code-cn' }).ok, true)
})

// ── 「omp 认不认这家」：判据是问它，不是查我们自己的账本 ──────────────────

const M = (...ids: string[]) => ids.map((id) => ({ id }))

test('omp 列得出这家的模型 → 才算真的登录上了', () => {
  assert.equal(ompLoggedInFrom({ models: M('minimax-code-cn/MiniMax-M3'), providerId: 'minimax-code-cn', hint: true }), true)
})

test('**一个都列不出来 → 不算，哪怕我们自己记着「登录过」**', () => {
  // 真机现场：loggedInAt 写着，agent.db 里 auth_credentials 是 0 条。
  assert.equal(ompLoggedInFrom({ models: [], providerId: 'minimax-code-cn', hint: true }), false)
})

test('列出来的是别家的 → 也不算（登过 A 不等于登上了 B）', () => {
  assert.equal(ompLoggedInFrom({ models: M('zai/glm-5'), providerId: 'minimax-code-cn', hint: true }), false)
})

test('**探测失败（undefined）才退回我们自己的记录** —— 探不到 ≠ 没登录', () => {
  assert.equal(ompLoggedInFrom({ models: undefined, providerId: 'minimax-code-cn', hint: true }), true)
  assert.equal(ompLoggedInFrom({ models: undefined, providerId: 'minimax-code-cn', hint: false }), false)
})

test('没选服务商 → 一律 false', () => {
  assert.equal(ompLoggedInFrom({ models: M('zai/glm-5'), providerId: undefined, hint: true }), false)
})

test('**存的模型不在 omp 的清单里 → 当成没选**，把人送回选模型那步', () => {
  assert.equal(ompModelUsable(M('minimax-code-cn/MiniMax-M3'), 'minimax-code-cn/MiniMax-M2'), false)
  assert.equal(ompModelUsable(M('minimax-code-cn/MiniMax-M3'), 'minimax-code-cn/MiniMax-M3'), true)
})

test('探测失败时不判它坏 —— 探不到 ≠ 不存在', () => {
  assert.equal(ompModelUsable(undefined, 'minimax-code-cn/MiniMax-M3'), true)
})

test('压根没存模型 → false（那本来就该去选）', () => {
  assert.equal(ompModelUsable(M('a/b'), undefined), false)
})

// ── 登录失败要说人话，不给用户看日志（2026-09-02 用户提的）─────────────────
//
// 用户原话：「如果真的失败，不要给用户看日志，而是 popup 的形式告诉用户填错了
// 还是其他的什么，不要让用户在软件中看到开发者看的东西。」
//
// 所以要把 omp 的输出**分类**成一句人话 + 一个明确的下一步动作。
// 分不出来的也不能倒日志 —— 那时就诚实说「没成功」，并把日志留给日志文件。


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

// ── 存下来的模型也可能已经不存在了 ────────────────────────────────────────

test('**存的模型不在 omp 的清单里 → 当成没选**，把人送回选模型那步', () => {
  // 换过套餐、模型下架、或者存的是上一家的。留着它的后果是起会话时
  // omp 解析不到，报一句跟「模型」毫无关系的错。
  assert.equal(ompModelUsable(M('minimax-code-cn/MiniMax-M3'), 'minimax-code-cn/MiniMax-M2'), false)
  assert.equal(ompModelUsable(M('minimax-code-cn/MiniMax-M3'), 'minimax-code-cn/MiniMax-M3'), true)
})

test('探测失败时不判它坏 —— 探不到 ≠ 不存在', () => {
  assert.equal(ompModelUsable(undefined, 'minimax-code-cn/MiniMax-M3'), true)
})

test('压根没存模型 → false（那本来就该去选）', () => {
  assert.equal(ompModelUsable(M('a/b'), undefined), false)
})

