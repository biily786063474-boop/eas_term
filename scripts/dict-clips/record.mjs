// 按**触发方式**编排演示，一个组件可能有多种触发（实测 14 种组合），
// 所以不枚举分支，而是拆成小节、有哪个演哪个、按 mount→hover→click→scroll 串起来。
//
// 每一节都带一个角标（悬停/点击/滚动），观众才知道**现在演的是哪种交互**——
// 上一版所有交互都是一段"走位+中途点一下"，滚动类根本没演到滚动。
//
// ── 为什么不用 Playwright 的 recordVideo ────────────────────────────────────
// 它按「页面重绘」抓帧、不按墙上时间：静止画面不产生帧，视频时长会严重短于真实耗时
// （实测 Masonry 动作 7.5s、原片只有 3.4s），画面一直动时又反过来。于是**任何按时间
// 推算的裁剪点都是错的** —— 之前反复出现的「录成上一个组件」「只剩 1.5 秒」全是它。
//
// 试过用白闪当画面锚点（negate + blackdetect 找位置），但丢帧严重的组件上白闪本身
// 就可能一帧都没留下，Masonry 反复命中不了，属于给一个错误基础打补丁。
//
// 改用 **CDP Page.startScreencast**：我说什么时候开始就什么时候开始，帧自带时间戳，
// 录完直接按时间戳合成 —— **完全不需要裁剪**，白闪那套机制整个删掉。
import { chromium } from '/Users/biily/Biily/资产收集/交互动效/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'

// ── rec6 相对 rec5 改了什么（2026-08-25）────────────────────────────────
// 用户指出「hover / 拖拽 / 点击特定区域这类的演示都是错的」。查下来两个根因：
//
// **① 交互坐标一直是「舞台的固定比例」，不是真正的元素。**
//    P(.28,.42) 这种点在大舞台上多半落在空背景里。SpotlightCard / TiltedCard /
//    SpecularButton 这些组件只占舞台一小块，指针从旁边划过去，hover 态根本没触发；
//    录出来就是一张静止的图。现在先探出「效果挂在哪个元素上」，所有落点都相对它算。
//
// **② 压根没有拖拽这一节。** ElasticSlider（拖滑杆）、StickerPeel（拖贴纸）、
//    Stack / DomeGallery / InfiniteMenu（拖着转）这些，核心动作就是拖 —— 不拖等于没演。
//
// 顺带：目标远小于舞台时**取景裁到目标**，否则 660px 宽的成片里效果只占中间一小块。
const LIB = '/Users/biily/Biily/资产收集/交互动效'
const NAME = process.argv[2]
const OUTDIR = process.argv[3] || `/tmp/rec4-${NAME}`
const sem = (() => {
  const d = JSON.parse(fs.readFileSync(`${LIB}/prompts/semantic.json`, 'utf8'))
  const items = Array.isArray(d) ? d : d.components || Object.values(d)
  return items.find((x) => x && x.name === NAME)
})()
if (!sem) { console.error('语义索引里没有', NAME); process.exit(1) }

const TR = new Set(sem.triggers || [])
/** 选型台 preview-overrides.json 里可选的录制指令：
 *  `recordSweep: { prop: 'value', values: [1234, 8642, 357], gap: 1400 }`
 *  录制时按序写进那个参数的输入框。给「只在参数变化时才动」的组件用（数字翻滚）。 */
const SWEEP = (() => {
  try {
    const ov = JSON.parse(fs.readFileSync(`${LIB}/playground/preview-overrides.json`, 'utf8'))
    return (ov[NAME] || {}).recordSweep || null
  } catch { return null }
})()
// 小节清单。**顺序固定**：先出现、再悬停、再点击、最后滚动 —— 和用户真实探索一个页面的顺序一致
const SECTIONS = []
// mount 触发的固然要演入场；**collection / element 类即使没标 mount 也要演** ——
// 瀑布流、卡片列表这类，"怎么错峰浮起来的"本身就是它的卖点，
// 而录制开始时入场早演完了，不重放的话前一节画面几乎静止（Masonry 实测只有 5KB）。
// 语义里描述的是「一次性入场」的，即使触发里没标 mount 也要演 ——
// 选型台里组件一挂载就演完了，不重放的话录到的是静止终态。
// 「文字掉落」就是这么漏的：它标的是 ambient|click|hover|scroll，
// 于是整段录制都从「词块已经堆在底部」开始，最精彩的坠落一帧没有。
const ENTRANCE = /坠落|掉落|落下|浮现|浮起|上浮|淡入|进场|入场|逐字|逐词|依次|错落|错峰|落位|弹入|归位|滚动到目标|翻滚到/.test((sem.summary || '') + (sem.motion || ''))
if (TR.has('mount') || ENTRANCE || sem.surface === 'collection' || sem.surface === 'element') SECTIONS.push('mount')
// **triggers 字段并不可靠。** PixelTrail 摘要写着「鼠标划过处逐格点亮」，
// 触发却只标了 mount；RingCarousel / FlyingPosters 写着「随滚轮流动」，
// 触发里也没有 scroll —— 于是录制器压根不演那一节，成片从头静到尾
// （峰值差分 0.18~0.29，等于什么都没发生）。摘要里说了要什么就补什么。
const SUMM = (sem.summary || '') + (sem.motion || '')
const NEEDS_HOVER = /鼠标划过|光标|指针|跟随鼠标|随鼠标|鼠标靠近|悬停/.test(SUMM)
const NEEDS_SCROLL = /滚轮|滚动带|随滚动|滚到|滚动时/.test(SUMM)
if (TR.has('hover') || NEEDS_HOVER || sem.surface === 'cursor') SECTIONS.push('hover')
if (TR.has('click')) SECTIONS.push('click')
// 拖拽：**用显式清单，不用正则**（2026-08-26）。
//
// 原来按 /拖拽|拖动|拖着|拖到|拖出|滑动|甩|按住/ 去匹配摘要，两头都错：
//   多判 —— 中文里这些词同样用来**描述效果**，不是用户操作。
//     「快划会拖出一道烟带」(GhostCursor)、「定时把最前一张甩下去」(CardSwap，自动播放)、
//     「高光沿边框滑动」(SpecularButton)、「内容区横向滑动切换」(Stepper)
//     —— 全被判成 drag，于是录制器去按住拖一个根本不能拖的东西，那一节完全是死的。
//   漏判 —— 收紧正则想解决多判，又把真该拖的滤掉了：ElasticSlider（拖滑杆到头才有
//     橡皮筋）、InfiniteMenu（像转地球一样拖着滚）、Lanyard（拖拽甩动）。
//
// 「效果在动」和「用户在拖」在中文摘要里用词高度重叠，正则分不开。清单只有十来条，
// 直接写死比继续调正则可靠 —— 新增组件时在这里加一行，不加就是不演拖拽（安全的默认）。
const DRAG_LIST = new Set([
  'StickerPeel',      // 拖着挪位置
  'Carousel',         // 可拖拽切换
  'DomeGallery',      // 拖拽转动穹顶
  'ModelViewer',      // 拖拽 360° 转模型
  'Stack',            // 拖拽或点击把最上面一张甩走
  'ElasticSlider',    // 拖滑杆，拖到头轨道才像橡皮筋被拉长
  'InfiniteMenu',     // 拖着滚球面
  'Lanyard',          // 拖拽甩动证件卡，松手带物理惯性
  'CircularGallery',  // 滚轮或拖拽让圆弧转动
  'FallingText'       // 词块砸落后可用鼠标拖拽推开
])
if (DRAG_LIST.has(NAME)) SECTIONS.push('drag')
if (TR.has('scroll') || NEEDS_SCROLL) SECTIONS.push('scroll')
if (!SECTIONS.length) SECTIONS.push('ambient')   // 只有 ambient：静静录一段

