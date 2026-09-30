# 发布台 P3：各平台素材规格核实（调研日期 2026-09-30）

## 取法说明（必读）
- 「原文」若标注 **已打开原页面**：我用 curl 直接抓到页面 HTML 并提取了文字（逐字），或用 WebFetch 抓取（WebFetch 经小模型转述，其引文我标为「WebFetch 转述」，产品内引用前建议再对一次）。
- **存档**：help.x.com 有 Cloudflare 挑战，curl / WebFetch 均 403，改用 web.archive.org 存档（快照日期在条目里）。
- 微信视频号帮助页、知乎、B站、小红书均是前端渲染或对抓取方封禁（403 / 空壳），**本次没能拿到官方原文**，只见搜索摘要或第三方，已逐项标明。
- 搜索摘要里出现的数字如果没有在我打开的页面里看到，一律标「仅见搜索摘要」，不当作已核实。

---

### X（Twitter）
- 视频最长（免费）：140 秒
  - 原文：「If you aren't a Premium subscriber, you can still upload videos up to 140 seconds long with a maximum file size of 512MB.」
  - 出处：How to share and watch videos on X — https://help.x.com/en/using-x/x-videos （存档快照 2026-09-24）
  - 核实状态：存档（原页面 403，取自 web.archive.org）
- 视频最长 / 最大（Premium）：4 小时、16GB（1080p）；2–4 小时须 720p
  - 原文：「Premium subscribers are able to upload videos shorter than 4 hours at 1080p with a maximum file size of 16GB. Premium subscribers are also able to upload videos above 2 hours and under 4 hours at 720p with a maximum file size of 16GB.」
  - 出处：同上（快照 2026-09-24）；另 About longer videos for X Premium subscribers — https://help.x.com/en/using-x/premium-longer-videos （快照 2026-05-13）
  - 原文（Android）：「Subscribers can upload videos up to 10 minutes long on Android.」「If you aren't a Premium subscriber, you can still upload videos up to 140 seconds long on any platform.」
  - 核实状态：存档
- 视频分辨率 / 比例（网页端）
  - 原文：「Minimum resolution: 32 x 32 / Maximum resolution: 1920 x 1200 (and 1200 x 1900) / Aspect ratios: 1:2.39 - 2.39:1 range (inclusive) / Maximum frame rate: 40 fps / Maximum bitrate: 25 Mbps」
  - 出处：https://help.x.com/en/using-x/x-videos （快照 2026-09-24）
  - **3:4（0.75）落在 1:2.39–2.39:1 内 → 支持**；官方页未说明时间线是否裁切。
  - 核实状态：存档
- 视频（API，开发者文档，与帮助中心数值不同）：
  - WebFetch 转述：默认账号 0.5 秒–20 分钟、8GB；Premium 0.5 秒–125 分钟、16GB；分辨率「1280x720 (landscape), 720x1280 (portrait), 720x720 (square)」，「Aspect ratio: must be between 1:3 and 3:1」，H264 High Profile，AAC LC，≤60fps。
  - 出处：Media Best Practices — https://docs.x.com/x-api/media/quickstart/best-practices
  - 核实状态：已打开原页面（WebFetch 转述）。注意：API 限制与网页端 140 秒不同，产品里按用户手动发布应以帮助中心为准。
- 图片：单帖最多 4 张、单张 ≤5MB
  - 原文（API 文档，WebFetch 转述）：「Supported image media types: JPG, PNG, GIF, WEBP」最大 5 MB；GIF 15 MB。
  - 「一帖 1–4 张」仅见搜索摘要，未在我打开的帮助页原文中看到数字（https://help.x.com/en/using-x/posting-gifs-and-pictures 存档中只有：「When you Post a single photo, images with standard aspect ratios (between 2:1 and 3:4) will display in full…」）。
  - 核实状态：5MB/格式=已打开（WebFetch 转述）；4 张=仅见搜索摘要；单图完整展示比例 2:1–3:4 = 存档原文
- 封面 / 缩略图：未找到原文
- 免费 vs 付费：见上（140 秒/512MB vs 4 小时/16GB）

### Reddit
- 视频最长：帖子视频免费 15 分钟，Premium 30 分钟
  - 原文：「Video upload length of 30 minutes (up from 15 for non-premium users)」
  - 出处：Changelog - November 4, 2025 – Reddit Help — https://support.reddithelp.com/hc/en-us/articles/42961314311700-Changelog-November-4-2025 （存档快照）
  - 核实状态：存档（原页面 403）
