# 发布台平台图标来源

面板里各平台卡片左上角的标识，路径数据取自 [Simple Icons](https://simpleicons.org) **16.33.0**（`npm pack simple-icons`），
项目整体授权 **CC0-1.0**。按其 DISCLAIMER：图标所代表的商标归各品牌所有，使用应遵循各品牌规范。
这里只用于标明「这张卡片发往哪个平台」（识别性使用），图形未改动，按品牌色填底、白色图形。

| 平台 id | Simple Icons 条目 | 品牌色 | 品牌规范 |
|---|---|---|---|
| x | X | #000000 | https://about.x.com/en/who-we-are/brand-toolkit |
| reddit | Reddit | #FF4500 | https://www.redditinc.com/brand |
| bluesky | Bluesky | #1185FE | https://bsky.social/about/blog/press-faq |
| threads | Threads | #000000 | https://www.meta.com/brand/resources/instagram/threads |
| youtube | YouTube | #FF0000 | https://www.youtube.com/howyoutubeworks/resources/brand-resources/#logos-icons-and-colors |
| youtube-shorts | YouTube Shorts | #FF0000 | （未提供） |
| indiehackers | Indie Hackers | #0E2439 | （未提供） |
| producthunt | Product Hunt | #DA552F | https://www.producthunt.com/branding |
| xiaohongshu | Xiaohongshu | #FF2442 | （未提供） |
| douyin | TikTok | #000000 | （未提供） |
| zhihu | Zhihu | #0084FF | （未提供） |
| bilibili | Bilibili | #00A1D6 | （未提供） |

缺口（显示中性字母块，不仿画官方标识）：

- `linkedin`：LinkedIn 已要求 Simple Icons 撤下其图标。
- `channels`（视频号）：Simple Icons 未收录；微信图标不代表视频号。

更新：重新 `npm pack simple-icons`，按上表取 `icons/<slug>.svg` 的 path 与 `data/simple-icons.json` 的 hex，替换 `panel.html` 里的 `ICONS`。
