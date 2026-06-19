# Eas-Term

多终端 + 项目文件浏览的桌面工作台（macOS），采用 **Blender 式区域布局**。

核心理念：**终端跟着项目走**。在侧边栏通过 GUI 添加/新建项目文件夹，新开的终端自动以项目根目录为工作目录，无需手动 `cd`。主区域可像 Blender 一样任意宫格分割，每个面板左上角有功能下拉框，可切换为 **终端 / 代码预览 / 图片预览**。

## 技术栈

- **Electron** + **electron-vite**（React 18 + TypeScript）
- **xterm.js**（@xterm/xterm，WebGL 渲染，DOM 回退，半透明背景）
- **node-pty**（真实 PTY，登录 shell）
- **CodeMirror 6**（只读代码预览，按扩展名自动加载语法高亮）
- **zustand**（状态管理）

## 视觉语言：液态玻璃

- 窗口级 vibrancy（`under-window`）透出桌面模糊，`backgroundColor` 全透明
- 侧边栏 / 标签栏 / 面板均为**浮动玻璃卡片**：`backdrop-filter: blur(28px) saturate(160%)` + 半透明底色 + 1px 高光描边 + 顶部内阴影高光
- 大圆角体系：卡片 18px / 面板 14px / 控件 10px / 小元素 7px，按钮药丸形
- 全套自绘 SVG 线条图标（Lucide 风格，1.6 描边圆端点），无 emoji
- 面板功能切换为自定义玻璃下拉菜单（fixed 定位避免被圆角裁切）
- 终端（`allowTransparency`）与代码编辑器背景透明，玻璃层直接透出

## 开发

```bash
npm install                # 自动通过 electron-rebuild 编译 node-pty
npm run dev                # 启动开发模式（渲染层 HMR）
npm run dev -- --watch     # 主进程/preload 改动也自动重启
npm run typecheck          # 类型检查
npm run build              # 产物构建到 out/
npm run dist               # 打包分发：DMG + ZIP 输出到 ~/Eas-Term-release/
```

## 分发

`npm run dist` 产出（arm64 / Apple Silicon）：

- `~/Eas-Term-release/Eas-Term-0.1.0-arm64.dmg` — 拖拽安装镜像
- `~/Eas-Term-release/Eas-Term-0.1.0-arm64-mac.zip` — 压缩包
- `~/Eas-Term-release/mac-arm64/Eas-Term.app` — 可直接运行的应用

注意事项：

- **未签名**（无 Apple Developer 证书）：接收者首次打开会被 Gatekeeper 拦截，需**右键 →打开**，或执行 `xattr -cr /Applications/Eas-Term.app`。要去掉该提示需加入 Apple Developer Program 并配置 `mac.identity` + 公证（notarize）。
- 项目位于外置卷（`/Volumes/biily`，非 APFS）：electron-builder 的 asar 在该卷上会损坏，因此 `dist` 脚本把输出目录定向到 `$HOME/Eas-Term-release` 并带 `COPYFILE_DISABLE=1` 排除 AppleDouble（`._*`）文件——不要把输出目录改回项目内。
- 运行时依赖只有 `node-pty`（原生模块，已 `asarUnpack`）；React/xterm/CodeMirror 等都在 devDependencies，由 Vite 打进 `out/`，不进安装包。

## 跨平台与 Windows 构建

代码**运行时按 `process.platform` 自适应**，一份代码同时支持 macOS / Windows，换平台构建无需改代码。平台差异点：

- 快捷键：mac 用 ⌘、Windows/Linux 用 Ctrl（preload 暴露 `platform`）
- PTY：mac/Linux 启动登录 shell（`-l`），Windows 用 PowerShell（不传 `-l`）
- 运行中检测：unix 用 `ps`，Windows 用 PowerShell `Get-CimInstance`
- 窗口：mac 用 vibrancy + 隐藏式标题栏，Windows 用系统标题栏 + 不透明深色底
- 字体：等宽字体回退表包含 SF Mono（mac）与 Cascadia Code / Consolas（Windows）

**node-pty 是原生模块，不能在 Mac 上交叉编译 Windows 版**——必须在 Windows 环境编译。仓库已配 GitHub Actions（`.github/workflows/build.yml`）：

- 触发：打 `v*` tag 或在 Actions 页手动 Run workflow
- 在 macOS 和 Windows runner 上各自 `npm install`（编译对应平台 node-pty）+ `npm run dist:ci`
- 产物：mac 的 `.dmg`/`.zip` 与 Windows 的 `.exe`（NSIS 安装包），上传为 Artifacts；打 tag 时还会发布到 GitHub Release

## 功能

