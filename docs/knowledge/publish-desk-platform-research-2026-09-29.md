# 发布台插件 · 平台发布入口、格式限制与违禁词来源调研（2026-09-29）

> 配套设计：`docs/superpowers/specs/2026-09-29-publish-desk-design.md`。调研由子代理完成，全程未注册、未发布。
> **国内五个平台的格式规格大多没有公开的官方帮助页**，网上数字互相矛盾——插件里标「参考 / 以上传页提示为准」，不写死当事实。

## 海外平台

| 平台 | 网页发布入口 | 能发 | 规则（有来源的） |
|---|---|---|---|
| X | x.com/compose/post | 视频 / 图 / 文 | 免费 280 字符，Premium 长帖 ≤25000 [1]；视频非 Premium ≤140 秒 ≤512MB，Premium ≤4 小时 ≤16GB [2]（官方页 403，数字取自摘要）；每条 ≤4 图，3:4 是否支持未核实 [3] |
| Reddit | reddit.com/submit | 视频 / 图 / 文 | 标题 300、正文 40000 [4 第三方]；画廊 ≤20 图 [5]；视频 ≤15 分钟 ≤1GB [6 未核实]；版块可关视频 / 画廊 |
| Bluesky | bsky.app | 视频 / 图 / 文 | 300 字（grapheme）[7 第三方]；视频 2026-08 起 ≤10 分钟 ≤300MB [8]；图 4→10 张、图视频不能混 [9 未核实] |
| Threads | threads.com | 视频 / 图 / 文 | 500 字符；轮播 2–20；视频 ≤5 分钟 ≤1GB，比例 0.01:1–10:1；图 ≤8MB [10]（API 规格）；文字附件 ≤10000 [11] |
| LinkedIn | linkedin.com/feed → Start a post | 视频 / 图 / 文 | 3000 字符 [12]；视频 3 秒–15 分钟、75KB–5GB、比例 1:2.4–2.4:1 [13]；≤20 图 [3 未核实] |
| YouTube | studio.youtube.com → 创建 → 上传 | 视频 | 标题 100 / 描述 5000 [14]；标签 >60 全忽略、标题旁最多显示 3 个 [15]；默认 ≤15 分钟，验证后 ≤256GB 或 12 小时 [16]；自定义封面需验证、JPG/PNG、≤50MB [17] |
| YouTube Shorts | 同上 | 视频 | ≤3 分钟、方形或竖屏（1:1–9:16 含 3:4）自动归 Shorts；>1 分钟且有 Content ID 声明会被全球屏蔽 [18] |
| Product Hunt | 右上角 Submit → New product | 产品页 | 标语 60；标签 ≤3；缩略图 240×240 ≤3MB 可 GIF；画廊 ≥2 张建议 1270×760；视频只能公开 YouTube 链接 [19]；描述官方两处冲突（500 [19] / 260 [20]）；公司账号不能发，新号要先完成引导 [20] |
| Indie Hackers | indiehackers.com/new-post | 图 / 文 | 无官方规格；邮箱 / Google / X 登录 [21 未核实] |

