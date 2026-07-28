// electron-builder afterSign 钩子：把签好的 .app 提交 Apple 公证并 staple。
//
// 不公证的话，别人从网上下载会弹「已损坏，无法打开」——注意是「已损坏」不是
// 「无法验证开发者」，用户看到这四个字多半直接扔垃圾桶。只签名不公证治不了这个。
//
// 凭据走**钥匙串档案**，App 专用密码不出现在任何命令行/环境变量/代码里。
// 一次性设置（在你自己的终端里跑，密码交互式输入）：
//   1. appleid.apple.com → 登录与安全 → App 专用密码 → 生成一个
//   2. xcrun notarytool store-credentials "eas-notary" \
//        --apple-id "<你的 Apple ID 邮箱>" --team-id "D4FVS6QJXV"
//      （提示 Enter password 时粘贴上一步生成的密码）
//
// 之后打包加 EAS_NOTARIZE=1 才会公证（不加则只签名不公证，本地快速验证用）：
//   EAS_NOTARIZE=1 npm run dist
const path = require('path')

exports.default = async function notarizeHook(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (!process.env.EAS_NOTARIZE) {
    console.log('[notarize] 跳过（未设 EAS_NOTARIZE=1）——这个包别人下载会被 Gatekeeper 拦')
    return
  }
  if (/-temp$/.test(context.appOutDir)) return // universal 合并前的临时架构目录不公证
  const { notarize } = require('@electron/notarize')
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const keychainProfile = process.env.EAS_NOTARY_PROFILE || 'eas-notary'
  // 默认**不传** keychain 路径。新版 notarytool 的 store-credentials 把凭证存进
  // data protection keychain，不是文件式的 login.keychain-db——显式传路径反而查不到
  // （实测：`notarytool history --keychain-profile eas-notary` 能用，
  //  加上 `--keychain ~/Library/Keychains/login.keychain-db` 就报
  //  No Keychain password item found）。真遇到查找不到再用 EAS_KEYCHAIN 显式指定。
  const keychain = process.env.EAS_KEYCHAIN
  console.log(`[notarize] 提交公证：${appPath}（档案「${keychainProfile}」）…上传 Apple，通常几分钟`)
  await notarize({ tool: 'notarytool', appPath, keychainProfile, ...(keychain ? { keychain } : {}) })
  console.log('[notarize] ✓ 公证 + staple 完成')
}