// ── 用实测数据剔除空节次（2026-08-26）──────────────────────────────────
// 上面这套推导来自 semantic.json 的 triggers 和摘要关键词，**两者都不可靠**：
// FlyingPosters 标着 hover，实测 hover 完全无反应（0.000），只有滚轮有（19.8）——
// 于是成片里 hover 那一整节是死的，用户报「FlyingPosters 没有效果」就是这么来的。
//
// interaction-map.json 是逐个组件在选型台里实测出来的响应表。这里只做减法：
// 推导说要演、而实测证明没反应的，删掉。**不做加法** —— 实测没覆盖的场景
// （比如需要特定前置状态才触发的）不该由这里凭空补。
//
// mount 和 drag 不参与过滤，理由见 interaction-map.json 的 _说明。
const IMAP = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('./interaction-map.json', import.meta.url), 'utf8')) } catch { return null }
})()
if (IMAP && IMAP[NAME]) {
  const live = new Set(IMAP[NAME].live || [])
  const dropped = SECTIONS.filter((x) => !live.has(x) && x !== 'mount' && x !== 'ambient' && !(x === 'drag' && DRAG_LIST.has(NAME)))
  if (dropped.length) {
    for (const d of dropped) SECTIONS.splice(SECTIONS.indexOf(d), 1)
    console.error(`  · 按实测剔除空节次：${dropped.join('/')}（该组件实测只对 ${[...live].join('/') || '入场'} 有反应）`)
  }
  if (!SECTIONS.length) SECTIONS.push('ambient')
}
// 光标类的悬停要长一点：1.7 秒看不出「跟随」的手感，指针刚划两下就没了
const SEC_MS = { mount: 2200, hover: sem.surface === 'cursor' ? 2600 : 1700, click: 3200, drag: 3000, scroll: 2100, ambient: 3000 }
// **小节最多 3 节。** 成片有 9 秒硬顶，而固定顺序是 mount→hover→click→drag→scroll ——
// 排在最后的那节会被 ffmpeg 直接截掉。实测 StackTransition 全长 8.96s 里
// 前 7.6s 是死的：入场+悬停+点击全没内容，真正的效果在最后 1.4s 还被切了一半。
// 用户看到的就是「hover 上去半天不动」。
//
// 砍谁：先砍 hover（有 drag/click 时它信息量最低），再砍 mount。
// **不砍 drag/scroll/click** —— 那才是这些组件的核心动作。
while (SECTIONS.length > 3) {
  const drop = SECTIONS.includes('hover') && SECTIONS.some((x) => x === 'drag' || x === 'click')
    ? 'hover'
    : (SECTIONS.includes('mount') ? 'mount' : SECTIONS[0])
  SECTIONS.splice(SECTIONS.indexOf(drop), 1)
}
// 成片有 9 秒硬顶（缩略图没人看更久）。小节多的时候按比例压时长，
// 否则最后一节直接被 ffmpeg 截掉 —— 「文字掉落」四节 14.1s，滚动那节等于白录。
const RAW_TOTAL = SECTIONS.reduce((a, s) => a + SEC_MS[s], 0)
if (RAW_TOTAL > 7600) {
  const k = 7600 / RAW_TOTAL
  for (const key of Object.keys(SEC_MS)) SEC_MS[key] = Math.round(SEC_MS[key] * k)
}
const TOTAL = SECTIONS.reduce((a, s) => a + SEC_MS[s], 0) / 1000

const RAW = OUTDIR + '/raw'
fs.rmSync(OUTDIR, { recursive: true, force: true }); fs.mkdirSync(RAW, { recursive: true })
const VW = 1920, VH = 1080

const browser = await chromium.launch()
const T0 = Date.now()
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH },
  // 不再用 recordVideo —— 见文件头
})
const page = await ctx.newPage()
// 端口可用 PG_PORT 覆盖。**默认 5199 是约定，不是 vite 自己会选的值** ——
// 选型台的 vite.config 没写 port，直接 `npm run dev` 会从 5173 往上找空位
// （2026-08-26 实测起在了 5180），录制器连 5199 就直接连不上。
// 起服务时请用 `npx vite --port 5199 --strictPort`。
const PG_PORT = process.env.PG_PORT || '5199'
await page.goto(`http://localhost:${PG_PORT}`, { waitUntil: 'networkidle' })
await page.locator(`.pg-item[data-name="${NAME}"]`).first().click({ timeout: 20000 })
await page.waitForFunction((n) => document.querySelector('.pg-stage-name')?.textContent?.trim() === n, NAME, { timeout: 25000 })
await page.waitForTimeout(900)

// 选型台给某些组件配了引导文字（ClickSpark 的「在这块区域里点一下」那种）。
// 那是**选型台的教学文案**，不是组件效果的一部分，录进去等于把脚手架当成品拍了。
// 只藏文字块，不藏 canvas —— 效果本身要留着。
const slabStyle = await page.addStyleTag({ content: '.pg-demo-slab{opacity:0!important}' }).catch(() => null)
// **藏完要回头看一眼舞台是不是空了。**
// 对 ClickSpark 那类，demo-slab 是选型台的教学文案，藏掉是对的；
// 但对「作用于内容」的滤镜类组件（FluidWarp 把文字搅出水波、GradualBlur 把内容虚化），
// 那块 slab **就是被作用的载体** —— 藏了它效果没有作用对象，录出来一片全黑。
// FluidWarp 实测就是这么变成「9KB 纯黑 + 一个鼠标指针」的，还因此被判成死组件。
if (slabStyle) {
  const blank = await page.evaluate(() => {
    const st = document.querySelector('.pg-stage-inner') || document.querySelector('.pg-stage')
    if (!st) return false
    const sb = st.getBoundingClientRect()
    // 舞台里还有没有「看得见的实体」：canvas / img / video，或有文字且不在 slab 里
    const solid = [...st.querySelectorAll('canvas,img,video,svg')].some((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 40 && r.height > 40 && !e.closest('.pg-demo-slab')
    })
    if (solid) return false
    const text = [...st.querySelectorAll('*')].some((e) => {
      if (e.closest('.pg-demo-slab') || e.children.length) return false
      const t = (e.textContent || '').trim()
      if (!t) return false
      const r = e.getBoundingClientRect()
      return r.width > 20 && r.height > 8 && r.x >= sb.x - 4 && r.y >= sb.y - 4
    })
    return !text
  })
  if (blank) {
    // **用 addStyleTag 返回的 handle 精确删，别按内容去找 style 标签** ——
    // 选型台自己的样式表里同样含 'pg-demo-slab'，按内容匹配会把它一起删掉，
    // 整个页面布局随之崩塌：实测舞台从 (470,370) 跑到 (8,512)，
    // crop 跟着取到画面外，成片一片黑，还看不出是自己搞坏的。
    await slabStyle.evaluate((el) => el.remove())
    // 让它重新显示会改变舞台的尺寸和位置，**必须等重排完再往下量 STAGE** ——
    // 不等的话量到的是旧值，crop 会取到舞台外面，成片一片黑。
    await page.waitForTimeout(500)
    console.error('  · 藏掉 demo-slab 后舞台是空的 → 留着它（这个组件的效果作用在那块内容上）')
  }
}

let box = await page.locator('.pg-stage-inner').first().boundingBox()
if (!box) { console.error('量不到舞台'); process.exit(1) }
const STAGE = { ...box }
// 量错舞台位置会让 crop 取到画面外、成片全黑，而且看不出是哪一步坏的 ——
// 排查时用 REC_DEBUG=1 把它打出来（2026-08-26 就是靠这个抓到 style 被误删那次）
if (process.env.REC_DEBUG) console.error('  [debug] STAGE =', JSON.stringify(STAGE))

/** 探出「效果到底挂在哪个元素上」。
 *
 *  **这是 rec5 最大的毛病**：它把所有落点算成舞台的固定比例（P(.28,.42) 这种），
 *  而 SpotlightCard / TiltedCard / SpecularButton 这些只占舞台一小块 ——
 *  指针从旁边划过去，hover 态压根没触发，录出来是张静止的图。
 *
 *  优先级：能抓能拖的控件 > canvas > 最大的一块实体内容 > 整个舞台。 */
