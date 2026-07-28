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

## 截图

6 张都已就位（`assets/shot-*.png`），用开发版 + 独立 userData 起了一块干净的演示画布截的，
不含任何真实项目信息。全部 8-bit 调色板量化过（2.8MB → 833KB，截图配色少，肉眼无损）。

| 文件 | 用在哪 | 画面内容 |
|------|--------|----------|
| `shot-hero.png` | Hero | 全景：左终端跑 AI、右画布摆着网页预览和代码，左上角运行监视窗亮着 |
| `shot-preview.png` | 场景 1 | Claude Code 写完周报，产出的页面就在画布上 |
| `shot-split.png` | 场景 2 | 终端模式：项目文件树 + 标签组 |
| `shot-agent.png` | 场景 3 | Agent 控制台特写：Claude/Codex、模型、思考档位 |
| `shot-markdown.png` | 场景 4 | Markdown 排版预览与网页预览并排 |
| `shot-mcp.png` | AI 接入 | AI 通过 MCP 开出的预览节点，标题栏 MCP 计数 |

要重截的话：`EAS_USER_DATA=<临时目录> EAS_CDP=9555 npm run dev` 起一个干净实例，
再用 CDP 摆画布截图。两个坑：改视口后必须重新点「适应窗口」，否则画布视野错位；
CDP 只截渲染层而窗口是 vibrancy 透明底，要设 `Emulation.setDefaultBackgroundColorOverride`，
不然空白处会截成白灰。

## 设计约束（改动时请遵守）

- 设计 token 全部对齐软件源码 `src/renderer/src/styles/base.css`，**不要换配色、不要换字体**
- 图标一律内联 SVG，Lucide 线条风格：`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`，**不要用 emoji 当功能图标**
- 动效克制：只允许 `color / background-color / border-color / opacity` 过渡，约 0.15s。不要位移动画、入场动画、视差
- 宽内容（表格等）必须自己 `overflow-x: auto`，body 永不横向滚动
- 不要引入任何外部资源（CDN、Google Fonts、统计脚本），断网必须能打开
