# 手动装包：绕开 `npm install` 破坏 electron/node-pty

> 2026-08-17。恢复设计模块的钢笔 / 布尔运算 / 文字轮廓化时用的办法。
> 前置背景见 [[npm-install-会破坏electron和nodepty原生模块]] —— 那份讲的是**坏了怎么修**，
> 这份讲的是**怎么一开始就不坏**。

## 为什么可行

坏 electron/node-pty 的根因是 `npm install` 会跑（并被 allow-scripts 拦掉）
各个包的 lifecycle scripts。**手动解压 tarball 完全不触发 lifecycle**，
所以 electron 的 dist 和 node-pty 的 spawn-helper 一个字节都不会动。

前提：要装的包本身是**纯 JS、无原生模块、没有 postinstall**。
装之前用 `npm view <pkg> scripts` 确认。

## 步骤

```bash
# ① 先记基线，装完要逐项比对
ls -la node_modules/electron/path.txt        # 应为 36 字节
du -sh node_modules/electron/dist            # 应为 265M
ls -l node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper   # 应有 x 位

# ② 查全依赖树 —— npm pack 只下单个包，传递依赖要自己一层层查到叶子
npm view <pkg> dependencies

# ③ 下 tarball（放 scratchpad，别落项目里）
npm pack <pkg>@<版本>

# ④ 解压（--strip-components=1 去掉 tarball 里的 package/ 那层）
rm -rf node_modules/<pkg> && mkdir -p node_modules/<pkg>
tar -xzf <pkg>-<版本>.tgz -C node_modules/<pkg> --strip-components=1

# ⑤ 自检：三项与基线一致 + 新包能 require
node -e "console.log(require('electron'))"
node -e "require('<pkg>')"

# ⑥ 往 package.json 的 dependencies 手写依赖行（**只写直接依赖**，
#    传递依赖不写 —— 写了反而与 npm 的解析结果不符）
```

## 这次装了什么

直接依赖（已写进 package.json）：`svgpath@2.6.0`、`polygon-clipping@0.15.7`、`imagetracerjs@1.2.6`
传递依赖（polygon-clipping 要的，只解压未登记）：`robust-predicates@3.0.3`、`splaytree@3.2.3`

## 坑

- **`package-lock.json` 不会同步。** 单人项目无所谓，但要记得：谁哪天跑了
  `npm install` 或 `npm ci`，这些包会被按 lock 重装（大概率没问题，因为
  package.json 里已经登记了直接依赖），**同时 electron/node-pty 会照旧被搞坏** ——
  那时按 [[npm-install-会破坏electron和nodepty原生模块]] 修。
- zsh 里带空格的项目路径 + `set -- $spec` 分词会让 `tar` 报
  `Error reading fd 3`。用函数传参，别用 `set --`。