const TARGET = await page.evaluate(() => {
  const stage = document.querySelector('.pg-stage-inner') || document.querySelector('.pg-stage')
  if (!stage) return null
  const sb = stage.getBoundingClientRect()
  const area = sb.width * sb.height
  const ok = (e) => {
    const r = e.getBoundingClientRect()
    // 下限压到 0.4%：滑杆这类又扁又长的控件只占舞台 1.5%，
    // 按 2% 筛会把它整个漏掉（ElasticSlider 实测就瞄成了整个舞台）
    if (r.width < 30 || r.height < 14) return false
    if (r.width * r.height < area * 0.004) return false
    // canvas 铺满舞台是正当的 —— 那就是效果表面本身（matter.js / WebGL 都这样）。
    // 一刀切排除「铺满的元素」会让「文字掉落」瞄到某个词块的 span 而不是画布。
    if (e.tagName !== 'CANVAS' && r.width > sb.width * 0.98 && r.height > sb.height * 0.98) return false
    const cs = getComputedStyle(e)
    if (cs.visibility === 'hidden' || +cs.opacity === 0) return false
    if (e.closest('.pg-demo-slab')) return false      // 选型台的引导文案，不是组件的一部分
    return true
  }
  const all = [...stage.querySelectorAll('*')].filter(ok)
  const A = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height }
  // **每一类里取最大的那个，不是第一个。** 取第一个会瞄到「文字掉落」里的单个词块
  // （76×78 的 span），而真正该瞄的是底下那张 matter.js 画布。
  const biggest = (arr) => arr.length ? arr.reduce((m, e) => (A(e) > A(m) ? e : m)) : null
  const box = (e, why) => { const r = e.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, cur: getComputedStyle(e).cursor, drag: !!e.draggable, why } }

  const grabby = biggest(all.filter((e) => ['grab', 'grabbing', 'move', 'ew-resize', 'col-resize', 'all-scroll'].includes(getComputedStyle(e).cursor) || e.draggable))
  const clicky = biggest(all.filter((e) => getComputedStyle(e).cursor === 'pointer' || /^(BUTTON|INPUT|A)$/.test(e.tagName)))
  const cvs    = biggest(all.filter((e) => e.tagName === 'CANVAS'))
  const block  = biggest(all.filter((e) => A(e) < area * 0.92))

  // **目标是「一群同类里的一个」时，取景要覆盖整群。**
  // DomeGallery 的图片墙有 12 张同类卡片，瞄准其中一张、裁到它，
  // 成片里只看得见一张卡的局部 —— 看不出这是个穹顶图片墙。
  // 同类判据用 className：同一个组件生成的成员类名一致。
  const groupOf = (e) => {
    if (!e) return null
    const sb2 = sb   // 舞台矩形，下面求交要用
    // 同上：SVG 的 className 不是字符串，用 getAttribute
    const cls = ((e.getAttribute && e.getAttribute('class')) || '').trim()
    if (!cls) return null
    const kin = [...stage.querySelectorAll('*')].filter((x) => ((x.getAttribute && x.getAttribute('class')) || '').trim() === cls && ok(x))
    // **门槛定在 8 个，不是 4 个。** 拉远取景是有代价的：内容在成片里占比变小。
    // 实测（改判据前后各录一遍）只有成员多到「一个看不出是什么」的才划算 ——
    //   受益：DomeGallery 69 个（0.46→6.76）、OptionWheel 11 个（0.16→2.49）
    //   受损：Carousel 5 个（0.46→0.24）、AnimatedList 6 个、ChromaGrid 4 个、FlowingMenu 4 个
    // 四五个成员时单看一个已经能说明问题，拉远纯粹是把它变小。
    if (kin.length < 8) return null
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (const k of kin) { const r = k.getBoundingClientRect()
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom) }
    // **必须和舞台求交。** 轮播这类成员会滑到舞台外面去 —— Carousel 的整群包围盒
    // 是 1404×229，比舞台还宽，面积占到舞台的 69%，于是撞上后面「目标接近舞台就不裁」
    // 那条分支，取景被迫拉成整个舞台，卡片只占中间一小块（动量从 0.46 掉到 0.05）。
    x0 = Math.max(x0, sb2.x); y0 = Math.max(y0, sb2.y)
    x1 = Math.min(x1, sb2.x + sb2.width); y1 = Math.min(y1, sb2.y + sb2.height)
    if (x1 - x0 < 60 || y1 - y0 < 40) return null
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, n: kin.length }
  }
  const big = (e) => e && A(e) >= area * 0.03
  const withGroup = (e, why) => {
    const g = groupOf(e)
    // 整群比单个大出一截才值得换 —— 否则等于白白把画面拉远
    if (g && g.width * g.height > A(e) * 2.2) return { ...g, cur: getComputedStyle(e).cursor, drag: !!e.draggable, why: `${why}·整群${g.n}个` }
    return box(e, why)
  }
  if (big(grabby)) return withGroup(grabby, 'grab/draggable')
  if (big(clicky)) return withGroup(clicky, 'pointer/控件')
  if (cvs) return box(cvs, 'canvas')                 // 控件太碎时画布才是真正的舞台
  // **兜底到小控件时，取景要退到装着它的那一层。**
  // 所有导航组件都走这条：能抓的最大元素是**单个导航项**（GooeyNav 的 A 是 56×38、
  // PillNav 68×36），裁到它就只剩一个按钮放大糊在画面里 —— 导航条长什么样、
  // 药丸滑到哪一项，全看不见。而导航条本体就在父链上一两层
  // （GooeyNav 的 UL 352×38、PillNav 的 UL 289×42，各装 4 个同类项）。
  //
  // 判据：往上最多找 4 层，父元素要装着 ≥3 个孩子、面积比当前目标大出一截、
  // 又不能大到接近整个舞台（那等于没裁）。
  const containerOf = (e) => {
    let cur = e
    for (let i = 0; i < 4 && cur && cur !== stage; i++) {
      const par = cur.parentElement
      if (!par || par === stage) break
      const pr = par.getBoundingClientRect()
      // **只退到「横向条状」的容器。** 拉远取景是有代价的，实测只有导航条那种
      // 宽高比大的划算 —— 一条导航裁到单个按钮就什么都看不出来，而拉到整条正好：
      //   受益：GooeyNav 352×38（9.3:1，0.46→1.70）、PillNav 289×42（6.9:1，0.30→1.37）
      //   受损：GlassIcons 329×280（1.2:1，0.63→0.19）、StaggeredMenu 364×280（1.3:1，5.57→3.72）
      //   LineSidebar 148×516 是竖的（0.29:1），退到容器会裁出 660×1696 —— 浮层里高得没法看
      // 横条（导航条）和竖条（侧边栏）都算「条状」，都值得退到整条看；
      // 方形的不退 —— 那种拉远纯粹是把内容变小（GlassIcons 1.2:1 实测 0.63→0.19）。
      const ar = pr.width / Math.max(1, pr.height)
      // **容器里得真有「一群同类」，不能只是「≥3 个孩子」。**
      // GooeyNav 的 UL 装着 4 个 className 一样的 LI —— 目标只是其中一个，
      // 不看整条就不知道药丸滑到了哪一项；而 CurvedInput 的外框虽然也有三个孩子
      // （图标 / 输入框 / 按钮），彼此并不同类，目标本身就是效果所在，
      // 拉远只是把它变小（实测 0.53→0.14）。
      // **必须用 getAttribute('class')，不能用 .className。**
      // SVG 元素的 className 是 SVGAnimatedString 对象，toString() 全是
      // `[object SVGAnimatedString]` —— CurvedInput 的目标在 <svg> 里，
      // 8 个孩子于是全被算成「同类」，这条判据形同虚设（实测 0.53→0.14 还照样退容器）。
      const kinds = {}
      for (const c of par.children) {
        const k = (c.getAttribute && c.getAttribute('class')) || ''
        if (k.trim()) kinds[k.trim()] = (kinds[k.trim()] || 0) + 1
      }
      const sameKin = Math.max(0, ...Object.values(kinds))
      if (sameKin >= 3 && A(par) > A(e) * 2.5 && A(par) < area * 0.85 &&
          (ar > 3 || ar < 0.4)) return par
      cur = par
    }
    return null
  }
  const withContainer = (e, why) => {
    const c = containerOf(e)
    return c ? box(c, `${why}→容器`) : box(e, why)
  }
  if (grabby) return withContainer(grabby, 'grab(小)')
  if (clicky) return withContainer(clicky, 'pointer(小)')
  return block ? box(block, '最大实体块') : null
})

