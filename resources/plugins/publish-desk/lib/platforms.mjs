// 发布台的平台表（2026-09-29 调研，完整来源见 docs/knowledge/publish-desk-platform-research-2026-09-29.md）。
// 每条规则带 source 与 verified：verified=true 是官方帮助页 / 官方文档有原文；false 是第三方或未核实，
// 面板显示为「参考值，以上传页提示为准」—— 国内五个平台的规格基本没有公开官方说明，网上数字互相矛盾，**别写死当事实**。
// 发布页地址只能来自这张表（面板「打开发布页」不接受 AI 给的网址）。
// p1=true 的三个平台是用户拍板的第一阶段完整验收对象（海外一个、国内图文一个、国内长视频一个）。

// note：这条不是上传上限，而是超出后会发生什么（如 YouTube Shorts 超过 3 分钟就作为普通视频发布）
const R = (value, source, verified, note) => ({ value, source, verified, ...(note ? { note } : {}) })
const range = (min, max, label) => ({ min, max, label })

export const PLATFORMS = [
  { id: 'x', name: 'X', group: 'overseas', p1: true, url: 'https://x.com/compose/post', count: 'x-weighted', tagJoin: 'space-hash',
    rules: { bodyMax: R(280, 'https://help.x.com/en/using-x/types-of-posts', true) },
    notes: ['免费账号 280（中日韩文字按 2 计、网址按 23 计）；Premium 可长帖'] },
  { id: 'reddit', name: 'Reddit', group: 'overseas', url: 'https://www.reddit.com/submit', tagJoin: 'none',
    rules: { titleMax: R(300, 'https://coegipartners.com/wp-content/uploads/2023/12/Reddit-Creative-Specifications.pdf', false), bodyMax: R(40000, 'https://coegipartners.com/wp-content/uploads/2023/12/Reddit-Creative-Specifications.pdf', false) },
    notes: ['要选版块，先读版块自我推广规则', '写明「I\'m the developer」'] },
  { id: 'bluesky', name: 'Bluesky', group: 'overseas', url: 'https://bsky.app', tagJoin: 'space-hash',
    rules: { bodyMax: R(300, 'https://ferryman.io/character-limits/bluesky', false) }, notes: [] },
  { id: 'threads', name: 'Threads', group: 'overseas', url: 'https://www.threads.com', tagJoin: 'space-hash',
    rules: { bodyMax: R(500, 'https://developers.facebook.com/docs/threads/overview', true) }, notes: [] },
  { id: 'linkedin', name: 'LinkedIn', group: 'overseas', url: 'https://www.linkedin.com/feed/', tagJoin: 'space-hash',
    rules: { bodyMax: R(3000, 'https://www.linkedin.com/help/linkedin/answer/a528176', true) }, notes: ['在首页点「Start a post」'] },
  { id: 'youtube', name: 'YouTube', group: 'overseas', url: 'https://studio.youtube.com', tagJoin: 'space-hash',
    rules: { titleMax: R(100, 'https://support.google.com/youtube/answer/57407', true), bodyMax: R(5000, 'https://support.google.com/youtube/answer/57407', true), tagsMax: R(60, 'https://support.google.com/youtube/answer/6390658', true) },
    notes: ['话题标签超过 60 个会全部被忽略', '自定义封面需先验证账号'] },
  { id: 'youtube-shorts', name: 'YouTube Shorts', group: 'overseas', url: 'https://studio.youtube.com', tagJoin: 'space-hash',
    rules: { titleMax: R(100, 'https://support.google.com/youtube/answer/57407', true) }, notes: [] },
  { id: 'indiehackers', name: 'Indie Hackers', group: 'overseas', url: 'https://www.indiehackers.com/new-post', tagJoin: 'none', rules: {}, notes: ['没有官方规格'] },
  { id: 'producthunt', name: 'Product Hunt', group: 'overseas', url: 'https://www.producthunt.com', tagJoin: 'comma',
    rules: { titleMax: R(60, 'https://www.producthunt.com/launch/preparing-for-launch', true), tagsMax: R(3, 'https://www.producthunt.com/launch/preparing-for-launch', true) },
    notes: ['右上角 Submit → New product', '标语 60 字符；描述官方两处写法冲突（500 / 260）', '禁止拉票'] },
  { id: 'xiaohongshu', name: '小红书', group: 'cn', p1: true, url: 'https://creator.xiaohongshu.com/publish/publish', tagJoin: 'space-hash',
    rules: { titleMax: R(20, 'https://xueyuan.yixiaoer.cn/article/30636', false), bodyMax: R(1000, 'https://xueyuan.yixiaoer.cn/article/30636', false) },
    notes: ['正文放网址、二维码属于社区规范 3.2.2 不鼓励的导流', '图片张数、视频上限说法不一，以上传页为准'] },
  { id: 'douyin', name: '抖音', group: 'cn', url: 'https://creator.douyin.com', tagJoin: 'space-hash', rules: {}, notes: ['视频上限说法差很多，以上传页为准'] },
  { id: 'channels', name: '视频号', group: 'cn', url: 'https://channels.weixin.qq.com', tagJoin: 'space-hash', rules: {},
    notes: ['只能微信扫码登录，可能要经常重扫'] },
  { id: 'zhihu', name: '知乎', group: 'cn', url: 'https://zhuanlan.zhihu.com/write', tagJoin: 'none',
    rules: { titleMax: R(30, 'https://zhuanlan.zhihu.com/p/420973568', false) }, notes: ['这是文章入口；想法 / 视频在首页创作入口', '标题 30 为视频标题参考值'] },
  { id: 'bilibili', name: '哔哩哔哩', group: 'cn', p1: true, url: 'https://member.bilibili.com/platform/upload/video/frame', tagJoin: 'comma',
    rules: { titleMax: R(80, 'https://www.te5.cn/hotnews/20220221216909.html', false), tagsMax: R(10, 'https://www.te5.cn/hotnews/20220221216909.html', false) },
    notes: ['官方建议标签 3–5 个'] }
]