- 评论里的视频：
  - 原文：「Select or record a video from your device, with a max length of 3 minutes.」「File size must be less than 1 GB (recommended: < 300 MB).」
  - 出处：How do I add video in comments – Reddit Help — https://support.reddithelp.com/hc/en-us/articles/48109333836692-How-do-I-add-video-in-comments （存档）
  - 核实状态：存档。注意这是**评论**视频，非主帖。
- 帖子视频文件大小上限、比例、分辨率、格式：**未找到官方原文**。第三方（liftburst / minitool 等）称 1GB、MP4/MOV —— 第三方，不建议入产品。
- 图片单帖张数 / 大小：**未找到官方原文**（Help「How do I post and comment on Reddit」只说可发 Image / Video，且「Not all communities allow all options」）。
- 封面：未找到
- 免费 vs 付费：视频长度 15 vs 30 分钟（上面原文）

### Bluesky
- 视频最长：10 分钟
  - 原文：「Big video update! You can now post videos up to 10 minutes long, and they'll upload 2–3x faster. That's on top of the recent increase in maximum file size to 300MB.」
  - 出处：Bluesky 官方账号 @bsky.app 2026-08-25 的帖子 — https://bsky.app/profile/bsky.app/post/3mtwf7gxkwc2r （取自公共 API app.bsky.feed.getPosts 返回的 record.text）
  - 核实状态：已打开原始记录
- 视频最大：300MB，仅 mp4
  - 原文（lexicon JSON）：「The mp4 video file. May be up to 300mb, formerly limited to 100mb.」`"accept": ["video/mp4"]`, `"maxSize": 300000000`
  - 出处：atproto 仓库 lexicons/app/bsky/embed/video.json — https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/app/bsky/embed/video.json
  - 核实状态：已打开原文件（官方仓库）
- 视频比例 / 分辨率 / 3:4：**未找到官方原文**（lexicon 有 aspectRatio 字段但无限制；第三方称 720p）
- 图片：最多 4 张，单张 ≤2MB
  - 原文（lexicon）：`"maxLength": 4`；「The raw image file. May be up to 2 MB, formerly limited to 1 MB.」`"maxSize": 2000000`
  - 出处：https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/app/bsky/embed/images.json
  - 核实状态：已打开原文件。（搜索摘要曾称"10 张"，与官方 lexicon 冲突，以 lexicon 为准；如客户端已放宽，需另行核实。）
- 封面：未找到
- 免费 vs 付费：无差别；第三方称新账号需验证邮箱、每日 25 个视频/10GB（第三方，useagentsky.com，未核实）。

### Threads
- 视频最长 / 最大 / 比例 / 编码（API）
  - 原文（WebFetch 转述）：「300 seconds (5 minutes) maximum」「1 GB maximum」「between 0.01:1 and 10:1」（推荐 9:16）「HEVC or H264」「23-60 FPS」
  - 出处：Threads API Overview — https://developers.facebook.com/docs/threads/overview
  - **3:4 在 0.01:1–10:1 范围内 → 支持**。
  - 核实状态：已打开原页面（WebFetch 转述）。注意是 API 文档；App 内手动发布的限制官方帮助中心未找到。
- 图片（API）：JPEG / PNG，≤8MB，宽 320–1440，比例「10:1」；轮播「maximum of 20 children and a minimum of 2」
  - 出处：同上
  - 核实状态：已打开原页面（WebFetch 转述）
- App 内轮播 20 个：Threads 官方账号帖「A lil update: You can now post up to 20 photos or videos in a carousel on Threads」— https://www.threads.com/@threads/post/DAELxBhOoWc （仅见搜索摘要）
- 文字 500 字符（API 文档，WebFetch 转述）
- 封面：未找到
- 免费 vs 付费：无

### LinkedIn
- 视频：3 秒（移动端 2 秒）–15 分钟；75KB–5GB；比例 1:2.4–2.4:1；分辨率 256x144–4096x2304；10–60fps；192Kbps–30Mbps
  - 原文（WebFetch 转述）：「Maximum video duration: 15 minutes」「Minimum video duration: 3 seconds when uploading from desktop and 2 seconds when uploading from the LinkedIn mobile app.」「Maximum file size: 5 GB」「Aspect ratio: 1:2.4 - 2.4:1」「Resolution range: 256x144 to 4096x2304」格式 MP4、MOV、AVI、WEBM、MKV、WMV 等
  - 出处：LinkedIn Help — https://www.linkedin.com/help/linkedin/answer/a548372
  - **3:4 在范围内 → 支持**
  - 核实状态：已打开原页面（WebFetch 转述）
