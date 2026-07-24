# 工作规则：验证只在 dev 端做，绝不擅自动 release app（用户明确要求）

> 2026-07-23。用户为此发过火：我做 Codex 接入验证收尾时跑了 `pkill -f "Eas-Term"`，
> 这个匹配模式太宽，把用户正在运行的**正式 release app**（`~/Eas-Term-release/mac-arm64/Eas-Term.app`）
> 的进程也一起杀了 → 渲染 helper 没了、窗口壳在但整个内容白屏。用户体验极差。

## 铁律（用户下的）

1. **所有验证只在 dev 端做**：`npm run dev` 起的是**独立实例**（`node_modules/electron/dist/...`），
   和用户正式 app（`~/Eas-Term-release/...`）是两个进程。CDP 眼验、点按钮、启动 agent 等一切验证
   都在 dev 实例上，**绝不碰 release app**。
2. **不经用户明确指示，绝不安装/打包/替换 app**（不跑 `npm run dist`、不 `open` release app、不替换 /Applications）。
   用户说"我让你安装 app 再安装"。
3. **kill 进程必须精确**：绝不用 `pkill -f "Eas-Term"` 这种宽泛名字匹配（会误伤 release app）。
   要杀 dev 实例，按**端口**（dev 的 CDP 9333）或**精确路径**（`node_modules/electron/dist`）定位；
   要动 release 只在用户要求时、且限定 `/Users/biily/Eas-Term-release/` 全路径。

## 关联

- CDP 眼验法见 [[CDP眼验法-破解多实例抢焦点]]（端口 9333、绕开 OS 焦点）——它本就是在 dev 实例上做的，
  以后严格只连 dev 那个 page，收尾只按 9333 端口/dev 路径关，不 pkill 名字。