// 素材规格（2026-09-30 核实，原文与取法见 docs/knowledge/publish-desk-media-specs-2026-09-30.md）。
// verified=true：官方帮助页 / 官方仓库 / 官方页面存档里有原文；false：只有第三方或搜索摘要。
// 「3:4 会不会被裁切」没有任何官方页面回答过，这里只判比例在不在允许范围内。
// video: null = 不能直接上传视频文件；缺字段 = 没找到依据，不检查。
const XV = 'https://help.x.com/en/using-x/x-videos'
const YT = 'https://support.google.com/youtube/answer/71673', YTT = 'https://support.google.com/youtube/answer/72431', YTS = 'https://support.google.com/youtube/answer/15424877'
const BSV = 'https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/app/bsky/embed/video.json', BSI = 'https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/app/bsky/embed/images.json'
const TH = 'https://developers.facebook.com/docs/threads/overview', LI = 'https://www.linkedin.com/help/linkedin/answer/a548372'
const PH = 'https://help.producthunt.com/en/articles/479557-how-to-post-a-product'
const CH = 'https://findeross.weixin.qq.com/cgi-bin/mmfindernodelivecrmwebbroker-bin/helper-center/pages/Yhdpjlq2RIkcmnQu'
const MEDIA = {
  x: { video: { maxSec: R(140, XV, true), maxBytes: R(512e6, XV, true), ratio: R(range(1 / 2.39, 2.39, '1:2.39–2.39:1'), XV, true) },
    notes: ['以上是免费账号；Premium 可到 4 小时、16GB', '单张图片在 2:1 到 3:4 之间会完整显示（不被裁成预览）'] },
  reddit: { video: { maxSec: R(900, 'https://support.reddithelp.com/hc/en-us/articles/42961314311700-Changelog-November-4-2025', true) }, notes: ['非 Premium 15 分钟、Premium 30 分钟；大小与比例没找到官方原文', '各版块可能关掉视频或图片'] },
  bluesky: { video: { maxSec: R(600, 'https://bsky.app/profile/bsky.app/post/3mtwf7gxkwc2r', true), maxBytes: R(300e6, BSV, true) },
    image: { maxCount: R(4, BSI, true), maxBytes: R(2e6, BSI, true) }, notes: ['视频只收 mp4'] },
  threads: { video: { maxSec: R(300, TH, true), maxBytes: R(1e9, TH, true), ratio: R(range(0.01, 10, '0.01:1–10:1'), TH, true) },
    image: { maxCount: R(20, TH, true), maxBytes: R(8e6, TH, true) }, notes: ['规格出自 Threads API 文档；App 里手动发的限制官方没写'] },
  linkedin: { video: { minSec: R(3, LI, true), maxSec: R(900, LI, true), maxBytes: R(5e9, LI, true), ratio: R(range(1 / 2.4, 2.4, '1:2.4–2.4:1'), LI, true) } },
  youtube: { video: { maxSec: R(900, YT, true, '默认账号上限 15 分钟，验证过的账号可以更长（最长 12 小时）') },
    cover: R({ label: '16:9，建议 3840×2160，宽至少 640' }, YTT, true), notes: ['方形或竖屏且 ≤3 分钟的会自动归为 Shorts'] },
  'youtube-shorts': { video: { maxSec: R(180, YTS, true, '超过 3 分钟不会归为 Shorts，会作为普通视频发布'), ratio: R(range(0, 1, '方形或竖屏'), YTS, true, '横屏不会归为 Shorts，会作为普通视频发布') },
    cover: R({ label: '9:16，2160×3840，高至少 640' }, YTT, true) },
  indiehackers: { notes: ['没有官方素材规格'] },
  producthunt: { video: null, videoNote: '只支持 YouTube 链接（完整网址、不能是私密或短链）', image: { maxBytes: R(3e6, 'https://www.producthunt.com/launch/preparing-for-launch', false) },
    cover: R({ label: '缩略图 240×240 方形（GIF 需 <3MB）；画廊图建议 1270×760，至少 2 张' }, PH, true) },
  xiaohongshu: { video: { maxSec: R(900, 'https://zhuanlan.zhihu.com/p/588804070', false), maxBytes: R(10e9, 'https://zhuanlan.zhihu.com/p/588804070', false) },
    image: { maxCount: R(18, 'https://zhuanlan.zhihu.com/p/588804070', false) }, notes: ['官方规格页打不开，以上是第三方说法；第三方普遍说主推 3:4 竖版'] },
  douyin: { video: { maxSec: R(900, 'https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/upload-video', false) },
    notes: ['只找到开放平台接口的限制（15 分钟），创作者中心手动发布的规格没找到原文'] },
  channels: { video: { minSec: R(3, CH, false), maxSec: R(8 * 3600, CH, false), maxBytes: R(2e9, CH, false), ratio: R(range(0.33, 3, '0.33–3（宽/高）'), CH, false) },
    image: { maxCount: R(18, CH, false), ratio: R(range(0.33, 3, '0.33–3（宽/高）'), CH, false) }, notes: ['官方帮助页正文取不到，以上来自搜索摘要；网页端图文 18 张、手机 20 张'] },
  zhihu: { notes: ['官方素材规格没找到原文'] },
  bilibili: { video: { maxBytes: R(8e9, 'https://www.bilibili.com/read/cv1761401/', true) },
    cover: R({ label: '1146×717（约 16:10）' }, 'https://www.bilibili.com/read/cv11221825/', false), notes: ['8GB 出自 B站网页端旧公告（未注明日期）；时长、比例没找到官方原文'] }
}
for (const p of PLATFORMS) p.media = MEDIA[p.id]

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id)
export const platformOf = (id) => PLATFORMS.find((p) => p.id === id)

/** X 的计数：中日韩等宽字符按 2、网址一律按 23（官方 weighted length 的简化版，够判断超没超） */
export function xLength(text) {
  const withoutUrls = text.replace(/https?:\/\/\S+/g, () => '\u0000'.repeat(23))
  let n = 0
  for (const ch of withoutUrls) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]/u.test(ch) ? 2 : 1
  return n
}
export function lengthOf(text, platform) {
  if (!text) return 0
  return platform?.count === 'x-weighted' ? xLength(text) : [...text].length
}
/** 标签拼成可直接粘贴的形式 */
export function joinTags(tags, platform) {
  const clean = tags.map((t) => t.replace(/^#+|#+$/g, '').trim()).filter(Boolean)
  if (platform?.tagJoin === 'comma') return clean.join(',')
  if (platform?.tagJoin === 'none') return clean.join(' ')
  return clean.map((t) => '#' + t).join(' ')
}
