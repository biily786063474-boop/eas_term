import { app } from 'electron'
import fs from 'fs'
import path from 'path'

let secretShimCache: string | null = null
export function ensureSecretShim(): string | null {
  if (secretShimCache) return secretShimCache
  try {
    const dir = path.join(app.getPath('userData'), 'bin')
    fs.mkdirSync(dir, { recursive: true })
    const js = app.isPackaged
      ? path.join(process.resourcesPath, 'mcp', 'eas-secret.mjs')
      : path.join(app.getAppPath(), 'mcp', 'eas-secret.mjs')
    if (process.platform === 'win32') {
      // Windows 侧：.cmd 才会被 PATH 查找命中。
      // setlocal 是必需的 —— 没有它，ELECTRON_RUN_AS_NODE=1 会**永久留在用户这个 cmd 会话里**，
      // 之后他手敲的任何 electron 命令都会变成一个裸 node，且毫无线索。
      // 路径走 %~dp0 之外的绝对路径，所以文件本身不能有 BOM 问题：
      // 只写 ASCII（路径可能含中文 → 用 chcp 65001 + UTF-8 落盘保证 cmd.exe 读得对）。
      fs.writeFileSync(
        path.join(dir, 'eas-secret.cmd'),
        '@echo off\r\n' +
          'setlocal\r\n' +
          'chcp 65001 >nul\r\n' +
          'set "ELECTRON_RUN_AS_NODE=1"\r\n' +
          `"${process.execPath}" "${js}" %*\r\n` +
          'endlocal & exit /b %errorlevel%\r\n',
        'utf8'
      )
    } else {
      const shim = path.join(dir, 'eas-secret')
      // 路径每次重写：app 挪过位置（升级、拖进 /Applications）后旧路径就废了
      fs.writeFileSync(
        shim,
        `#!/bin/sh\n# Eas-Term 自动生成，勿手改\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${js}" "$@"\n`,
        { mode: 0o755 }
      )
      fs.chmodSync(shim, 0o755)
    }
    secretShimCache = dir
    return dir
  } catch (e) {
    console.error('[pty] 创建 eas-secret shim 失败(密钥只能靠新终端注入)', e)
    return null
  }
}