| 功能 | 操作 |
| --- | --- |
| 添加/新建项目 | 侧边栏「项目」区 ＋ 按钮（系统目录选择器，可新建文件夹，支持多选） |
| 新建终端（定位到当前项目） | `⌘T` / 标签栏 ＋ / 双击项目 / 项目行 ⌨ 按钮 |
| 切换面板功能 | 面板左上角下拉框：终端 / 代码预览 / 图片预览（Blender 式） |
| 预览文件 | 单击文件树中的文件——代码进代码面板、图片进图片面板（复用已有面板，没有则自动分屏） |
| 左右/上下分屏 | `⌘D` / `⌘⇧D`，或面板头部 ◫ ⬓ 按钮（克隆当前面板类型与内容） |
| 关闭当前面板 | `⌘W` 或面板头部 ×（最后一个面板关闭时整个标签页关闭） |
| 运行中确认 | 关闭面板/标签页或退出应用时，若终端仍有命令在跑会弹确认（避免误杀进程）；空闲终端直接关。判断依据是 shell 进程是否有子进程 |
| 切换标签页 | `⌘1`–`⌘9`，鼠标中键关闭标签 |
| 重命名标签页 | 双击标签名 → 内联输入框（Enter 确认 / Esc 取消）；手动命名后不再被 shell 自动标题覆盖，清空名字恢复自动标题 |
| 主题切换 | 标题栏右侧调色板按钮：默认·蓝 / 黑粉（黑底粉色高亮）；持久化保存；CSS 变量（`--accent-rgb` 等）+ xterm 主题同步切换，新增主题只需在 `themes.ts` 和 `styles.css` 各加一段 |
| 文件树 | 点击项目显示；右键：在此文件夹打开终端 / 在面板中预览 / 用默认应用打开 / 在访达中显示 |
| 调整分屏比例 | 拖拽分割线 |
| 图片预览 | 「文件预览 / 生图历史」两种模式；文件模式支持适应窗口/原始大小切换 |
| 生图历史（笔纵画板联动） | 读取笔纵画板本地媒体库，按项目分类浏览图片/视频；**分页渲染**（首屏 60 项，滚动到底部前 600px 自动追加，工具栏显示 `60 / 366 项` 进度）；点击放大到整个面板（Esc 关闭）；右键插入到当前仓库的 `V-assets/`；未安装时给出官网与下载链接 |
| 文件树右键 | 在面板中预览 / 用默认应用打开 / 在访达中显示 / 重命名（内联） / 删除（废纸篓） / 插入路径到终端 / 复制路径 / 复制相对路径；文件夹另有「在此打开终端」 |
| 代码预览 | 只读，语法高亮按文件名自动匹配，超 2MB 截断提示，二进制自动识别 |

## 架构要点

```
src/
  main/        主进程：窗口、PTY 管理(pty.ts)、项目持久化(projects.ts)、文件系统(fs.ts)
  preload/     contextBridge 桥接 + PTY 首批输出缓冲（防止 shell 提示符丢失）
  shared/      主进程/渲染进程共享类型
  renderer/    React UI
    src/layout.ts   面板二叉分割树 → 扁平矩形布局（PaneState 区分终端/代码/图片）
    src/store.ts    zustand 全局状态（项目、标签页、面板树、文件打开路由）
    src/components/ Sidebar / FileTree / TabBar / TabContent
                    PaneView（区域头部+下拉框）/ TerminalView / CodeView / ImageView
```

- **终端面板按项目隔离**：每个标签带 `projectId`，TabBar 只显示当前项目的标签；切换项目时右侧整组切换并恢复该项目上次激活的标签（`activeTabByProject` 记忆）。所有项目的 TabContent 始终挂载、用 `display:none` 保活，切来切去不丢终端状态与滚动缓冲。移除项目会关闭其名下所有标签的 PTY。
- **Blender 式区域模型**：每个叶子面板带 `PaneState`（kind: terminal/code/image），头部下拉框切换功能；分屏克隆当前面板类型，终端则新开 shell。
- **笔纵画板联动**（`src/main/bizone.ts`）：读取 `~/Library/Application Support/笔纵画板/BizoneCanvasData/` 下的 `projects/_index.json`（项目索引）与 `media/*.bin + *.meta.json`（媒体），通过自定义协议 `bizone-media://local/<id>` 流式传输（视频不走 base64）；安装检测看 `/Applications/笔纵画板.app` 或数据目录，下载链接实时取 `bzone.biily.top/version.json`。
- **浮层一律走 React Portal 到 body**：玻璃面板的 `backdrop-filter` 会让后代 `position: fixed` 相对面板定位、再被 `overflow: hidden` 裁切——所有菜单/下拉必须 Portal 逃逸（踩过的坑）。
- 文件树目录级刷新：操作完成后派发 `fs-dir-changed` 自定义事件，对应目录组件就地重载，保留展开状态。
- 分屏采用**二叉分割树**，渲染时扁平化为绝对定位矩形：调整布局只改坐标，面板组件（含 xterm）永不重挂载，滚动缓冲不丢失。
- 文件打开路由：图片扩展名进图片面板，其余进代码面板；优先复用当前标签页同类面板，否则从活动面板自动分屏。
- 面板从终端切走或被关闭时自动回收 PTY；PTY 意外退出只关闭对应面板（带 ptyId 校验防误关）。
- 项目列表持久化在 `~/Library/Application Support/Eas-Term/projects.json`。
- 页面刷新/窗口关闭时主进程自动回收对应的所有 PTY，无泄漏。