垃圾信息 / 自我推广规则：X [Authenticity](https://help.x.com/en/rules-and-policies/authenticity)、[Automation](https://help.x.com/en/rules-and-policies/x-automation)；Reddit [Spam](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam)（版块规则优先）；Bluesky [Community Guidelines](https://bsky.social/about/support/community-guidelines)；Threads 沿用 Instagram 守则（未核实）；LinkedIn [Professional Community Policies](https://www.linkedin.com/legal/professional-community-policies)；YouTube [垃圾内容政策](https://support.google.com/youtube/answer/2801973)；Product Hunt [Community Guidelines](https://help.producthunt.com/en/articles/3615694-community-guidelines)、[禁止拉票](https://help.producthunt.com/en/articles/484935-can-i-ask-my-community-friends-family-to-upvote-a-product)；Indie Hackers 未找到成文规则。

## 国内平台（规格全部未核实，以上传页为准）

| 平台 | 网页发布入口 | 能发 | 登录 | 规格（参考） |
|---|---|---|---|---|
| 小红书 | creator.xiaohongshu.com/publish/publish | 视频 / 图文 / 长文 | 验证码或 App 扫码 | 标题 20、正文 1000 [22]；图片 9 或 18 张说法不一；视频 15 分钟 10GB [23] 或 60 分钟 20GB |
| 抖音 | creator.douyin.com | 视频 / 图文 / 文章 | 扫码或验证码 | 视频上限说法差很多 [24]；长图文 ≤8000 字、30 图 [25] |
| 视频号 | channels.weixin.qq.com | 视频 / 图文 | **只能微信扫码**，有用户反映要天天重扫 [26] | 比例 0.33–3（含 3:4）、≤2GB、电脑端 3 秒–8 小时、图 ≤20 [27]（页面需 JS，取自摘要） |
| 知乎 | zhuanlan.zhihu.com/write；想法 / 视频在首页创作入口 | 文章 / 想法 / 视频 | 扫码 / 验证码 / 密码 | 视频 ≤1 小时 ≤2G、标题 30、简介 300 [28 第三方] |
| 哔哩哔哩 | member.bilibili.com/platform/upload | 视频 / 专栏 / 动态 | 扫码 / 密码 / 短信 | 网页端 8G，满足条件 16G [29]；标题 80、标签 10 未核实，官方建议 3–5 个标签 [30] |

## 违禁词来源

1. **法律**：《广告法》第九条第（三）项禁止「国家级、最高级、最佳」等用语 [31]，违反依第五十七条罚 20–100 万 [31][32]。
   官方解释：市场监管总局 2023 年第 6 号公告《广告绝对化用语执法指南》[33]——第五、六条列不算违法的情形（经营理念、同品牌自比、时空顺序、如实销量 / 占有率等），第九、十条可首违不罚或从轻，第十一条医疗 / 投资 / 教育培训从严；答记者问批评「一刀切、简单化」[34]。
2. **平台规范**（只有原则条款，没有公开词表）：[小红书社区规范](https://agree.xiaohongshu.com/h5/terms/ZXXY20221213003/-1) · [抖音规则中心](https://www.douyin.com/rule/policy) · [视频号运营规范](https://weixin.qq.com/cgi-bin/readtemplate?lang=zh_CN&t=weixin_agreement&s=video) · [视频号营销信息规范](https://weixin.qq.com/cgi-bin/readtemplate?t=finder_live_marketing_guide&wechat_real_lang=zh_CN) · [知乎社区规范](https://www.zhihu.com/term/community) · [B 站社区规则](https://www.bilibili.com/blackboard/blackroom.html)
3. **网传「违禁词大全」不是官方的**：2015 年上海工商就澄清过网传清单属误读 [35]；总局指南要求结合语境、没有词表 [33][34]。照搬有汇编作品著作权风险（未核实），且会把「有据可查的第一」误报。→ 自建词表，每条挂依据，命中写「提示」不写「禁止」。

## 来源
[1] https://help.x.com/en/using-x/types-of-posts
[2] https://help.x.com/en/using-x/x-videos
[3] https://postfa.st/sizes/x/video
[4] https://coegipartners.com/wp-content/uploads/2023/12/Reddit-Creative-Specifications.pdf
[5] https://www.engadget.com/reddit-adds-support-image-galleries-170009074.html
[6] https://moviemaker.minitool.com/news/reddit-video-length-limit.html
[7] https://ferryman.io/character-limits/bluesky
[8] https://techcrunch.com/2026/08/26/bluesky-now-lets-you-upload-10-minute-long-videos/
[9] https://gigazine.net/gsc_news/en/20260423-bluesky-4000-resolution-limit/
[10] https://developers.facebook.com/docs/threads/overview
[11] https://www.threads.com/@threads/post/DPgzLZcAJPr
[12] https://www.linkedin.com/help/linkedin/answer/a528176
[13] https://www.linkedin.com/help/linkedin/answer/a548372
[14] https://support.google.com/youtube/answer/57407
[15] https://support.google.com/youtube/answer/6390658
[16] https://support.google.com/youtube/answer/71673
[17] https://support.google.com/youtube/answer/72431
[18] https://support.google.com/youtube/answer/15424877
[19] https://www.producthunt.com/launch/preparing-for-launch
[20] https://help.producthunt.com/en/articles/479557-how-to-post-a-product
[21] https://wheretosubmit.org/guides/indiehackers-submission-guide
[22] https://xueyuan.yixiaoer.cn/article/30636
[23] https://shipinzan.com/xhs-sc.html
[24] https://xueyuan.yixiaoer.cn/article/29746
[25] https://www.chinanews.com.cn/cj/2025/12-26/10540962.shtml
[26] https://developers.weixin.qq.com/community/develop/doc/000eeed27c4890c804801e4df6b400
[27] https://findeross.weixin.qq.com/cgi-bin/mmfindernodelivecrmwebbroker-bin/helper-center/pages/Yhdpjlq2RIkcmnQu
[28] https://zhuanlan.zhihu.com/p/420973568
[29] https://www.zhihu.com/question/312574848
[30] https://www.te5.cn/hotnews/20220221216909.html
[31] http://www.npc.gov.cn/zgrdw/npc//xinwen/2018-11/05/content_2065663.htm
[32] https://www.gdzwfw.gov.cn/portal/simple-guide/11445122MB2D24374A4440225982010
[33] https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2023/art_64279265c896452f8f638f2de12b8003.html
[34] https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/xwxcs/art/2023/art_c1ecaa66e3fa48beaed113e1627cd463.html
[35] https://www.allbrightlaw.com/SH/CN/10475/7220a1be30e0db41.aspx
