import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // 两份 preload：主窗口是全量 api，island 只有三个方法（权限最小化，见 preload/island.ts）
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          island: resolve(__dirname, 'src/preload/island.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
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
