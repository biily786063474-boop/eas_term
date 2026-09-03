// 当前进程的 `HostPaths`。**只有这一件事**，因为它是 omp 这一层唯一需要 electron 的东西。
//
// ── 为什么单独一个文件 ──────────────────────────────────────────────────────
// 它原来在 `launch.ts` 里，而 `app` 在那个 338 行的文件里**只出现在这 5 行**。
// 为这 5 行，整个 launch.ts 背着 `import { app } from 'electron'`，
// 同时 `quotaStore.ts` 又要从 launch.ts 拿它 —— 于是长出
// `launch → mcpBridge → quotaStore → launch` 这个循环依赖（2026-09-03 代码地图查出来的）。
//
// 挪出来之后：launch.ts 零 electron、可以在 `node --test` 下裸跑；
// quotaStore 只依赖这个 6 行的文件，环断了。

import { app } from 'electron'
import type { HostPaths } from '../../../shared/agentChat.ts'

/** 当前进程的 `HostPaths`。**算一次就够**，不要在每个调用点各取一次
 *  —— `process.resourcesPath` 在 dev 下是 undefined，各处各自兜底会长出好几种写法。 */
export function hostPaths(): HostPaths {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath ?? '',
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
    home: app.getPath('home')
  }
}
