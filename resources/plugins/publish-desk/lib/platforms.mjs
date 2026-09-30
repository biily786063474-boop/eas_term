// 发布台的平台表（2026-09-29 调研，完整来源见 docs/knowledge/publish-desk-platform-research-2026-09-29.md）。
// 每条规则带 source 与 verified：verified=true 是官方帮助页 / 官方文档有原文；false 是第三方或未核实，
// 面板显示为「参考值，以上传页提示为准」—— 国内五个平台的规格基本没有公开官方说明，网上数字互相矛盾，**别写死当事实**。
// 发布页地址只能来自这张表（面板「打开发布页」不接受 AI 给的网址）。
// p1=true 的三个平台是用户拍板的第一阶段完整验收对象（海外一个、国内图文一个、国内长视频一个）。

const R = (value, source, verified) => ({ value, source, verified })

export const PLATFORMS = [
  { id: 'x', name: 'X', group: 'overseas', p1: true, url: 'https://x.com/compose/post', count: 'x-weighted', tagJoin: 'space-hash',
    rules: { bodyMax: R(280, 'https://help.x.com/en/using-x/types-of-posts', true) },
    notes: ['免费账号 280（中日韩文字按 2 计、网址按 23 计）；Premium 可长帖', '视频非 Premium ≤140 秒、≤512MB'] },
  { id: 'reddit', name: 'Reddit', group: 'overseas', url: 'https://www.reddit.com/submit', tagJoin: 'none',
    rules: { titleMax: R(300, 'https://coegipartners.com/wp-content/uploads/2023/12/Reddit-Creative-Specifications.pdf', false), bodyMax: R(40000, 'https://coegipartners.com/wp-content/uploads/2023/12/Reddit-Creative-Specifications.pdf', false) },
    notes: ['要选版块，先读版块自我推广规则', '写明「I\'m the developer」'] },
  { id: 'bluesky', name: 'Bluesky', group: 'overseas', url: 'https://bsky.app', tagJoin: 'space-hash',
    rules: { bodyMax: R(300, 'https://ferryman.io/character-limits/bluesky', false) }, notes: ['视频 ≤10 分钟、≤300MB（2026-08）'] },
  { id: 'threads', name: 'Threads', group: 'overseas', url: 'https://www.threads.com', tagJoin: 'space-hash',
    rules: { bodyMax: R(500, 'https://developers.facebook.com/docs/threads/overview', true) }, notes: ['视频 ≤5 分钟、≤1GB，3:4 与 9:16 都可'] },
  { id: 'linkedin', name: 'LinkedIn', group: 'overseas', url: 'https://www.linkedin.com/feed/', tagJoin: 'space-hash',
    rules: { bodyMax: R(3000, 'https://www.linkedin.com/help/linkedin/answer/a528176', true) }, notes: ['在首页点「Start a post」'] },
  { id: 'youtube', name: 'YouTube', group: 'overseas', url: 'https://studio.youtube.com', tagJoin: 'space-hash',
    rules: { titleMax: R(100, 'https://support.google.com/youtube/answer/57407', true), bodyMax: R(5000, 'https://support.google.com/youtube/answer/57407', true), tagsMax: R(60, 'https://support.google.com/youtube/answer/6390658', true) },
    notes: ['话题标签超过 60 个会全部被忽略', '自定义封面需先验证账号'] },
  { id: 'youtube-shorts', name: 'YouTube Shorts', group: 'overseas', url: 'https://studio.youtube.com', tagJoin: 'space-hash',
    rules: { titleMax: R(100, 'https://support.google.com/youtube/answer/57407', true) }, notes: ['≤3 分钟的方形或竖屏（含 3:4）自动归为 Shorts'] },
  { id: 'indiehackers', name: 'Indie Hackers', group: 'overseas', url: 'https://www.indiehackers.com/new-post', tagJoin: 'none', rules: {}, notes: ['没有官方规格'] },
  { id: 'producthunt', name: 'Product Hunt', group: 'overseas', url: 'https://www.producthunt.com', tagJoin: 'comma',
    rules: { titleMax: R(60, 'https://www.producthunt.com/launch/preparing-for-launch', true), tagsMax: R(3, 'https://www.producthunt.com/launch/preparing-for-launch', true) },
    notes: ['右上角 Submit → New product', '标语 60 字符；描述官方两处写法冲突（500 / 260）', '禁止拉票'] },
  { id: 'xiaohongshu', name: '小红书', group: 'cn', p1: true, url: 'https://creator.xiaohongshu.com/publish/publish', tagJoin: 'space-hash',
    rules: { titleMax: R(20, 'https://xueyuan.yixiaoer.cn/article/30636', false), bodyMax: R(1000, 'https://xueyuan.yixiaoer.cn/article/30636', false) },
    notes: ['正文放网址、二维码属于社区规范 3.2.2 不鼓励的导流', '图片张数、视频上限说法不一，以上传页为准'] },
  { id: 'douyin', name: '抖音', group: 'cn', url: 'https://creator.douyin.com', tagJoin: 'space-hash', rules: {}, notes: ['视频上限说法差很多，以上传页为准'] },
  { id: 'channels', name: '视频号', group: 'cn', url: 'https://channels.weixin.qq.com', tagJoin: 'space-hash', rules: {},
    notes: ['只能微信扫码登录，可能要经常重扫', '比例 0.33–3（含 3:4）、≤2GB'] },
  { id: 'zhihu', name: '知乎', group: 'cn', url: 'https://zhuanlan.zhihu.com/write', tagJoin: 'none',
    rules: { titleMax: R(30, 'https://zhuanlan.zhihu.com/p/420973568', false) }, notes: ['这是文章入口；想法 / 视频在首页创作入口', '标题 30 为视频标题参考值'] },
  { id: 'bilibili', name: '哔哩哔哩', group: 'cn', p1: true, url: 'https://member.bilibili.com/platform/upload/video/frame', tagJoin: 'comma',
    rules: { titleMax: R(80, 'https://www.te5.cn/hotnews/20220221216909.html', false), tagsMax: R(10, 'https://www.te5.cn/hotnews/20220221216909.html', false) },
    notes: ['网页端单文件 8G（满足条件 16G）', '官方建议标签 3–5 个'] }
]

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