// ── 点击会展开的组件：取景按**展开后**的尺寸来（2026-08-26）──────────────
// 取景一直是按「当前这一刻的目标」算的，而 BubbleMenu 收起时只是一枚 898×56 的
// 胶囊、点开后铺满 898×518（面积 9.3 倍），CardNav 也有 4.3 倍。
// 按收起状态取景，点开的那一瞬间内容全跑到画面外 —— 用户看到的是「点了一下，
// 然后什么都没有」。
//
// 做法：录制**开始前**先预演一次点击，量出展开后的内容边界，再重新选中组件复位。
// 多花一次交互的时间，换的是这类组件能看到全貌。
let EXPANDED = null
if (SECTIONS.includes('click')) {
  const bboxOf = () => page.evaluate((sb) => {
    const st = document.querySelector('.pg-stage-inner') || document.querySelector('.pg-stage')
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0
    for (const e of st.querySelectorAll('*')) {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e)
      if (r.width < 6 || r.height < 6) continue
      if (cs.visibility === 'hidden' || +cs.opacity === 0) continue
      if (e.closest('.pg-demo-slab')) continue
      if (r.right < sb.x || r.left > sb.x + sb.width || r.bottom < sb.y || r.top > sb.y + sb.height) continue
      x0 = Math.min(x0, Math.max(r.left, sb.x)); y0 = Math.min(y0, Math.max(r.top, sb.y))
      x1 = Math.max(x1, Math.min(r.right, sb.x + sb.width)); y1 = Math.max(y1, Math.min(r.bottom, sb.y + sb.height)); n++
    }
    return n ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
  }, { x: STAGE.x, y: STAGE.y, width: STAGE.width, height: STAGE.height })
  const before = await bboxOf()
  const pt = await page.evaluate((sb) => {
    const st = document.querySelector('.pg-stage-inner') || document.querySelector('.pg-stage')
    const e = [...st.querySelectorAll('*')].find((e) => {
      const r = e.getBoundingClientRect()
      return r.width >= 14 && r.height >= 14 && !e.closest('.pg-demo-slab') &&
        (getComputedStyle(e).cursor === 'pointer' || /^(BUTTON|A)$/.test(e.tagName) || e.getAttribute('role') === 'button') &&
        r.x >= sb.x - 2 && r.y >= sb.y - 2 && r.right <= sb.x + sb.width + 2 && r.bottom <= sb.y + sb.height + 2
    })
    if (!e) return null
    const r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]
  }, { x: STAGE.x, y: STAGE.y, width: STAGE.width, height: STAGE.height })
  if (pt && before) {
    await page.mouse.click(pt[0], pt[1])
    await page.waitForTimeout(1000)
    const after = await bboxOf()
    if (after && after.width * after.height > before.width * before.height * 1.6) {
      EXPANDED = after
      console.error(`  · 点开后展开 ${(after.width*after.height/(before.width*before.height)).toFixed(1)}× → 取景按展开后算`)
    }
    // **复位**：重新选中一次组件，让它卸载重挂。不复位的话下面正式录制时
    // 组件已经是展开态，「点开」那一下就没得演了。
    await page.locator(`.pg-item[data-name="${NAME}"]`).first().click({ timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(900)
  }
}

// 落点基准：有目标就用目标，没有才退回舞台。**这是本轮修的核心。**
//
// 但目标可能整个在舞台外（轮播卡片会滑出可视区，Carousel 的目标在 x=1672，
// 舞台右缘才 1370）。那时候朝它派发的鼠标事件全打在空白页面上，
// 一个 hover 都触发不了 —— 取景救回来了、交互还是空的，比直接报错更难发现。
const inStage = (t) => t &&
  t.x + t.width > STAGE.x + 8 && t.x < STAGE.x + STAGE.width - 8 &&
  t.y + t.height > STAGE.y + 8 && t.y < STAGE.y + STAGE.height - 8
if (TARGET && !inStage(TARGET)) {
  console.error(`  ⚠ 目标在舞台外（${Math.round(TARGET.x)},${Math.round(TARGET.y)}），落点退回舞台`)
}
const AIM = (TARGET && inStage(TARGET))
  ? { x: TARGET.x, y: TARGET.y, width: TARGET.width, height: TARGET.height }
  : { x: STAGE.x, y: STAGE.y, width: STAGE.width, height: STAGE.height }

// 取景：目标远小于舞台时裁到目标（留 22% 余量），否则 660px 成片里效果只占中间一小撮。
// rec5 只对「唯一小节是 click」的裁到舞台中间 58%，那是拍脑袋的固定比例，
// 目标偏在一角（CardSwap 在右下、Dock 在底部）就直接裁没了。
// 展开后的边界优先：它才是这个组件真正要占的地方
if (EXPANDED) {
  const pad = 10
  const x0 = Math.max(STAGE.x, EXPANDED.x - pad), y0 = Math.max(STAGE.y, EXPANDED.y - pad)
  const x1 = Math.min(STAGE.x + STAGE.width, EXPANDED.x + EXPANDED.width + pad)
  const y1 = Math.min(STAGE.y + STAGE.height, EXPANDED.y + EXPANDED.height + pad)
  if (x1 - x0 >= 80 && y1 - y0 >= 60) box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
} else if (TARGET && inStage(TARGET) && TARGET.width * TARGET.height < STAGE.width * STAGE.height * 0.5) {
  // 目标越小留白越多：不然 660px 成片里目标顶满画面，角标直接压在控件上
  const k = TARGET.width * TARGET.height < STAGE.width * STAGE.height * 0.12 ? 0.55 : 0.24
  const px = TARGET.width * k
  // **很扁的目标，纵向要多留一点。** 留白按目标自身尺寸的比例算，
  // 导航条那种 352×38 的目标纵向只留得到 20px，成片里它上下贴着边，
  // 看不出这是浮在页面上的一条导航（GooeyNav 实测裁出 660×70，
  // 而这轮之前是 660×118）。横向不动 —— 那个方向本来就够宽。
  const arT = TARGET.width / TARGET.height
  // 扁的多留纵向余量（见上）；**竖的反过来要少留** —— 侧边栏 148×516 按 0.55 留白
  // 会变成 311×1084，成片被拉成 660×2300 那种细长条。
  const ky = arT > 4 ? Math.max(k, 1.1) : (arT < 0.6 ? Math.min(k, 0.14) : k)
  const py = TARGET.height * ky
  // **必须和舞台求交，而且交集为空要退回舞台。**
  // 轮播卡片这类会滑到舞台外面去，直接算 min/max 会得出负宽度，
  // ffmpeg 报 -22 就挂了（Carousel 实测 crop=-174:480:...）。
  const x0 = Math.max(STAGE.x, TARGET.x - px), y0 = Math.max(STAGE.y, TARGET.y - py)
  const x1 = Math.min(STAGE.x + STAGE.width, TARGET.x + TARGET.width + px)
  const y1 = Math.min(STAGE.y + STAGE.height, TARGET.y + TARGET.height + py)
  if (x1 - x0 >= 80 && y1 - y0 >= 60) box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  else console.error(`  ⚠ 目标基本在舞台外（${Math.round(TARGET.x)},${Math.round(TARGET.y)} ${Math.round(TARGET.width)}×${Math.round(TARGET.height)}），取景退回整个舞台`)
} else if (SECTIONS.length === 1 && SECTIONS[0] === 'click') {
  const k = 0.58
  box = { x: box.x + box.width * (1 - k) / 2, y: box.y + box.height * (1 - k) / 2, width: box.width * k, height: box.height * k }
}

// 指针 + 角标 + 点击涟漪 + 滚轮指示，全在一个覆盖层里
await page.evaluate((b) => {
  const L = document.createElement('div')
  L.id = '__demo'
  L.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647'
  L.innerHTML = `
    <div id="__cur" style="position:absolute;left:0;top:0;will-change:transform">
      <svg viewBox="0 0 22 22" width="34" height="34" style="overflow:visible">
        <circle id="__ring" cx="3" cy="3" r="0" fill="none" stroke="#fff" stroke-width="3" opacity="0"/>
        <path d="M2,2 L2,17 L6.2,13 L9.2,20 L11.8,19 L8.8,12.2 L14,12 Z" fill="#fff" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/>
        <g id="__wheel" opacity="0"><path d="M20,2 l4,-4 l4,4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M20,10 l4,4 l4,-4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>
      </svg>
    </div>
    <div id="__badge" style="position:absolute;left:${b.x + 12}px;top:${b.y + b.height - 34}px;font:600 15px -apple-system,'PingFang SC',sans-serif;color:#fff;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:5px 12px;opacity:0;backdrop-filter:blur(6px)"></div>`
  document.body.appendChild(L)
  const cur = L.querySelector('#__cur'), badge = L.querySelector('#__badge')
  const ring = L.querySelector('#__ring'), wheel = L.querySelector('#__wheel')
  window.__mv = (x, y) => { cur.style.transform = `translate(${x}px,${y}px)` }
  window.__badge = (t) => { badge.textContent = t; badge.style.opacity = t ? '1' : '0' }
  window.__wheel = (on) => { wheel.setAttribute('opacity', on ? '1' : '0') }
  // 拖拽时得看得出「按住了」，否则画面上只是一个指针在飘，读者不知道它按着
  window.__hold = (on) => {
    ring.setAttribute('opacity', on ? '0.95' : '0')
    ring.setAttribute('r', on ? '7' : '0')
    ring.setAttribute('fill', on ? 'rgba(255,255,255,.35)' : 'none')
  }
  // 涟漪放大：660 宽的画面里，16px 半径的圈几乎看不见
  window.__ripple = () => {
    ring.setAttribute('opacity', '1'); let r = 0
    const t = setInterval(() => { r += 2.4; ring.setAttribute('r', String(r)); ring.setAttribute('opacity', String(Math.max(0, 1 - r / 32)))
      if (r > 30) { clearInterval(t); ring.setAttribute('opacity', '0'); ring.setAttribute('r', '0') } }, 16)
  }
}, box)

const mv = async (x, y) => { await page.evaluate(([a, b]) => window.__mv(a, b), [x, y]); await page.mouse.move(x, y) }

/** 让入场动画重播一次。
 *
 *  **为什么要这么绕**：文字动画这类是「进入视口才播」，而选型台里组件一挂载就播完了 ——
 *  等锚点闪完开始录，动画早结束，录到的是静止终态（用户实测指出："文字类看不到效果出现"）。
 *
 *  选型台的重挂载机制在 App.jsx：`remountKey = selected:remountTick`，
 *  而 `remountTick` 在 **propsSignature 变化 350ms 后**自增。所以改任意一个参数
 *  就能强制重挂载 → 动画重播。
 *
 *  React 受控输入不能直接改 .value，必须走原型上的原生 setter 再派发 input 事件，
 *  否则 React 感知不到（改了也白改）。 */
const replay = async () => {
  const ok = await page.evaluate(() => {
    // **不能只找文本框。** Carousel / CardSwap / Stack 的参数面板里一个 input[type=text]
    // 都没有（全是开关和下拉），于是 replay() 直接返回 false —— 入场那一节什么都没做，
    // 录到的是静止终态。选型台的重挂载只看 propsSignature 变没变，改哪个参数都行。
    const nudge = (el) => {
      const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
      if (el.type === 'checkbox') {
        el.click(); setTimeout(() => el.click(), 60); return true
      }
      const set = Object.getOwnPropertyDescriptor(proto, 'value').set
      const orig = el.value
      const tweak = el.type === 'number' || el.type === 'range'
        ? String(+orig + (+el.step || 1)) : orig + ' '
      set.call(el, tweak); el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      setTimeout(() => {
        set.call(el, orig)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, 60)
      return true
    }
    const rows = document.querySelectorAll('.pg-prop-row')
    for (const sel of ['input[type="text"]', 'input[type="number"]', 'input[type="range"]', 'select', 'input[type="checkbox"]']) {
      for (const r of rows) { const el = r.querySelector(sel); if (el) return nudge(el) }
    }
    return false
  })
  if (!ok) return false
  await page.waitForTimeout(520)         // 等 remountTick 那 350ms 的防抖走完
  return true
}

/** 只触发不等待 —— 把那 520ms 的防抖等待藏进白闪期间，
 *  这样白闪一散，画面就已经是动画中段，开头不会有一段静止。 */
const replayNoWait = () => page.evaluate(() => {
  // 和 replay() 同一套「碰一下参数触发重挂载」，只是不等那 520ms 的防抖 ——
  // 把等待藏进开录前，画面一开始就是动画中段而不是静止。
  const nudge = (el) => {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    if (el.type === 'checkbox') { el.click(); setTimeout(() => el.click(), 60); return true }
    const set = Object.getOwnPropertyDescriptor(proto, 'value').set
    const orig = el.value
    const tweak = el.type === 'number' || el.type === 'range' ? String(+orig + (+el.step || 1)) : orig + ' '
    set.call(el, tweak)
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
    setTimeout(() => {
      set.call(el, orig)
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
    }, 60)
    return true
  }
  const rows = document.querySelectorAll('.pg-prop-row')
  for (const sel of ['input[type="text"]', 'input[type="number"]', 'input[type="range"]', 'select', 'input[type="checkbox"]']) {
    for (const r of rows) { const el = r.querySelector(sel); if (el) return nudge(el) }
  }
  return false
})
const badge = (t) => page.evaluate((s) => window.__badge(s), t)
const curPos = () => page.evaluate(() => {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(document.querySelector('#__cur').style.transform)
  return m ? [+m[1], +m[2]] : [0, 0]
})
// 落点相对**目标元素**算，不是相对舞台 —— rec5 就错在这。
// 允许越界（ry>1 用来把指针停到画面外），所以不夹紧。
const P = (rx, ry) => [Math.round(AIM.x + AIM.width * rx), Math.round(AIM.y + AIM.height * ry)]
const glide = async (from, to, steps = 16) => {
  for (let s = 1; s <= steps; s++) { await mv(Math.round(from[0]+(to[0]-from[0])*s/steps), Math.round(from[1]+(to[1]-from[1])*s/steps)); await page.waitForTimeout(16) }
}

// **不能用「从 T0 到现在」当裁剪点。** T0 在 launch 之前，而视频是 newContext 之后
// 才开始录的，中间隔着 launch + goto + 组件加载 —— 两个时间基准差多少完全取决于
// 加载耗时。实测 Masonry 因此被裁得只剩 1.52s（预期 7.1s）。
// 改成**从尾部锚定**：动作耗时是我们自己掐的、确定的，录完拿真实时长反推起点。
await mv(...P(.5, 1.25))        // 起手把指针放在舞台外，别让它一开始就杵在中间
await page.waitForTimeout(200)
// **闪一帧纯白当裁剪锚点。** Playwright 的视频按「页面重绘」抓帧、不按墙上时间：
// 画面静止时不产生帧，视频时长会严重短于真实耗时（实测 Masonry 动作 7.5s、原片只有 3.4s），
// 画面一直动时又反过来。所以按时间推算裁剪点**根本不成立**，两个基准对不上。
// 全屏白闪是画面事件，一定会产生帧，事后用 ffmpeg 找得到它。
const REPLAY_FIRST = SECTIONS[0] === 'mount' || SECTIONS[0] === 'scroll'
if (REPLAY_FIRST) { await replayNoWait(); await page.waitForTimeout(520) }

// ── 开录 ──────────────────────────────────────────────────────────────────
const cdp = await page.context().newCDPSession(page)
const frames = []
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ data: f.data, t: f.metadata.timestamp })
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch {}
})
// **起搏器：强制每帧重绘。**
// CDP 的录屏和 Playwright 的 recordVideo 一样是**重绘驱动**的，不是按时间截屏
// （我一开始以为它是按时间的，实测打脸：8 个组件只抓到 3 帧就失败了）。
// 完全静止的组件、以及纯合成器动画（CSS animation 不走主线程重绘）都不产生帧。
// 在角落放一个 1px 的点，每个 rAF 改一下它的 opacity —— 值在 0.99~1 之间跳，
// 肉眼不可见，但足以让合成器每帧都提交一次。
await page.evaluate(() => {
  const d = document.createElement('div')
  d.id = '__pacer'
  d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;background:#888;z-index:2147483645;pointer-events:none'
  document.body.appendChild(d)
  let on = false
  const tick = () => { on = !on; d.style.opacity = on ? '0.99' : '1'; window.__pacerId = requestAnimationFrame(tick) }
  tick()
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 })

