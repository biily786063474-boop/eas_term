// electron-builder afterPack 钩子：对打包好的 .app 做正确的 ad-hoc 重签。
// 背景：mac.identity=null 会让 electron-builder「跳过签名」，但它已改动 bundle
// （改名 / 塞 app.asar / extraResources 模型），导致 bundle 封签残缺（adhoc,linker-signed）。
// 平时能跑，一旦访问 TCC 保护资源（麦克风），macOS 校验签名失败 → 直接杀进程 → 级联崩溃。
// 这里在打包成 dmg/zip 之前，用 codesign --deep 把整个 bundle（含所有 Helper）重新封签，
// 并附上麦克风/相机 entitlements，彻底修复「用麦克风就崩」。
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  // node-pty 的 spawn-helper 必须可执行，否则开终端 posix_spawnp 失败（EACCES）——
  // 表现为「app 能起、界面正常，但终端一开就报错」，只有真机开终端才暴露。
  // 历史坑：某些 worktree 里被手动 @electron/rebuild 剥掉过执行位（源码 -rw-r--r--，
  // 主 checkout 是 -rwxr-xr-x），electron-builder 会如实照抄权限，于是包里 helper 不可执行。
  // asarUnpack 只解 prebuilds（build/ 被 !排除），所以只需保证 prebuilds 下的 helper 可执行。
  // 放在签名之前：随后的正式签名会把这个已置执行位的 helper 一并签进去。
  const appName = context.packager.appInfo.productFilename
  const prebuilds = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources',
    'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds')
  try {
    for (const d of fs.readdirSync(prebuilds)) {
      const helper = path.join(prebuilds, d, 'spawn-helper')
      if (fs.existsSync(helper)) { fs.chmodSync(helper, 0o755); console.log('[afterPack] chmod +x', path.relative(context.appOutDir, helper)) }
    }
  } catch (e) { console.warn('[afterPack] node-pty spawn-helper 补执行位跳过:', e.message) }

  // 配了正式 Developer ID 之后就别再 ad-hoc 重签了：electron-builder 会在 afterPack
  // **之后**用真证书完整签一遍（含所有 Helper + entitlements），这里再插一手纯属多余，
  // 还会拖慢构建。只有 identity:null（本地快速打包）时才需要这套兜底。
  const identity = context.packager.platformSpecificBuildOptions.identity
  if (identity) {
    console.log('[afterPack] 已配置正式签名(' + identity + ')，跳过 ad-hoc 重签')
    return
  }
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const entitlements = path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist')
  console.log('[afterPack] ad-hoc 重签（带麦克风 entitlements）:', appPath)
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, '--timestamp=none', appPath],
    { stdio: 'inherit' }
  )
  // 校验：签名必须有效，否则宁可让打包失败也别产出「一用麦克风就崩」的包
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log('[afterPack] 重签完成且校验通过')
}
