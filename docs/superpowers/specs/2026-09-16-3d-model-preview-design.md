# 3D 模型预览（按需下载查看器）设计

2026-09-16。用户需求：图片预览扩成多媒体预览，含 3D 模型。约束（用户明确）：
**model-viewer 不进主包**；首次查看 3D 时用户点一下、按需下载查看器，之后缓存直接用。

## 决策

- **查看器**：`@google/model-viewer` 4.3.1 的 UMD 自包含 min（`model-viewer-umd.min.js`，
  1.02MB，含 three.js，sha256 `4492ad16f4aa7ceef5ec9bab645e62d56e990e5ae9737b0d60d58246fb23c0d5`）。
- **不进主包 + 按需下载**：镜像语音模型那套（stt.ts）——首次点「下载」→ 主进程从
  `https://eas.biily.top/deps/` 拉到 `userData/deps/`，SHA256 校验、缓存；之后离线可用。
  托管在自己的服务器（符合「不私自新增出站」，能钉版本+校验），不是公共 CDN。
- **首版只收单文件 `.glb`**（避开 .gltf/.obj 引外部 .bin/贴图的相对路径解析坑）。
- **隔离**：3D 跑在一个**裸 `<webview>`**（独立进程/独立 CSP，和网页节点同一套 webviewTag
  基建）里，加载一个由新 `easmodel://` 特权 scheme 现生成的查看器页。**主渲染层 CSP 一个字
  不动**（`script-src 'self'` 是 🔴 边界）；查看器页的 CSP 走 scheme 响应头（同插件面板
  panelHtml 的做法）。WebGL 也天然隔离在自己的进程里。
- **节点模型**：复用 `kind:'image'` + `.glb` 扩展名（和视频/音频一路，data-kind 只挑色相），
  不新增 PaneState 种类、不动 PaneView。CanvasFileNode/FreeFileNode 按扩展名分流到
  `Canvas3DViewer`。

## `easmodel://` scheme（新，`src/main/modelScheme.ts`）

privileged：`{standard, secure, stream, supportFetchAPI}`（同 easfile）。三类资源：

- `easmodel://view/<b64url(glb 绝对路径)>` → 现生成查看器 HTML（内联 `<model-viewer
  src="easmodel://model/<同一 b64>">` + `<script src="easmodel://lib/mv.js">`）。
  响应头 CSP：`default-src 'none'; script-src easmodel:; style-src easmodel: 'unsafe-inline';
  connect-src easmodel:; img-src easmodel: data: blob:; ...`（只放行本 scheme，model-viewer
  的 fetch 走 connect-src easmodel:）。
- `easmodel://lib/mv.js` → serve `userData/deps/model-viewer-umd.min.js`（没下载 → 404）。
- `easmodel://model/<b64url(path)>` → serve 那个 .glb（MIME `model/gltf-binary`，
  **路径白名单同 easfile**：解码得绝对路径 → 校验 isAbsolute + 存在 + 扩展名是 .glb，否则拒）。

## 下载基建（`src/main/modelDep.ts`，镜像 stt.ts）

- IPC `modelDep:status` → `{ installed: boolean }`（userData/deps/<file> 存在且 sha256 对）。
- IPC `modelDep:download` → 从 `MODEL_VIEWER_URL` 下载到 `.part` → sha256 校验 → 原子改名；
  进度经 `modelDep:downloadProgress` 回传（received/total）。并发下载去重。
- 常量在 `src/shared/modelViewerDep.ts`（版本/文件名/URL/sha256/size，主+渲染共用）。

## 渲染层

- `mediaExts.ts`：加 `MODEL_EXTS = {glb}` + `isModelPath`；并入 `isMediaPath`（3D 也算媒体，
  文件选择器「仅多媒体」筛选带上它）。
- `media.paneForFile` / `mcpHandler(canvas_open_file)`：`.glb` → `kind:'image'`。
- `Canvas3DViewer.tsx`：`modelDep:status` 未装 → 占位「这是 3D 模型 · 首次查看需下载查看器
  （约 1MB）[下载]」+ 下载进度；已装 → 裸 `<webview src="easmodel://view/...">`（命令式创建，
  离屏可回收，无浏览器 chrome）。
- CanvasFileNode / CanvasFreeFileNode：`isModel = kind:'image' && isModelPath(filePath)` →
  渲染 `Canvas3DViewer`。节点头图标加一个立方体 `CubeIcon`。
- preload：暴露 `window.api.modelDep`（status / download / onProgress）。

## 部署

`scripts/publish-deps.sh`：npm pack @google/model-viewer@<版本> → 取 umd.min → 校验 sha256 →
scp 到 `/www/wwwroot/eas-dl/deps/`（或 `/www/wwwroot/eas/deps/`）。app 里 URL 指向它。
**app 发版前必须先把 bundle 传上去**，否则用户点下载 404。

## 验证

真机：放一个真实 .glb → 打开 → 未装态显示下载占位 → 触发下载（校验通过）→ webview 里
`<model-viewer>` 加载出模型（查 webview 内 DOM / 无报错）。mediaExts 加 model 测试。

## 落地时和设计的偏差（真机验证换来的，都在 modelViewer.ts 注释里）

设计里 easmodel scheme 想 serve 三样、用不同 host + 让 model-viewer fetch .glb。实测在 Electron
webview 下踩了一串坑，最终形态是：

1. **自定义 scheme 的 fetch 在 webview 下取不到**：`<script src>` / 导航能加载 easmodel://，但
   `fetch('easmodel://…')` 一律「Failed to fetch」、handler 都到不了（试过 partition/默认 session、
   加 corsEnabled、去 stream，都不行，且不是 CSP —— securitypolicyviolation 为 null）。而 model-viewer
   靠 fetch 取 .glb。**解法：把 .glb 直接 base64 内联成 `data:` URL 塞进 `<model-viewer src>`**，
   viewer handler 读盘→base64→内联，不再有单独的 asset 请求。代价：大模型的查看器 HTML 会大（base64
   膨胀），首版只收单文件 .glb 能接受。
2. **单 host**：所有资源在 `easmodel://m/<kind>/…` 下（曾用 view/lib/model 三个 host = 三个 origin，
   跨源问题更多）。现在只剩 `m/lib`（脚本）和 `m/viewer/<enc>`（HTML，内联模型）。
3. **默认 session**：handler 注册在默认 session（`protocol.handle`），webview **不设 partition**（用
   默认 session）。独立 partition 上 handler 够不着 / fetch 取不到。
4. **`loading="eager"`**：model-viewer 默认 `loading="auto"` 懒加载（近视口才加载），webview 在某些
   合成状态下永不触发 → 模型永远不加载。必须 eager。
5. viewer handler 里对 `<enc>` 解出的路径做和 easfile 同样的白名单（绝对路径 + 存在 + 扩展名 .glb）。

真机验收：下载闸（约 1MB）→ 点下载（从 eas.biily.top 拉、SHA256 校验）→ webview 里 model-viewer
`loaded=true`，`toDataURL()` 渲出带光照的立方体（Khronos Box.glb）。

## 不做（v1）

.gltf/.obj 多文件模型；AR 按钮；模型编辑；动画时间轴。后续单独提。
