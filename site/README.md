# Eas-Term 官网

纯静态站点。**零外部依赖**：不引 CDN、不引外部字体、无构建步骤、无 JavaScript。断网双击 `index.html` 即可打开。

## 文件

```
site/
├── index.html      产品落地页（Hero / 核心场景 / 能力清单 / AI 接入 / 下载 / Footer）
├── download.html   下载页（安装包列表 / 安装步骤 / 常见问题）
├── style.css       全部样式，设计 token 取自 src/renderer/src/styles/base.css
└── assets/
    └── icon.png    应用图标，从 build/icon.png 复制（512×512）
```

## 本地预览

```bash
cd site
python3 -m http.server 8080
# 打开 http://localhost:8080
```

或者直接双击 `index.html`（无 JS、无 fetch，file:// 协议下也正常）。

## 部署

站点是纯静态的，把 `site/` 目录整个上传即可，不需要任何服务端逻辑。

- GitHub Pages：把 `site/` 设为 Pages 源目录，或把内容放到 `gh-pages` 分支根目录
- Netlify / Vercel / Cloudflare Pages：Build command 留空，Publish directory 填 `site`
- 自有服务器：按项目惯例逐个文件 `scp`（不要用 `-r`），上传前先清掉服务器上的旧文件

**注意**：`icon.png` 是从 `build/icon.png` 复制来的副本。app 图标换了之后要手动同步：

```bash
cp build/icon.png site/assets/icon.png
```

## 待填的下载链接

下载链接目前全是占位 `#`，源码里每一处旁边都有 `<!-- 待填 GitHub Release 地址 -->` 注释，直接搜这行就能定位。共 8 个位置、10 个链接：

| 文件 | 位置 | 链接内容 |
| --- | --- | --- |
| `index.html` | Hero 主按钮 | macOS `.dmg` |
| `index.html` | Hero 副按钮 | Windows `.exe` |
| `index.html` | 下载区 macOS 卡片 | macOS `.dmg` |
| `index.html` | 下载区 Windows 卡片 | Windows `.exe` |
| `download.html` | 顶部 macOS 卡片 | macOS `.dmg` |
| `download.html` | 顶部 Windows 卡片 | Windows `.exe` |
| `download.html` | 「全部安装包」表格 | 3 行：mac `.dmg` / mac `.zip` / win `.exe` |
| `download.html` | 表格下方 note | GitHub Releases 列表页 |

另有 2 处 GitHub 仓库地址占位，注释是 `<!-- 待填 GitHub 仓库地址 -->`，在 `index.html` 和 `download.html` 的 Footer 里。

快速定位：

```bash
grep -rn "待填" site/
```

## 待补的截图

目前页面里所有截图位置都是**占位块**（深色玻璃质感 + 「界面截图 · 待补」文字），没有用任何假图。
每个占位块用 `aspect-ratio` 固定了比例，换成真图时只要把 `<div class="shot-box">…</div>` 整块替换成
`<img src="assets/shot-xxx.png" alt="…" />` 即可，外层 `<figure class="shot">` 和说明文字保留。

需要 5 张，都建议 **2× 分辨率截图**（Retina 下截，输出尺寸是标注值的 2 倍），PNG 格式，**深色主题（默认蓝）**，
窗口尺寸尽量统一，窗口阴影可留可去（页面自己有阴影，建议截**不带系统阴影**的窗口内容）：

| # | 位置 | 建议尺寸 | 比例 | 内容要求 |
| --- | --- | --- | --- | --- |
| 1 | `index.html` Hero | 1920×1200 | 16:10 | **主视觉**。全窗口截图：左侧一个终端在跑 AI，右侧画布上摆着网页预览 + 代码 + 图片几个模块，能一眼看懂「左终端右画布」。画面要干净，别有报错。 |
| 2 | 核心场景 1「AI 写完，画布上直接看」 | 1600×1000 | 16:10 | 终端节点旁边挂着一个网页预览节点，预览里是刚生成的页面。最好能看出两者的关联。 |
| 3 | 核心场景 2「多终端分屏」 | 1600×1000 | 16:10 | 横竖分屏的多终端布局 + 顶部项目标签组，左上角运行监视窗可见。 |
| 4 | 核心场景 3「AI Agent 控制台」 | 1600×1000 | 16:10 | Claude Code / Codex 的启动入口，能看到模型和思考档位的选择状态。 |
| 5 | 核心场景 4「Markdown 与 Git」 | 1600×1000 | 16:10 | Markdown 排版预览模块 + Git 提交历史/diff 模块并排。 |
| 6 | AI 接入区 | 1600×900 | 16:9 | AI 通过 MCP 在画布上开出预览节点的瞬间，最好能同时看到终端里的工具调用和画布上新出现的节点。 |

截图注意事项：

- 项目名、文件路径里不要出现私密信息（客户名、内网地址、密钥路径）
- 终端里不要留 API key、token、真实邮箱
- 统一用默认蓝主题，不要混黑粉主题，否则和站点配色不一致
- 图片放进 `site/assets/`，命名建议 `shot-hero.png`、`shot-canvas.png`、`shot-split.png`、`shot-agent.png`、`shot-md-git.png`、`shot-mcp.png`

## 设计约束（改动时请遵守）

- 设计 token 全部对齐软件源码 `src/renderer/src/styles/base.css`，**不要换配色、不要换字体**
- 图标一律内联 SVG，Lucide 线条风格：`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`，**不要用 emoji 当功能图标**
- 动效克制：只允许 `color / background-color / border-color / opacity` 过渡，约 0.15s。不要位移动画、入场动画、视差
- 宽内容（表格等）必须自己 `overflow-x: auto`，body 永不横向滚动
- 不要引入任何外部资源（CDN、Google Fonts、统计脚本），断网必须能打开