- 图片张数 / 大小、封面：本次未查到官方原文
- 免费 vs 付费：页面未提及差别

### YouTube（普通视频）
- 时长 / 大小：默认 15 分钟；验证账号可更长；最大 256GB 或 12 小时取小者
  - 原文：「By default, you can upload videos that are up to 15 minutes long. Verified accounts can upload videos longer than 15 minutes.」「The maximum file size you can upload is 256 GB or 12 hours, whichever is less.」
  - 出处：Upload videos longer than 15 minutes - YouTube Help — https://support.google.com/youtube/answer/71673
  - 核实状态：已打开原页面
- 缩略图
  - 原文（WebFetch 转述）：视频「3840 x 2160 pixels」，「minimum width of 640 pixels」，比例「16:9」，「JPG or PNG」；移动端「2 MB for video thumbnails」，桌面「50MB for video, Shorts, and podcast thumbnails」；播客列表 1:1
  - 出处：Add video thumbnails — https://support.google.com/youtube/answer/72431
  - 核实状态：已打开原页面（WebFetch 转述）
- 视频比例 / 3:4：普通视频页面未给出比例限制；见 Shorts 一节的分类规则。
- 图片（社区帖）：未查
- 免费 vs 付费：15 分钟 vs 验证账号（手机验证）——非付费差别

### YouTube Shorts
- 最长 3 分钟；方形或竖屏
  - 原文：「Any videos uploaded on or after this date with a square or vertical aspect ratio up to three minutes in length will be categorized as Shorts on YouTube.」「If you don't want your content to be classified as Shorts, use a wider aspect ratio such as 16:9 for long-form videos.」
  - 出处：Understand three-minute YouTube Shorts — https://support.google.com/youtube/answer/15424877
  - **3:4 竖版（宽<高）属"vertical" → 会被归为 Shorts（≤3 分钟）**；官方页未写 3:4 是否被裁切，也没写分辨率。
  - 核实状态：已打开原页面
- 缩略图：「Shorts: 2160 x 3840，minimum height of 640 pixels，9:16」（WebFetch 转述，出自 https://support.google.com/youtube/answer/72431）
- 音乐：「You can use most songs for up to 90 seconds in a 3 minute Short.」
- 免费 vs 付费：无

### Indie Hackers
- 视频 / 图片上传限制：**未找到官方原文**。站内社区帖（非官方帮助）称没有原生图片上传，需外链图片用 Markdown 嵌入：
  - 出处：Indie Hackers 站内用户帖，如 https://www.indiehackers.com/post/how-to-format-indie-hacker-posts-how-to-add-images-add-headers-lists-etc-6f45634683
  - 核实状态：仅见搜索摘要（我没有打开该页面核对）；视频/封面/张数均「未找到」

### Product Hunt
- 缩略图：推荐 240x240 方形，≤3MB，可用 GIF（悬停才动）
  - 原文：「It is best to use an image with square dimensions. We recommend 240x240. You can use a GIF for your thumbnail, but it will need to be under 3MB and not too 'flashy'. GIFs will only animate while hovering over a post.」
  - 出处：How to post a product | Product Hunt Help Center — https://help.producthunt.com/en/articles/479557-how-to-post-a-product
  - 核实状态：已打开原页面
- 画廊图：推荐 1270x760，至少 2 张
  - 原文：「The recommended size for images in the gallery is 1270x760. You can upload multiple images to the gallery at once.…The gallery will need 2+ images before it is viewable.」
  - 出处：同上
  - 核实状态：已打开原页面。「每张 <3MB」「画廊张数上限」仅在 https://www.producthunt.com/launch/preparing-for-launch 的 WebFetch 转述里出现（"under 3MB per image"），帮助页未见上限张数。
- 视频：只支持 YouTube 链接
  - 原文：「For videos, only YouTube links are supported.…it is not set to private…They will also need to be the full URL. Shorted links will not load.」
  - 出处：同上
  - 核实状态：已打开原页面。不支持直接上传视频文件，因此 3:4 视频取决于 YouTube。
- Tagline ≤60 字符、描述 ≤500 字符、最多 3 个标签（WebFetch 转述，preparing-for-launch）
- 免费 vs 付费：无

