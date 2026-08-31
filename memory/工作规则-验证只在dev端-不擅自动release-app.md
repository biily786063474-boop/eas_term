# 工作规则：验证只在 dev 端做，绝不擅自动 release app（用户明确要求）

> 2026-07-23。用户为此发过火：我做 Codex 接入验证收尾时跑了 `pkill -f "Eas-Term"`，
> 这个匹配模式太宽，把用户正在运行的**正式 release app**（`~/Eas-Term-release/mac-arm64/Eas-Term.app`）
> 的进程也一起杀了 → 渲染 helper 没了、窗口壳在但整个内容白屏。用户体验极差。

## 铁律（用户下的）

1. **所有验证只在隔离实例上做** —— 用 `npm run verify`（= build + `scripts/verify-app.mjs --seed`），
   **不要用 `npm run dev`**。

   > ⚠️ **2026-08-19 更正**：本条原文写的是「验证只在 dev 端做，`npm run dev` 起的是独立实例」。
   > 那句话只在**进程**层面成立，**数据层面是错的** —— dev 的 userData 走 `app.getName()`
   > 读 package.json 的 `productName`（都是 `Eas-Term`），**跟正式版是同一个目录**，
   > 密钥柜 `secrets.json`、`mcp-endpoint.json`、`agent-history/` 全在那儿。
   > 拿 dev 验证 = 在用户真实凭证上做实验（同类事故：测 CLI 登录把真实凭证清掉）。
   > 而且 electron-vite 的 CLI 自己解析参数，`--user-data-dir` 传不进去（报 Unknown option），
   > 想隔离也隔离不了。依据写在 `scripts/verify-app.mjs` 文件头。
   > `npm run verify` 跑的是构建产物 + 显式 `--user-data-dir=<临时目录>`，退出时删掉。

   「绝不碰 release app」这一条不变，仍然有效。
2. **不经用户明确指示，绝不安装/打包/替换 app**（不跑 `npm run dist`、不 `open` release app、不替换 /Applications）。
   用户说"我让你安装 app 再安装"。
3. **kill 进程必须精确**：绝不用 `pkill -f "Eas-Term"` 这种宽泛名字匹配（会误伤 release app）。
   要杀 dev 实例，按**端口**（dev 的 CDP 9333）或**精确路径**（`node_modules/electron/dist`）定位；
   要动 release 只在用户要求时、且限定 `/Users/biily/Eas-Term-release/` 全路径。

## 关联

- CDP 眼验法见 [[CDP眼验法-破解多实例抢焦点]]（端口 9333、绕开 OS 焦点）—— 那篇的**第 1、2 步已废弃**
  （不再手改 `src/main/index.ts` 加端口、不再按 url 找 page），改由 `scripts/verify-app.mjs` 传参；
  其「驱动 React UI 的关键坑」一节仍然全部有效。
- 完整验证链路见 `docs/architecture/14-验证与调试.md`。
- 收尾只按 9333 端口 / `node_modules/electron/dist` 精确路径关，不 pkill 名字。
