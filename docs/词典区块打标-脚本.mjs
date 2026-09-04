// 给词条打「区块」标签（= 这条手法适合用在页面的哪一块）。
//
// ── 三条信号，按精度从高到低 ────────────────────────────────────────────
// ① **二级分类映射**（主力）：二级本身就编码了「这条词条是干什么的」，
//    比在散文里找关键词准得多。「浮层与提示」下的每一条都属于弹层，无一例外。
// ② **名字/关键词强匹配**：词条自己就叫「侧边栏」「卡片堆叠」的，直接对号入座。
// ③ **人工补充表**：跨类目的高价值手法（毛玻璃用在弹层/导航栏/卡片）——
//    这类靠前两条都捞不到，只能一条条点名。
//
// ── 为什么**不**在提示词正文里找关键词 ──────────────────────────────────
// 试过，精度不能看：通用手法的说明里几乎必然拿区块举例（「卡片之间的间距」
// 「按钮的悬停态」），于是「按钮」那一格塞进了点阵、丝绸、3D 模型、波浪，
// 「表单」塞进了记忆化和暗色模式。**举例 ≠ 适用。**
// 另外 prompt 结尾的【坑】段写的是「别用在哪」，是**反话** ——
// 全文扫会把「想要首屏强冲击力时不够看」当成「适用于首屏」。
import { readFileSync, writeFileSync } from 'node:fs'
const P = 'src/renderer/src/features/dict/dictionary-bundle.json'

/** ① 二级 → 区块。没列出的二级 = 通用手法，不默认归任何区块。 */
const CAT2_BLOCKS = {
  '输入与补全': ['表单', '搜索'],
  '提交与撤销': ['表单'],
  '键盘与焦点': ['表单'],
  // 只给表单：这一支下面是输入框 / 滑块 / 滚轮选择，都是**表单控件**不是按钮。
  // 按钮那格靠「点击反馈」整支 ＋ 名字匹配，宁可少也别混。
  '控件形态': ['表单'],
  '长列表性能': ['列表'],
  '分页与加载': ['列表'],
  '图集与画廊': ['图集', '轮播'],
  '跑马灯与循环': ['轮播'],
  '浮层与提示': ['弹层'],
  '点击反馈': ['按钮'],
  '菜单展开': ['弹层'],
  '骨架与指示': ['空状态'],
  '占位与懒加载': ['空状态'],
  '分块与水合': ['首屏']
  // 「拖放与排序」**故意不映射到列表** —— 这一支下面还有贴纸、可调整大小、
  // 框选，那些是画布/面板的事，不是列表的事。列表里真正要的拖拽排序
  // 靠名字匹配捞得到。
}

/** ② **只匹配词条自己的名字（zh/en）。**
 *  刻意不看 `keywords` —— 那份是给搜索用的、故意放宽的（「导航」的关键词里
 *  有「菜单」「卡片」），拿它打标会让一条词条同时落进弹层、卡片、按钮三格。 */
const NAME_RE = {
  '导航栏': /导航栏|navbar|顶栏|面包屑/i,
  '标签栏': /标签栏|tabbar|标签页|选项卡|底部导航/i,
  '金刚区': /金刚区|宫格|图标组|程序坞|\bdock\b/i,
  '首屏': /首屏|\bhero\b|banner|头图|英雄/i,
  '轮播': /轮播|carousel|swiper|走马灯|跑马灯/i,
  '列表': /列表|信息流|\bfeed\b|无限滚动|瀑布流|下拉刷新/i,
  '卡片': /卡片|名片|\bcard\b/i,
  '表单': /表单|输入框|\bform\b|滑块|开关/i,
  // 「菜单」不放这里 —— 二级「菜单展开」已经整支映射过来了，
  // 再按名字捞会把「导航」「程序坞」这些也算成弹层
  '弹层': /弹窗|弹层|浮层|modal|dialog|popup|气泡|tooltip|抽屉|drawer|轻提示|toast/i,
  '侧边栏': /侧边栏|sidebar/i,
  '表格': /表格|\btable\b|数据网格/i,
  '空状态': /空状态|骨架|skeleton|占位/i,
  '搜索': /搜索|\bsearch\b|自动补全|命令面板/i,
  '页脚': /页脚|footer/i,
  '图集': /图集|画廊|gallery|灯箱|图片墙|图片流/i,
  '按钮': /按钮|\bbutton\b|水波纹|ripple/i
}