### 微信视频号
- 视频：宽高比 0.33–3.0；手机端 3 秒–60 分钟，电脑端 3 秒–8 小时；≤2GB；建议 1080p 以上；编码不限；不支持 GIF / HDR
  - 「原文」（仅见搜索摘要，转述自搜索工具）：「视频宽高比（宽/高）范围为 0.33~3.0，建议上传标准比例的视频（16:9 或者 9:16）」「手机端支持 3 秒~ 60 分钟…电脑端支持 3 秒~ 8 小时」「支持上传最大 2G 的视频」「分辨率：建议 1080p 以上；编码格式：不限」
  - 出处：微信视频号-视频号发表视频/图文有什么格式要求？ — https://findeross.weixin.qq.com/cgi-bin/mmfindernodelivecrmwebbroker-bin/helper-center/pages/Yhdpjlq2RIkcmnQu
  - 核实状态：**仅见搜索摘要**。我直接抓该页面（curl、存档、WebFetch）只得到前端空壳（`<title>微信视频号-</title>`，正文由 JS 加载），未能取得正文。
  - 3:4 = 0.75，在 0.33–3.0 内 → 按摘要支持；是否被裁切未找到。
- 图文：网页助手最多 18 张，手机 1–20 张，宽高比 0.33–3.0，图片格式不限
  - 出处：同上页（搜索摘要）
  - 核实状态：仅见搜索摘要
- 封面尺寸：未找到
- 免费 vs 付费：无

### 抖音
- 视频（开放平台 API 文档）：时长 15 分钟以内；直传 ≤100MB，>300MB 必须分片，分片总大小 4GB 以内；推荐 mp4 / webm；推荐 720p（1280x720）及以上竖版
  - 原文：「视频时长不能超过15分钟」「视频总大小 4GB 以内。单个分片建议 20MB，最小 5MB。」「为了更好的观看体验，推荐上传 16:9，分辨率为 720p（1280x720）及以上的竖版视频。」「支持常用视频格式，推荐使用 mp4 、webm。」
  - 出处：上传视频 / 分片上传_移动/网站应用（抖音开放平台）— https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/upload-video
  - 核实状态：已打开原页面（curl）。注意：这是**开放平台接口**的限制，不是创作者中心手动发布的限制；原文「16:9…竖版」自相矛盾，不宜直接引用。「≤100MB」来自 WebFetch 转述。
- 图片「不超过 100M」、水印降权等：仅见搜索摘要
- 3:4、创作者中心手动上传的时长 / 大小 / 比例、封面尺寸：**未找到官方原文**
- 免费 vs 付费：无

### 小红书
- 视频 / 图文 / 封面全部规格：**未找到官方原文**（creator.xiaohongshu.com 为前端渲染，搜索只返回站点入口）
- 第三方（知乎专栏 / 闪控猫 / 千贝网等，**第三方，未核实**）称：视频最长 15 分钟、≤10GB、mp4/mov、720P 以上；主推竖屏 3:4（另有 1:1、4:3）；图文最多 18 张、单张 ≤20MB。
  - 出处：搜索结果列表如 https://zhuanlan.zhihu.com/p/588804070 、https://shankongmao.com/content/special-news/3012 （我未能打开）
  - 核实状态：第三方（仅见搜索摘要）
- 免费 vs 付费：无

### 知乎
- 官方帮助原文：**未找到**（zhihu.com 对抓取返回 403）
- 搜索摘要（来源含知乎站内文章，非我打开的官方帮助页）：回答 / 文章内插视频最多 10 个，每个 ≤15 分钟、≤1G，mp4/mov 等；手机端相册视频 ≤12 分钟、≤2G；PC 端最多同时传 20 个、约 1 小时内、≤2G。
  - 核实状态：仅见搜索摘要 / 第三方；比例、3:4、封面、图片张数均未找到

### 哔哩哔哩
- 视频文件大小：网页端 8GB，移动端 4GB
  - 原文：「B站网页端视频文件上限全面从4GB升级至8GB。」「移动端上传规则暂时无改动，保持4GB的上限不变。」
  - 出处：网页端视频文件上限全面升级至8GB啦！（B站站内公告专栏）— https://www.bilibili.com/read/cv1761401/
  - 核实状态：已打开原页面（curl）。是历史公告，未见更新日期；另有搜索摘要称「单文件 ≤2GB」与其冲突，以页面原文为准并标注可能已变。
