# 用 CDP 远程调试给 Eas-Term 做 UI 眼验（破解「多实例抢焦点」老大难）

> 2026-07-16。此前多份 memory（对话导航.md / 终端滚动条-altscreen.md）反复记「UI 没能亲手截图验证」，
> 根因都是：机器上同时跑着**打包版 Eas-Term（多个 auto-mode Claude 会话）+ Chrome + 其他 Electron dev**，
> 它们持续抢 OS 焦点，`cliclick`/`osascript keystroke` 坐标点击会打到别的 app（实测误在 Chrome 加过书签、⌘T 打到打包版）。
> `screencapture` 只能截最顶层窗口，也截不到被压在下面的 dev 窗口。**结论：靠 OS 焦点驱动这台机器上的 dev 窗口不可行。**

## 可行解：Chrome DevTools Protocol，完全绕开 OS 焦点

> ⚠️ **第 1、2 步已废弃（2026-08-19）**，下面保留原文只为说明当初为什么这么做。
> 现在一条命令代替：**`npm run verify`**（= build + `scripts/verify-app.mjs --seed`），
> 端口由脚本经 argv 传入，**不要再手改 `src/main/index.ts`**；
> 跑 JS 用 `node scripts/eval-in-app.mjs "<js>"`。
> 更要紧的是**别再用 `npm run dev` 验证** —— 它的 userData 和正式版是同一个目录（密钥柜就在那儿），
> 详见 [[工作规则-验证只在dev端-不擅自动release-app]] 的更正块与 `docs/architecture/14-验证与调试.md`。

1. ~~**临时**在 `src/main/index.ts` 顶部加 `remote-debugging-port`~~ —— 已由 `verify-app.mjs` 传参代替。
   端口**别用 9222** 这条仍然有效：本机另一个 Electron（数字艺术软件 Aurora）常年占 9222，会 `bind() failed`。9333 空闲。
2. ~~按 `url 含 localhost:5173` 找 page~~ —— 现在跑的是构建产物，没有 5173。
   **改为按 `p.title === 'Eas-Term'` 认主窗口**：灵动岛与主窗口同 url，画布里每个网页节点还是独立 webview，
   按 url 会连错；连错的症状是所有 `querySelectorAll` 都返回 0。
3. Node 22 内置 `WebSocket` + `fetch`，写个极简 CDP 客户端（存档在会话 scratchpad `cdp.mjs`）：
   - `Runtime.evaluate {expression, returnByValue, awaitPromise}` → 在真实页面跑任意 JS（点按钮、派发事件、读 DOM）。
   - `Page.captureScreenshot {format:'png'}` → 拿真实渲染截图（base64），写文件后用 Read 看。
4. ~~验证完务必删掉那行调试代码~~ —— 已无调试代码可删（端口走 argv）。收尾改为：按端口或
   `node_modules/electron/dist` 精确路径关掉实例，**绝不 `pkill -f "Eas-Term"`**（会误杀用户正跑的 release app）。

## 驱动 React UI 的关键坑（都踩过）

- **点击**：`el.click()` 能触发 React `onClick`（合成事件走根委托）。
- **hover 浮层**：React `onMouseEnter` 要派发 `new MouseEvent('mouseenter'|'mouseover',{bubbles:true,clientX,clientY})`。
- **受控 input**：直接改 `.value` 无效，要用原生 setter：
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inp, val); inp.dispatchEvent(new Event('input',{bubbles:true}))`。
- **窗口没 OS 焦点时 `element.focus()` 是 no-op、不触发 `focusin`** → 依赖 focusin 的逻辑（如终端聚焦记 `lastActiveTerminal`）不会跑。
  破解：直接 `host.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))`，handler 从闭包取 ptyId，任何 focusin 都会正确记录。
- **`window.api` 是 contextBridge 只读对象，无法 monkey-patch**（`window.api.pty.write = fn` 静默失败，赋值后 `!==` 仍为 false）。
  想探针化 preload API 行不通 → 改用**截图看真实结果**（如 pty.write 后看终端是否回显文本）。
- zustand `useStore.setState/getState` 是同步的：派发 focusin 后同一 tick 内 `getState()` 立刻能读到新状态，不受 React 异步渲染影响；
  但读 `.dict-inserted` 这类 React 渲染出的 DOM 要等一帧（sleep 后再读）。

## 用它验过的功能（名词词典面板 dict）

下拉框含「名词词典」；面板渲染 242/242 + 分类 chip + 彩色圆点；搜索「滚动」→18 条；分类「动效」→80 条全 cat-motion；
hover→玻璃浮层含内联 SVG+逻辑、Portal 不被裁切、空间不足自动翻左；点词条→`term.logic` 插入活动终端光标处、未回车执行。全部真机眼验通过。