for (const sec of SECTIONS) {
  if (sec === 'mount') {
    await badge('出现')
    // 试过「隔 1.5s 重放一次填满整节」，**实测五个样本全部变差** ——
    // 重挂载期间画面是空的，反而把有动占比拉低（BlurText 31%→11%）。
    // 一次性效果要靠 recordSweep 改驱动它的那个参数，不是靠反复重挂载。
    // 原来这里是找「重放/重置」按钮点一下 —— 页面上唯一匹配的是参数面板的
    // 「重置为默认值」，参数本来就是默认值时点它签名不变、根本不会重挂载。
    if (!REPLAY_FIRST) { if (!(await replay())) console.error('  ⚠ 找不到可改的参数，入场动画没能重放') }
    // **驱动效果的那个参数会变的，就让它变。** 数字翻滚只由 value 变化触发，
    // 静态值永远不动；反复重挂载又会让画面空掉。选型台的
    // preview-overrides.json 里可以给 recordSweep: {prop, values}，
    // 录制时按序写进那个参数的输入框，效果就一轮一轮地演。
    if (SWEEP) {
      // 参数面板里数值型参数**不是 input，是自定义的 .scrubber 拖动条**（没有 input/select），
      // 只能真拖。所以 recordSweep 用 fractions（轨道比例）而不是绝对值。
      const track = await page.evaluate((name) => {
        const row = [...document.querySelectorAll('.pg-prop-row')]
          .find((r) => (r.textContent || '').trim().startsWith(name))
        if (!row) return null
        const t = row.querySelector('.scrubber-track') || row.querySelector('.scrubber')
        if (!t) return { input: !!row.querySelector('input,select') }
        const b = t.getBoundingClientRect()
        return { x: b.x, y: b.y + b.height / 2, w: b.width }
      }, SWEEP.prop)
      if (!track) console.error(`  ⚠ recordSweep 找不到参数行「${SWEEP.prop}」`)
      else if (!track.w) console.error(`  ⚠ 参数行「${SWEEP.prop}」不是 scrubber，暂不支持`)
      else {
        await page.waitForTimeout(500)
        for (const f of SWEEP.fractions ?? [0.15, 0.7, 0.35, 0.9, 0.5]) {
          await page.mouse.move(track.x + track.w * f, track.y)
          await page.mouse.down()
          await page.mouse.move(track.x + track.w * f, track.y)
          await page.mouse.up()
          await page.waitForTimeout(SWEEP.gap ?? 1300)
        }
      }
    } else {
      // REPLAY_FIRST 时入场已经在开录前 520ms 重放过，短入场（BubbleMenu 就是弹个胶囊）
      // 到这儿早演完了，等满 SEC_MS.mount 后半段全是静止。
      // 后面还有别的小节时更没必要占满 —— 把时间让给真正有内容的那节。
      const short = REPLAY_FIRST && SECTIONS.length > 1
      await page.waitForTimeout(short ? Math.min(SEC_MS.mount, 1000) : SEC_MS.mount)
    }
  } else if (sec === 'hover') {
    await badge('悬停')
    // **扫过元素的边和内部，不是斜穿一刀。** BorderGlow 是「靠近哪条边哪条亮」、
    // SpotlightCard 的光斑跟着落点走、TiltedCard 按落点定倾斜方向 ——
    // rec5 那条 (.28,.42)→(.7,.6) 的斜线只经过中间，边缘敏感的效果全没触发。
    const path = [P(.12, .28), P(.88, .26), P(.9, .78), P(.16, .74), P(.5, .5)]
    await glide(P(.5, 1.35), path[0], 14)
    await page.waitForTimeout(200)
    for (let i = 1; i < path.length; i++) { await glide(path[i - 1], path[i], 13); await page.waitForTimeout(170) }
    if (sem.surface === 'cursor') {                // 光标类再折返一次，看得出是「跟随」不是「静态高亮」
      await glide(path.at(-1), P(.3, .3), 12)
      await page.waitForTimeout(180)
    }
    await page.waitForTimeout(Math.max(200, SEC_MS.hover - (sem.surface === 'cursor' ? 1200 : 600)))
  } else if (sec === 'click') {
    await badge('点击')
    // **点满整段，不留空档。** 包裹型组件（ClickSpark 这类，19 个）自己没有静态视觉，
    // 效果只在点击那一瞬闪一下 —— 只点一次的话，这一节绝大部分时间画面是空的。
    // 四个落点分散开，每次都是「移过去 → 涟漪 → 按下 → 短停」，一段接一段。
    // 六个落点、间隔压到 260ms —— 四次点击之间还是能看出空档（实测抽帧，
    // 有两帧只剩一个孤零零的指针）。火花本身存活约 0.6s，点得比它衰减更快才连得上。
    // **优先点舞台里真实的按钮/可点元素。** 固定比例的落点对包裹型特效（ClickSpark
    // 这类点哪都出火花）够用，但对「点右上角 Menu 才展开」的组件完全无效 ——
    // StaggeredMenu 新旧两版都是空画面，就是因为从没点中过那个按钮。
    const hot = await page.evaluate((sb) => {
      const stage = document.querySelector('.pg-stage-inner') || document.querySelector('.pg-stage')
      if (!stage) return []
      const inside = (r) => r.x + r.width > sb.x && r.x < sb.x + sb.width && r.y + r.height > sb.y && r.y < sb.y + sb.height
      return [...stage.querySelectorAll('*')].filter((e) => {
        const r = e.getBoundingClientRect()
        if (r.width < 12 || r.height < 12 || r.width > sb.width * 0.9) return false
        if (!inside(r)) return false
        if (e.closest('.pg-demo-slab')) return false
        return getComputedStyle(e).cursor === 'pointer' || /^(BUTTON|A)$/.test(e.tagName) || e.getAttribute('role') === 'button'
      }).map((e) => {
        const r = e.getBoundingClientRect()
        // 完整落在舞台里的优先。只求交集的话会选到卡在边缘的控件 ——
        // Stepper 的「Complete」按钮有 27% 在舞台下边缘外，点它等于点在裁切线上。
        const full = r.x >= sb.x && r.y >= sb.y && r.x + r.width <= sb.x + sb.width && r.y + r.height <= sb.y + sb.height
        // **中心点未必真的命中这个元素。** getBoundingClientRect 给的是 3D 变换后的
        // **轴对齐包围盒**，而元素本身是倾斜的 —— DomeGallery 的图片贴在球面上，
        // 包围盒中心落在元素外，elementFromPoint 命中的是舞台背景，
        // 于是四个落点全点空（实测覆盖率 0%，最佳位置能产生 55 的变化）。
        // 命中不了就在元素范围内找一个真命中的点。
        const ok = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)) }
        let c = [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]
        if (!ok(c[0], c[1])) {
          let found = null
          for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
            for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
              const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy)
              if (x < sb.x || y < sb.y || x > sb.x + sb.width || y > sb.y + sb.height) continue
              if (ok(x, y)) { found = [x, y]; break }
            }
            if (found) break
          }
          if (!found) return null          // 整个元素都点不到，丢掉
          c = found
        }
        return { c, full }
      }).filter(Boolean)
      // **按坐标去重。** 原来直接 slice(0,4) 取 DOM 顺序的前四个，而可点控件通常是
      // 三四层嵌套（外层容器、flex 包装、内部圆点各自都是 cursor:pointer），
      // 中心点完全重合 —— Stepper 实测四个落点里有三个是同一个圆点，
      // 真正能推进步骤的那个按钮排在第四，等于一整节只点了两个不同的地方。
      // 8px 网格量化：嵌套元素的中心会差一两个像素，精确比对去不掉重。
      .reduce((acc, it) => {
        const k = Math.round(it.c[0] / 8) + ',' + Math.round(it.c[1] / 8)
        if (!acc.seen.has(k)) { acc.seen.add(k); acc.out.push(it) }
        return acc
      }, { seen: new Set(), out: [] }).out
      .sort((a, b) => (b.full ? 1 : 0) - (a.full ? 1 : 0))
      .slice(0, 4).map((it) => it.c)
    }, { x: STAGE.x, y: STAGE.y, width: STAGE.width, height: STAGE.height })
    // **真实控件 + 散点混着来。** 只点控件的话，按钮按下后状态就定了，
    // 剩下大半段画面是静的（实测 CurvedInput/Dock 都因此比乱点还差）；
    // 只乱点又永远打不中「点右上角 Menu 才展开」这种。两者都要。
    const spread = [P(.32, .38), P(.64, .34), P(.7, .62), P(.42, .68), P(.5, .44), P(.6, .5)]
    const spots = hot.length ? [...hot, ...spread].slice(0, 6) : spread
    let cur = await curPos()
    for (const t of spots) {
      await glide(cur, t, 6)              // 位移快一点，时间留给效果本身
      await page.evaluate(() => window.__ripple())
      await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up()
      await page.waitForTimeout(260)
      cur = t
    }
  } else if (sec === 'drag') {
    await badge('拖拽')
    // 拖是这些组件的核心动作：滑杆拖到头才弹、贴纸拖着才挪、球面拖着才转。
    // rec5 完全没有这一节，所以它们录出来全是静止的。
    let cur = await curPos()
    const grip = P(.5, .5)
    await glide(cur, grip, 12)
    await page.waitForTimeout(160)
    await page.evaluate(() => window.__hold(true))
    await page.mouse.down()
    await page.waitForTimeout(140)
    // 先横后纵再拉回：横向覆盖滑杆/轮播/球面，纵向覆盖挂坠/卡堆
    let prev = grip
    for (const t of [P(.92, .5), P(.62, .86), P(.08, .56), P(.5, .5)]) {
      await glide(prev, t, 14)                    // 步子密一点，物理引擎跟得上
      await page.waitForTimeout(90)
      prev = t
    }
    await page.evaluate(() => window.__hold(false))
    await page.mouse.up()
    await page.waitForTimeout(Math.max(300, SEC_MS.drag - 2400))   // 留时间给松手后的惯性/回弹
  } else if (sec === 'scroll') {
    // 滚动触发的多半是「进入视口才播」，而在选型台里它一直在视口内、开录时早播完了。
    // 先重放一次让效果真的演出来，再演滚动手势。
    await badge('出现')
    // **这 1.5s 是给「刚重放完、等它演出来」用的，没重放就不该等。**
    // REPLAY_FIRST 为真时重放已经在录制开始前做过了，这里再干等就是纯静止 ——
    // ScrollStack 实测开头 0.6s 不动切五轮都切不掉，根子就在这句。
    if (!REPLAY_FIRST) { await replay(); await page.waitForTimeout(1500) }
    else await page.waitForTimeout(260)
    await badge('滚动')
    await glide(await curPos(), P(.5, .5), 10)
    await page.evaluate(() => window.__wheel(true))
    for (let i = 0; i < 7; i++) { await page.mouse.wheel(0, 130); await page.waitForTimeout(120) }
    await page.waitForTimeout(400)
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -130); await page.waitForTimeout(110) }
    await page.evaluate(() => window.__wheel(false))
    await page.waitForTimeout(300)
  } else {
    await page.waitForTimeout(SEC_MS.ambient)
  }
}
await badge('')
await page.waitForTimeout(250)

