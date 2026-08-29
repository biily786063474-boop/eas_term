// 选项识别的测试。**正负样本都来自本机 agent-history 的真语料**——
// 那 637 条 assistant 正文里，结尾是 2-6 项列表的一共 4 条，
// 其中真正在问「选哪个」的只有 1 条。这 4 条全在下面，
// 判据要是哪天改松了，那 3 条负样本会立刻变红。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { optionsOf } from './options.ts'

// ── 真语料 · 正样本（唯一的那条）──────────────────────────────────
const REAL_POSITIVE = `- 18 套配色只挑了但没删减，最终产品应该收到 6-8 套精选，等你定
- \`GL-001\` 的货架预览图不具代表性，已加"叠加类效果"角标提示，但那张图本身没法救

👉 **建议下一步**（推荐第一个）
1. **补跑 T8 复审，然后直接做 T9 + T10** —— 跑完你就能真的从货架一路走到导出图片
2. 先真机验一遍现有四幕，确认交互手感没问题再往下做
3. 停下来处理配色收编和 \`GL-001\` 预览这类产品层问题`

test('真语料正样本：认得出三个选项，并把破折号后面的解释拆开', () => {
  const r = optionsOf(REAL_POSITIVE)
  assert.ok(r, '这条必须认出来')
  assert.equal(r.options.length, 3)
  assert.equal(r.options[0].label, '补跑 T8 复审，然后直接做 T9 + T10')
  assert.ok(r.options[0].detail?.startsWith('跑完你就能'))
  assert.equal(r.options[1].label, '先真机验一遍现有四幕，确认交互手感没问题再往下做')
  assert.equal(r.options[1].detail, undefined, '没有破折号就不该硬拆出 detail')
  assert.equal(r.lead, '👉 建议下一步（推荐第一个）', 'markdown 记号要去掉')
})

// ── 真语料 · 三条负样本 ────────────────────────────────────────
test('负样本①「两个新问题…」是陈述，不是选项', () => {
  assert.equal(
    optionsOf(`两个新问题，一个是真 bug、一个是我的测试没写对：
1. **FW-012 冲击波 98/100 死平** —— 粒子被波及的范围没变
2. **「拉满后无法恢复」3 个** —— 我的恢复测试全程没有复位`),
    null
  )
})

test('负样本②「現在的状态：」是陈述', () => {
  assert.equal(
    optionsOf(`現在的状态：
- 已完成未验证：耳朵左右符号修正、狗的耳根锚点恢复
- 等你操作：画板重新登录 → 我重发小兔+小熊
- 等你验收：猫的耳尖朝向、耳根有没有可见横边`),
    null
  )
})

test('负样本③「**疑虑**（详见 …）：」是陈述', () => {
  assert.equal(
    optionsOf(`**疑虑**（详见 \`task-6-report.md\`）：
- 简报 Step 1 的测试替身没有覆盖超时分支
- spec §四「网络不可达 → 整体降级为 stale」这条没实现`),
    null
  )
})

// ── 判据逐条 ──────────────────────────────────────────────────
test('列表不在结尾就不算 —— 问完还接着说别的，那不是在等你回答', () => {
  assert.equal(
    optionsOf(`你想怎么办？
1. 方案甲
2. 方案乙

我先去看一眼代码。`),
    null
  )
})

test('只有一项不是选择', () => {
  assert.equal(optionsOf('要不要现在做？\n1. 现在做'), null)
})

test('超过六项是清单不是选项', () => {
  const many = Array.from({ length: 7 }, (_, i) => `${i + 1}. 第 ${i + 1} 项`).join('\n')
  assert.equal(optionsOf('你选哪个？\n' + many), null)
})

test('标记混族不算一组（`-` 和 `1.` 混着多半不是并列选项）', () => {
  assert.equal(optionsOf('你选哪个？\n1. 甲\n- 乙'), null)
})

test('没有引导句不算 —— 光有列表判不出是不是在问', () => {
  assert.equal(optionsOf('1. 甲\n2. 乙'), null)
})

test('引导句是陈述句不算，哪怕结构完全符合', () => {
  assert.equal(optionsOf('我做了这些事：\n1. 甲\n2. 乙'), null)
})

test('单项太长不算 —— 选项是短的，长段落是论述', () => {
  const long = 'x'.repeat(130)
  assert.equal(optionsOf(`你选哪个？\n1. ${long}\n2. 短的`), null)
})

test('两项一模一样说明解析错了，不是两个选项', () => {
  assert.equal(optionsOf('你选哪个？\n1. 一样的\n2. 一样的'), null)
})

// ── 各种能认出来的形状 ────────────────────────────────────────
test('圆点、字母、中文顿号标记都认', () => {
  assert.equal(optionsOf('要不要做？\n- 做\n- 不做')?.options.length, 2)
  assert.equal(optionsOf('你选哪个？\nA. 甲\nB. 乙')?.options.length, 2)
  assert.equal(optionsOf('你选哪个？\n1、甲\n2、乙')?.options.length, 2)
})

test('**`1.5 倍速` 不能被当成标记** —— 句点后必须有空格，这是顿号放宽时的对照', () => {
  assert.equal(optionsOf('你选哪个？\n1.5 倍速\n2.0 倍速'), null)
})

test('问号本身就够格当引导句', () => {
  const r = optionsOf('Which one do you prefer?\n1. First\n2. Second')
  assert.equal(r?.options.length, 2)
})

test('「还是」这种口语选择句认得出', () => {
  assert.ok(optionsOf('先做甲还是先做乙\n1. 先做甲\n2. 先做乙'))
})

test('反引号和粗体在标签里被去掉', () => {
  const r = optionsOf('你选哪个？\n1. **改 `foo.ts`**\n2. 不改')
  assert.equal(r?.options[0].label, '改 foo.ts')
})

test('空正文 / 空白正文不抛', () => {
  assert.equal(optionsOf(''), null)
  assert.equal(optionsOf('   \n  '), null)
  assert.equal(optionsOf(undefined as unknown as string), null)
})
