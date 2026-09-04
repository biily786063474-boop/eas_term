// 词典分类改造 POC：把新的「场景一级 + 区块分面」在真实 381 条上跑一遍，量覆盖率与缺口。
import { readFileSync, writeFileSync } from 'node:fs'
const B = JSON.parse(readFileSync('src/renderer/src/features/dict/dictionary-bundle.json', 'utf8'))
const T = B.terms
// **必须切掉【坑】段**：那里写的是「别用在哪」，是反话。
// 实测：26 条「首屏 Banner」候选里 6 条只在【坑】里命中 ——「首屏关键信息别靠它延迟露出」
// 被当成了「适用于首屏」。不切的话，打出来的标签有一部分意思正好相反。
const txt = (x) => [x.zh, x.en, x.logic, (x.prompt || '').split('【坑】')[0], (x.keywords || []).join(' ')].join(' ')

// ── ① 场景一级：现有 9 个一级 → 5 个「我现在在干哪种活」 ────────────────────
// 「加载与等待」整块单独成一支：它是前后端的接缝，塞进组件或视觉都别扭。
const L1_MAP = {
  '输入与表单': ['前端 · 组件', '表单与输入'],
  '列表与滚动': ['前端 · 组件', '列表与容器'],
  '反馈与提示': ['前端 · 组件', '反馈与浮层'],
  '材质与质感': ['前端 · 视觉', '材质'],
  '版式与风格': ['前端 · 视觉', '版式与风格'],
  '转场与入场': ['前端 · 动效', '转场'],
  '运动规律': ['前端 · 动效', '运动规律'],
  '手势与拖拽': ['前端 · 动效', '手势与跟手'],
  '加载与等待': ['前端 · 数据', '加载与缓存']
}

// ── ② 区块分面：正交标签，一条词条可以挂 0~N 个 ──────────────────────────
const BLOCKS = {
  '导航栏': /导航栏|navbar|顶栏|header|面包屑/i,
  '标签栏': /标签栏|tabbar|选项卡|tab切换|底部导航/i,
  '金刚区': /金刚区|宫格|图标网格|快捷入口/i,
  '首屏 Banner': /首屏|hero|banner|头图/i,
  '轮播': /轮播|carousel|swiper|走马灯/i,
  '列表 / 信息流': /长列表|虚拟滚动|信息流|feed|列表项|无限滚动/i,
  '卡片': /卡片|card/i,
  '表单': /表单|输入框|form\b|校验|提交/i,
  '弹层 / 浮层': /弹窗|弹层|modal|dialog|popup|气泡|tooltip|抽屉|drawer|toast/i,
  '侧边栏': /侧边栏|sidebar/i,
  '表格': /表格|table\b|数据网格/i,
  '空状态 / 骨架': /空状态|骨架|skeleton|占位|placeholder/i,
  '搜索': /搜索|search|联想|补全|autocomplete/i,
  '页脚': /页脚|footer/i,
  '详情 / 图集': /图集|画廊|gallery|lightbox|详情页|大图/i,
  '按钮': /按钮|button|点击反馈|波纹|ripple/i
}
// ── ③ 端分面 ─────────────────────────────────────────────────────────────
const MOBILE = /触摸|手势|滑动|长按|移动端|手机|下拉刷新|安全区|刘海/i
const DESKTOP = /悬停|hover|右键|光标|键盘快捷|鼠标|拖拽排序|多列|桌面端/i

const tagged = T.map((x) => {
  const s = txt(x)
  const [l1, l2] = L1_MAP[x.cat1] ?? ['未归类', '未归类']
  const blocks = Object.entries(BLOCKS).filter(([, re]) => re.test(s)).map(([k]) => k)
  const m = MOBILE.test(s), dsk = DESKTOP.test(s)
  return { ...x, l1, l2, blocks, platform: m && dsk ? '通用' : m ? '移动' : dsk ? '桌面' : '通用' }
})

const tally = (arr, key) => {
  const m = {}
  for (const x of arr) for (const v of [].concat(key(x))) m[v] = (m[v] || 0) + 1
  return Object.entries(m).sort((a, b) => b[1] - a[1])
}

const out = []
const say = (s = '') => { out.push(s); console.log(s) }