const finalName = (await page.locator('.pg-stage-name').first().textContent() ?? '').trim()
if (finalName !== NAME) { console.error(`✗ 组件变了：期望 ${NAME} 实际 ${finalName}`); process.exitCode = 1 }
await cdp.send('Page.stopScreencast').catch(() => {})
await page.evaluate(() => { if (window.__pacerId) cancelAnimationFrame(window.__pacerId); document.getElementById('__pacer')?.remove() }).catch(() => {})
await page.waitForTimeout(200)
await ctx.close(); await browser.close()

if (frames.length < 8) { console.error(`✗ 只抓到 ${frames.length} 帧，太少`); process.exit(1) }
// 帧自带时间戳（秒）。按相邻间隔写 concat 清单，时间轴就是真实时间轴。
const FR = OUTDIR + '/frames'; fs.mkdirSync(FR, { recursive: true })
const lines = []
for (let i = 0; i < frames.length; i++) {
  const p = `${FR}/${String(i).padStart(4, '0')}.jpg`
  fs.writeFileSync(p, Buffer.from(frames[i].data, 'base64'))
  // **间隔上限压到 0.12s**：重型 WebGL 渲染慢、帧稀疏，按 0.5s 封顶会把稀疏的帧
    // 拉成十几秒的长片，播放还一顿一顿（Ballpit 实测 16.6s / 1.8MB）。
    // 压到 0.12s 相当于「死时间压缩」，观感反而连贯。
    const dur = i < frames.length - 1 ? Math.min(0.12, Math.max(0.02, frames[i + 1].t - frames[i].t)) : 0.08
  lines.push(`file '${p}'`, `duration ${dur.toFixed(3)}`)
}
lines.push(`file '${FR}/${String(frames.length - 1).padStart(4, '0')}.jpg'`)
const listFile = OUTDIR + '/list.txt'
fs.writeFileSync(listFile, lines.join('\n'))

