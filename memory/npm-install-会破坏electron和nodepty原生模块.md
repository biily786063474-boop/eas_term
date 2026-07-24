# ⚠️ 这台机器上 `npm install` 会破坏 electron dist 与 node-pty，导致 dev 起不来

> 2026-07-22。给终端加 `@xterm/addon-canvas` 时踩的坑，排查+修复花了很久。**下次装任何包前先读这条。**

## 现象（连环三连炸）

`npm install <任何包>` 之后 `npm run dev`，会依次遇到：
1. `Error: Electron uninstall`（electron-vite 的 getElectronPath 报错）—— electron `path.txt` 丢失。
2. 修了 path.txt 又变成 `dyld: Library not loaded: @rpath/Electron Framework.framework` —— `node_modules/electron/dist` **残缺**（只剩 316K 的 launcher，Frameworks 全没了）。
3. electron 起来后，点「打开终端」无反应；CDP 里测 `window.api.pty.create({})` 报 **`posix_spawnp failed`** —— node-pty 的 `spawn-helper` 丢了可执行位。

## 根因：npm 的 allow-scripts 拦截了原生包的安装脚本

`npm install` 时会打印 `npm warn allow-scripts ... not yet covered by allowScripts`，被拦的关键脚本：
- **electron@37** 的 `postinstall: node install.js`（下载/解压完整 dist）→ 不跑 → dist 残缺、path.txt 不写。
- **node-pty@1.1.0** 的 `install`/`postinstall`（含 `chmod +x spawn-helper`）→ 不跑 → `prebuilds/darwin-arm64/spawn-helper` 停在 `-rw-r--r--`（缺 x 位）→ macOS fork pty 时 `posix_spawnp failed`。
- 项目根 `postinstall: electron-rebuild -f -w node-pty` 同样被拦。

## 修复步骤（手动跑，不受 allow-scripts 限制）

```bash
# ① electron dist —— 从缓存 zip 手动完整解压（缓存里通常有完整 105M zip）
ls ~/Library/Caches/electron/*/electron-v37.10.3-darwin-arm64.zip   # 找到完整 zip
rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
unzip -q <那个zip> -d node_modules/electron/dist
printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt   # 36 字节，无换行
node -e "console.log(require('electron'))"   # 应打印存在的二进制路径

# ② node-pty spawn-helper —— 只需补可执行位（1.1.0 是 N-API prebuilds，ABI 稳定，不需 electron-rebuild！）
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
# 验证：CDP 里 window.api.pty.create({}) 应返回 {id:'x'}，不再 posix_spawnp failed
```

- `electron install.js` 手动跑也没用（它 exit 0 却不解压、不写 path.txt），**直接解压缓存 zip 最可靠**。
- node-pty 找 spawn-helper 的路径：`unixTerminal.js` 里 `native.dir + '/spawn-helper'`，`native.dir` 因无 build/Release 回退到 `prebuilds/darwin-arm64`。它的 `post-install.js` 只 chmod `build/Release`（不存在），所以即便跑了也修不到 prebuilds —— 必须手动 chmod prebuilds 那个。

## 教训

- **能不 `npm install` 就别在这台机器 install**。非装不可（如新增依赖）：装完立刻按上面①②自检修复，再 `npm run dev`。
- 眼验 Electron UI 用 CDP 法（见 [[CDP眼验法-破解多实例抢焦点]]），本次靠它定位到 `posix_spawnp failed` 才找到 node-pty 根因。
- 遗留：`@xterm/addon-webgl` 依赖已不再使用（终端改用 CanvasAddon），但**没删** package.json 里那行 —— 删它要再跑 `npm install` 会重演此坑，留着无害（不 import 就不打包）。要清理时连同上面的自检一起做。