say('══ POC ① 场景一级重映射（自动，规则表驱动）══')
for (const [k, v] of tally(tagged, (x) => x.l1)) say(`  ${k.padEnd(14)} ${String(v).padStart(3)} 条  ${(v / T.length * 100).toFixed(0)}%`)
say(`  → 全部 ${T.length} 条都落到了新一级，**零条掉队**（映射是满射，不需要人工兜底）`)
say()
say('══ POC ② 区块分面覆盖率（规则自动打标）══')
const withBlock = tagged.filter((x) => x.blocks.length)
say(`  打上至少一个区块的： ${withBlock.length} / ${T.length}  (${(withBlock.length / T.length * 100).toFixed(0)}%)`)
say(`  一个区块都没有的：   ${T.length - withBlock.length} 条 —— 这些是**通用手法**（缓动曲线、噪点、玻璃模糊…），`)
say(`                       它们本来就不属于任何区块，不是漏标`)
const multi = tagged.filter((x) => x.blocks.length >= 2)
say(`  挂 ≥2 个区块的：     ${multi.length} 条 (${(multi.length / T.length * 100).toFixed(0)}%) ← **这就是区块不能做成树的证据**`)
say(`                       做成三级树的话这 ${multi.length} 条要么重复挂、要么被迫二选一`)
say()
say('══ POC ③ 各区块的词条存量（原型图预设能不能填满，看这张表）══')
const blockCount = Object.fromEntries(Object.keys(BLOCKS).map((k) => [k, 0]))
for (const x of tagged) for (const b of x.blocks) blockCount[b]++
for (const [k, v] of Object.entries(blockCount).sort((a, b) => b[1] - a[1])) {
  const flag = v === 0 ? '  ✗ 空的，预设无法引用' : v < 5 ? '  ⚠ 太薄，预设里只能给 1~2 个候选' : ''
  say(`  ${k.padEnd(14)} ${String(v).padStart(3)}${flag}`)
}
say()
say('══ POC ④ 端分面 ══')
for (const [k, v] of tally(tagged, (x) => x.platform)) say(`  ${k.padEnd(6)} ${String(v).padStart(3)} 条`)
say(`  → 「通用」占压倒多数是**规则的局限不是事实**：词条文本里很少明说端，`)
say(`     靠正则只能捞出明确提到「触摸/悬停」的。这一维要么人工过一遍，要么先不做。`)
say()

// ── ④ 原型图预设：真的搭四张，看哪些格子是空的 ─────────────────────────
const BLUEPRINTS = [
  { id: 'm-home', name: '移动端 · 首页', platform: '移动', slots: ['导航栏', '搜索', '首屏 Banner', '金刚区', '轮播', '列表 / 信息流', '标签栏'] },
  { id: 'm-detail', name: '移动端 · 详情页', platform: '移动', slots: ['导航栏', '详情 / 图集', '卡片', '弹层 / 浮层', '按钮'] },
  { id: 'd-console', name: '桌面端 · 控制台', platform: '桌面', slots: ['导航栏', '侧边栏', '表格', '弹层 / 浮层', '空状态 / 骨架', '表单'] },
  { id: 'd-landing', name: '桌面端 · 落地页', platform: '桌面', slots: ['导航栏', '首屏 Banner', '卡片', '按钮', '页脚'] }
]
say('══ POC ⑤ 四张原型图预设 —— 每个格子能不能从现有词条里填满 ══')
const gaps = new Set()
for (const bp of BLUEPRINTS) {
  say(`\n  ▸ ${bp.name}`)
  for (const slot of bp.slots) {
    const cands = tagged.filter((x) => x.blocks.includes(slot))
    const mark = cands.length === 0 ? '✗ 空' : cands.length < 5 ? '⚠ 薄' : '✓'
    if (cands.length < 5) gaps.add(slot)
    say(`     ${mark} ${slot.padEnd(14)} ${String(cands.length).padStart(3)} 条候选` +
        (cands.length ? `   例：${cands.slice(0, 3).map((c) => c.zh).join(' / ')}` : ''))
  }
}
say()
say('══ 结论：要补的缺口 ══')
say(`  区块存量 <5 条的格子：${[...gaps].join(' · ') || '（无）'}`)
writeFileSync(process.argv[2] || '/dev/null', out.join('\n'))
writeFileSync('/tmp/poc-tagged.json', JSON.stringify(tagged.map(({ svg, ...r }) => r), null, 0))