const out = `${OUTDIR}/${NAME}.webm`

// ── 画面太扁就补高度（2026-08-26）─────────────────────────────────────
// 取景是「裁到目标 + 按目标尺寸的比例留白」，目标本身很扁时留白也跟着很扁：
// ScrollStack 的目标是 738×85，留白只有 20px，裁出 900×126 —— 宽高比 7:1。
// 词典浮层只有 320 宽，这片子在那儿显示成 320×45，滚动堆叠的层次根本看不出来。
//
// 上限取 3.5:1：比它更扁的在浮层里就只剩一条缝了。补高度**以目标为中心对称展开**，
// 并夹在舞台内 —— 贴边的目标（Dock 在底部）会自动往有空间的一侧让。
// 纯文字类（GradientText 一行字）也会被补高，那是可接受的：文字居中、留白对称，
// 比压成一条缝好读。
// **只给需要垂直空间的小节补高。** 补高会让内容在成片里占比变小 ——
// 一行文字的组件（GradientText / ShinyText / BlurText）补完动量掉一半，
// 在 320 宽的浮层里字反而更小，是纯粹变差。
// 而 scroll / drag 这类，动作本身就在纵向展开（ScrollStack 的堆叠、拖拽的行程），
// 压成一条缝就什么都看不出来 —— 那才是补高要救的。
const NEEDS_TALL = SECTIONS.includes('scroll') || SECTIONS.includes('drag')
const MAX_AR = 3.5
if (NEEDS_TALL && box.width / box.height > MAX_AR) {
  const want = box.width / MAX_AR
  const mid = box.y + box.height / 2
  let y0 = mid - want / 2, y1 = mid + want / 2
  if (y0 < STAGE.y) { y1 += STAGE.y - y0; y0 = STAGE.y }
  if (y1 > STAGE.y + STAGE.height) { y0 -= y1 - (STAGE.y + STAGE.height); y1 = STAGE.y + STAGE.height }
  y0 = Math.max(STAGE.y, y0); y1 = Math.min(STAGE.y + STAGE.height, y1)
  if (y1 - y0 > box.height + 2) {
    console.error(`  · 画面太扁（${(box.width/box.height).toFixed(1)}:1）→ 高度 ${Math.round(box.height)} 补到 ${Math.round(y1 - y0)}`)
    box = { ...box, y: y0, height: y1 - y0 }
  }
}