/** ③ 人工补充：跨类目的高价值手法。**id → 区块**，用 id 不用名字（有重名）。 */
const MANUAL = {
  'glassmorphism': ['弹层', '导航栏', '卡片'],
  'shadow-elevation': ['卡片', '弹层'],
  'sticky-header': ['导航栏'],
  'scroll-lock': ['弹层'],
  'focus-trap': ['弹层'],
  'click-target': ['按钮'],
  'affordance': ['按钮'],
  'skip-link': ['导航栏'],
  'scroll-restoration': ['列表'],
  'bento-grid': ['卡片'],
  'tilt-3d': ['卡片'],
  'safe-area': ['标签栏'],
  'scroll-snap': ['轮播'],
  'progressive-image': ['图集'],
  'lazy-load': ['图集', '列表'],
  'swipe-gesture': ['轮播', '列表'],
  'pull-to-refresh': ['列表'],
  // ── 卡面手法。这批全是「作用在一块矩形表面上」的效果，二级映射和名字都捞不到
  //    （它们的二级是「阴影与浮雕」「金属与虹彩」「悬停高光」这些通用类目），
  //    但做卡片时最先要挑的就是它们。
  'elevation': ['卡片', '弹层'],
  'inner-shadow': ['卡片', '按钮'],
  'drop-shadow': ['卡片'],
  'bevel': ['卡片', '按钮'],
  'gloss-specular': ['卡片', '按钮'],
  'holographic': ['卡片'],
  'metallic': ['卡片', '按钮'],
  'neumorphism': ['卡片', '按钮'],
  'claymorphism': ['卡片', '按钮'],
  'tilt-effect': ['卡片'],
  'fx-TiltedCard': ['卡片'],
  'fx-ElectricBorder': ['卡片', '按钮'],
  'fx-BorderGlow': ['卡片', '按钮'],
  'fx-GlareHover': ['卡片', '按钮'],
  'fx-PixelTransition': ['卡片', '图集'],
  'fx-ScrollStack': ['卡片', '列表'],
  'clip-path-reveal': ['卡片'],
  'container-transform': ['卡片', '弹层'],
  'shared-element-transition': ['图集', '列表'],
  // ── 导航族：这几条是导航栏/标签栏的主力，二级在「菜单展开」「吸附与锁定」
  'tabs': ['标签栏'],
  'accordion': ['侧边栏', '弹层'],
  'safe-area-inset': ['标签栏'],
  'fx-SnapSections': ['首屏']
}
export const BLOCK_NAMES = Object.keys(NAME_RE)
const MAX = 3

export function tagsOf(t) {
  const out = new Set(CAT2_BLOCKS[t.cat2] ?? [])
  const name = `${t.zh} ${t.en}`
  for (const [k, re] of Object.entries(NAME_RE)) if (re.test(name)) out.add(k)
  for (const k of MANUAL[t.id] ?? []) out.add(k)
  // 名字明说是导航族的，就不再算「弹层」——「菜单展开」那一支整支映射到弹层，
  // 会把叫「导航」「侧边栏」「程序坞」的也带进去，而它们是常驻结构不是浮层
  if (/导航|侧边栏|sidebar|标签栏|程序坞|\bdock\b|宫格|图标组/i.test(name)) out.delete('弹层')
  return [...out].slice(0, MAX)
}

const b = JSON.parse(readFileSync(P, 'utf8'))
if (process.argv[2] === 'report') {
  const by = Object.fromEntries(BLOCK_NAMES.map((k) => [k, []]))
  let none = 0
  for (const t of b.terms) {
    const g = tagsOf(t)
    if (!g.length) none++
    for (const k of g) by[k].push(t.zh)
  }
  for (const [k, v] of Object.entries(by).sort((a, c) => c[1].length - a[1].length)) {
    console.log(`\n【${k}】${v.length}`)
    console.log('  ' + v.join(' · '))
  }
  console.log('\n无标签:', none, '/', b.terms.length)
} else if (process.argv[2] === 'write') {
  let n = 0
  for (const t of b.terms) {
    const g = tagsOf(t)
    if (g.length) { t.blocks = g; n++ } else delete t.blocks
  }
  // 压缩格式（见 scripts/dict-svg/apply.mjs:33 的教训）
  writeFileSync(P, JSON.stringify(b))
  console.log('✓ 写入', n, '条带区块标签 /', b.terms.length)
}
