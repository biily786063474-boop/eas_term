// electron-builder afterPack 钩子：对打包好的 .app 做正确的 ad-hoc 重签。
// 背景：mac.identity=null 会让 electron-builder「跳过签名」，但它已改动 bundle
// （改名 / 塞 app.asar / extraResources 模型），导致 bundle 封签残缺（adhoc,linker-signed）。
// 平时能跑，一旦访问 TCC 保护资源（麦克风），macOS 校验签名失败 → 直接杀进程 → 级联崩溃。
// 这里在打包成 dmg/zip 之前，用 codesign --deep 把整个 bundle（含所有 Helper）重新封签，
// 并附上麦克风/相机 entitlements，彻底修复「用麦克风就崩」。
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  // 配了正式 Developer ID 之后就别再 ad-hoc 重签了：electron-builder 会在 afterPack
  // **之后**用真证书完整签一遍（含所有 Helper + entitlements），这里再插一手纯属多余，
  // 还会拖慢构建。只有 identity:null（本地快速打包）时才需要这套兜底。
  const identity = context.packager.platformSpecificBuildOptions.identity
  if (identity) {
    console.log('[afterPack] 已配置正式签名(' + identity + ')，跳过 ad-hoc 重签')
    return
  }
  const appName = context.packager.appInfo.productFilename // "Eas-Term"
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