// 最后再夹一次：crop 的四个数必须落在画面里且为正，否则 ffmpeg 直接 -22
const cx = Math.max(0, Math.min(VW - 2, Math.round(box.x)))
const cy = Math.max(0, Math.min(VH - 2, Math.round(box.y)))
const cw = Math.max(2, Math.min(VW - cx, Math.round(box.width)))
const ch = Math.max(2, Math.min(VH - cy, Math.round(box.height)))
const CROP = `crop=${cw}:${ch}:${cx}:${cy}`
// **不要吞 ffmpeg 的错误。** stdio:'ignore' 那一版，Carousel 挂了只看到
// 「status: 234」，什么线索都没有 —— 静默失败最耗时间。
let SS = 0                                     // 开头要切掉多少秒（先编一遍量出来再定）
const enc = (crf, w) => execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
  // **-ss 放在 -i 之后**：放前面是关键帧粗定位，会切偏
  ...(SS > 0 ? ['-ss', SS.toFixed(2)] : []),
  '-t', '9',                                   // 总时长硬封顶：缩略图没人看超过 9 秒
  // **竖的内容按高度缩，不按宽度。** scale=660:-2 对竖内容意味着高度失控 ——
  // LineSidebar 的侧边栏裁出来是 311×671，按宽度缩成 660×1424，
  // 在词典 320 宽的浮层里高达 690px，得滚动才看得完。
  // 按高度缩到 420（和主进程那边 contentSize 的高度上限一致），宽度自适应。
  '-vf', `${CROP},scale=${ch > cw * 1.2 ? `-2:${Math.min(420, Math.round(w * ch / cw))}` : `${w}:-2`}:flags=lanczos,fps=25`,
  // **必须是 AV1，不能用 VP9。**
  // 这台机器（Electron/Chromium）的 VP9 硬件解码路径是坏的：高度 ≥ 约 360 的片子
  // 一律 MEDIA_ERR_DECODE，低于阈值的反而正常 —— 因为 Chromium 对小视频走软解、
  // 大视频才走硬解。实测 145 个里 41 个中招，症状就是用户说的
  // 「有时候 hover 能看到动画，有时候就没了」。
  // 已验证：--disable-accelerated-video-decode 后 VP9 全部正常，但那是全局开关，
  // 会让画布里网页节点播视频也走软解，代价太大。AV1 走 dav1d 软解、不碰硬解路径，
  // 而且同画质下更小（全量实测 15.3MB → 12.0MB）。
  '-an', '-c:v', 'libsvtav1', '-crf', String(crf), '-preset', '6', '-g', '50', out], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' })
/** 量「开头有多久是死的」。**这一步必须有** ——
 *  固定顺序是 mount→hover→click→drag→scroll，而对某个组件来说前面几节可能完全没内容
 *  （StackTransition 全长 8.96s 里前 7.6s 一动不动，效果只在最后 1.4s）。
 *  用户 hover 上去看半天没动静，报的是「动画都不动」，其实是开头太长。
 *  模拟指针一直在走，所以不能按「画面完全相同」判，得按差分相对峰值的比例。 */
const leadIn = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-f', 'lavfi',
    `movie=${file},tblend=all_mode=difference,signalstats`,
    '-show_entries', 'frame_tags=lavfi.signalstats.YAVG', '-of', 'csv=p=0'], { encoding: 'utf8' })
  const v = (r.stdout || '').split('\n').map(Number).filter((x) => !isNaN(x) && x !== 0)
  if (v.length < 10) return 0
  const th = Math.max(0.05, Math.max(...v) * 0.12)
  const i = v.findIndex((x) => x > th)
  return i < 0 ? 0 : i / 25
}

try { enc(40, 660) } catch (e) {
  console.error('  ✗ ffmpeg 失败：' + String(e.stderr || e.message).split('\n').filter((l) => /error|Invalid|crop/i.test(l)).slice(-3).join(' | '))
  console.error(`  CROP=${CROP}  帧数=${frames.length}`)
  process.exit(1)
}
// **超预算就降**：少数 WebGL 粒子/噪声类熵极高，一个能顶几十个普通的
// （实测前 20 大吃掉总体积 67%）。分两档降，不是一刀切压所有人的画质。
// 开头死超过 0.8s 就重切。**从帧列表重编，不是拿成片再压一遍** —— 二次压缩会掉画质。
//
// **要迭代，不能只切一次。** 帧列表的时间轴不等于真实时间：稀疏帧被 0.12s 的
// 间隔上限拉长了，按第一次量出的秒数去 -ss，实际切掉的内容比预期少
// （StackTransition 量出 0.8s、切完还剩 6.9s 是死的）。切完再量，不够再切。
// **开头静止上限 0.5s**（2026-08-26 用户定的）。原来是 0.8s，实测仍有片子
// hover 上去要等半秒多才动，那半秒里用户已经在怀疑「是不是坏的」。
// 保留 0.2s 而不是切到 0：完全不留会让效果在第一帧就开演，看着像跳帧。
// 迭代次数从 3 提到 5 —— 阈值收紧后一次切不干净的情况变多
// （帧列表的时间轴不等于真实时间，见上面那段注释）。
for (let pass = 0; pass < 5; pass++) {
  const lead = leadIn(out)
  if (lead <= 0.5) break
  SS += lead - 0.2
  console.log(`  开头 ${lead.toFixed(1)}s 没内容 → 累计切掉 ${SS.toFixed(1)}s`)
  enc(40, 660)
}
{
  const lead = leadIn(out)
  if (lead > 0.5) console.error(`  ⚠ 切了 5 轮，开头仍有 ${lead.toFixed(1)}s 没内容 —— 多半是这个组件真的起步慢`)
}
let kb = fs.statSync(out).size / 1024
if (kb > 250) { enc(46, 660); kb = fs.statSync(out).size / 1024 }
if (kb > 400) { enc(52, 520); kb = fs.statSync(out).size / 1024 }
fs.rmSync(FR, { recursive: true, force: true })
const span = (frames[frames.length - 1].t - frames[0].t).toFixed(1)
const tg = TARGET ? `${TARGET.why} ${Math.round(TARGET.width)}×${Math.round(TARGET.height)}` : '整个舞台'
console.log(`${NAME}  [${SECTIONS.join('→')}]  瞄准:${tg}  ${CROP}  ${span}s  ${frames.length}帧  ${(fs.statSync(out).size/1024).toFixed(0)}KB`)
