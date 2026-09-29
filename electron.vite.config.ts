import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import type { Plugin } from 'vite'

/** 第三方许可清单（2026-09-29）：记下每个构建里**被打进产物**的 npm 包。
 *
 *  拆正式版 app.asar 核过：`dependencies` 里的包原样进 node_modules、许可文件都在；
 *  但被打进 JS 的（渲染层的 React / xterm.js / zustand…，main/preload 里的开发依赖）许可注释
 *  会被压缩删掉（下面 SAFE_MINIFY 为脱敏特意 `legalComments: 'none'`，不能为此放开），包里就再找不到它们的声明。
 *  这里只记名单（写 out/.third-party/<目标>.json），`scripts/gen-third-party-notices.mjs` 构建后合并出完整清单。 */
function recordBundledPackages(target: string): Plugin {
  return {
    name: 'eas-record-bundled-packages',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const dirs = new Set<string>()
      for (const f of Object.values(bundle)) {
        if (f.type !== 'chunk') continue
        for (const id of Object.keys(f.modules)) {
          const p = id.replace(/\\/g, '/').replace(/^\0/, '').split('?')[0]
          const i = p.lastIndexOf('/node_modules/')
          if (i < 0) continue
          const rest = p.slice(i + '/node_modules/'.length).split('/')
          const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
          dirs.add(p.slice(0, i + '/node_modules/'.length) + name)
        }
      }
      const out = resolve(__dirname, 'out/.third-party')
      mkdirSync(out, { recursive: true })
      writeFileSync(resolve(out, `${target}.json`), JSON.stringify([...dirs].sort(), null, 1))
    }
  }
}


/** 分发包要脱敏：**main 与 preload 的注释一个字都不许进产物。**
 *
 *  用户 2026-09-02：「分发包记得要脱敏。」当场核过 0.4.75 的构建产物 ——
 *  渲染层是干净的（vite 生产构建默认压缩），但 **main 与 preload 原样保留注释**：
 *
 *      out/main/index.js:2450:  // 用户 2026-09-02：「名字不要说 OMP…」
 *
 *  里面没有密钥、也没有真实用户路径（都核过），但用户原话、内部推理、
 *  历次事故的来龙去脉全在。这些是写给维护者的，不该跟着安装包发给每一个人。
 *
 *  **只去空白与注释，不动标识符与语法**（`minifyIdentifiers` / `minifySyntax` 皆 false，
 *  外加 `keepNames`）：混淆了名字，用户报回来的崩溃栈就成了一串 `a.b.c`，
 *  而 main 进程的栈是我们排障唯一的线索。脱敏不该以「出了事查不了」为代价。 */
const SAFE_MINIFY = {
  minifyWhitespace: true, // ← 去注释靠的是这一项
  minifyIdentifiers: false, // 名字留着，崩溃栈才看得懂
  minifySyntax: false,
  keepNames: true,
  legalComments: 'none' as const
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), recordBundledPackages('main')],
    build: { minify: 'esbuild' },
    esbuild: SAFE_MINIFY
  },
  preload: {
    plugins: [externalizeDepsPlugin(), recordBundledPackages('preload')],
    esbuild: SAFE_MINIFY,
    // 两份 preload：主窗口是全量 api，island 只有三个方法（权限最小化，见 preload/island.ts）
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          island: resolve(__dirname, 'src/preload/island.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react(), recordBundledPackages('renderer')],
    // 两个页面入口：主界面 index.html + 灵动岛 island.html。
    // 显式列出后不再走单入口默认值；dev 下两个页面由同一个 dev server 服务，
    // 灵动岛取 ${ELECTRON_RENDERER_URL}/island.html。
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          island: resolve(__dirname, 'src/renderer/island.html')
        }
      }
    }
  }
})