- 视频时长 / 比例 / 3:4 / 分辨率：**未找到官方原文**
- 封面：1146×717、<5MB（新版最小 480×300，旧版最小 960×600）
  - 核实状态：仅见搜索摘要 / 第三方（稿定设计、B站用户专栏 https://www.bilibili.com/read/cv11221825/ 我抓到的页面无正文）；官方帮助中心 https://www.bilibili.com/blackboard/help.html 为前端渲染，取不到正文。
- 图片：未查（动态图片 / 专栏）
- 免费 vs 付费：搜索摘要提到 32GB 需电磁力等级（仅见搜索摘要，未核实）

---

## 汇总表
图例：✓ 官方原文（含存档 / 官方仓库）；参考 = 第三方或仅搜索摘要；— = 未找到

| 平台 | 视频最长 | 视频最大 | 比例 | 3:4 是否支持 | 图片张数 | 封面尺寸 |
|---|---|---|---|---|---|---|
| X | ✓ 140 秒（Premium 4 小时；存档） | ✓ 512MB（Premium 16GB） | ✓ 1:2.39–2.39:1（网页） | ✓ 在范围内 | 参考（4 张，仅摘要；单图完整展示 2:1–3:4 ✓存档） | — |
| Reddit | ✓ 15 分钟 / Premium 30（存档，仅更新日志） | —（评论视频 1GB ✓存档） | — | — | — | — |
| Bluesky | ✓ 10 分钟（官方帖） | ✓ 300MB（lexicon） | — | — | ✓ 4 张（lexicon，单张 ≤2MB） | — |
| Threads | ✓ 5 分钟（API 文档） | ✓ 1GB | ✓ 0.01:1–10:1（API） | ✓ 在范围内 | ✓ 轮播 20（API；App 内仅摘要） | — |
| LinkedIn | ✓ 15 分钟 | ✓ 5GB | ✓ 1:2.4–2.4:1 | ✓ 在范围内 | — | — |
| YouTube | ✓ 15 分钟（验证后 12 小时） | ✓ 256GB | — | —（未限制比例） | — | ✓ 3840×2160，16:9，≥640 宽，≤2MB 手机 / 50MB 桌面 |
| YouTube Shorts | ✓ 3 分钟 | — | ✓ 方形或竖屏 | ✓ 竖版归 Shorts（未说裁切） | — | ✓ 2160×3840，9:16 |
| Indie Hackers | — | — | — | — | 参考（无原生上传，外链） | — |
| Product Hunt | 仅 YouTube 链接 ✓ | —（仅 YouTube） | — | — | ✓ 画廊 ≥2 张，推荐 1270×760 | ✓ 缩略图 240×240，<3MB |
| 小红书 | 参考（15 分钟） | 参考（10GB） | 参考（推荐 3:4） | 参考（推荐） | 参考（18 张） | — |
| 抖音 | ✓ 15 分钟（仅开放平台 API） | ✓ 4GB（分片，API） | 参考（文档自相矛盾） | — | — | — |
| 微信视频号 | 参考（电脑端 8 小时 / 手机 60 分钟） | 参考（2GB） | 参考（0.33–3.0） | 参考（在范围内） | 参考（网页 18 / 手机 20） | — |
| 知乎 | 参考（15 分钟 / 1 小时） | 参考（1G / 2G） | — | — | — | — |
| 哔哩哔哩 | — | ✓ 网页 8GB / 移动 4GB（旧公告） | — | — | — | 参考（1146×717） |

## 没找到官方原文的项目（清单）
- **Reddit**：帖子视频大小上限、比例、格式、图片张数与大小、封面。
- **Bluesky**：视频比例、分辨率、封面。
- **X**：图片"4 张"的帮助页原文（仅摘要）；封面；帮助页未写 3:4 是否裁切。
- **Threads**：App 内手动发布的官方规格（只有 API 文档）；封面。
- **LinkedIn**：图片张数与大小、封面。
- **Indie Hackers**：全部（没有官方规格页）。
- **微信视频号**：官方页正文抓不到，全部为搜索摘要；封面尺寸未找到。
- **小红书、知乎**：全部未找到官方原文，仅第三方。
- **抖音**：创作者中心手动发布的规格、图文、封面（仅开放平台 API 文档）。
- **B站**：时长、比例、3:4、封面官方规格（仅旧公告的 8GB）。
- 所有平台的「3:4 是否被裁切」：**没有任何官方页面直接回答**；只能确认比例是否落在允许范围内。需真机试发或另找官方设计指南。
