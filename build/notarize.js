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
  // 档案名按顺序试：环境变量指定的 → eas-notary → aurora-notary。
  //
  // 为什么要有回退：2026-08-09 发 0.4.16 时，钥匙串里的 `eas-notary` 档案没了
  // （几小时前发 0.4.15 还好好的，中间没人有意动过它），打包在 arm64 公证那步直接中止。
  // 排查发现钥匙串里只剩另一个项目的 `aurora-notary` —— 而它**是同一套凭证**：
  // 同一个 Apple ID、同一个 team D4FVS6QJXV，它的提交历史里最近两条就是当天凌晨的
  // Eas-Term.zip（Accepted）。两个名字指向同一个账号，换个名字接着用即可。
  //
  // 所以这里不再写死一个名字 —— 一个名字没了就整条发版路断掉，而重建凭证需要人
  // 交互式输 App 专用密码，自动化流程干不了。
  const profileCandidates = [process.env.EAS_NOTARY_PROFILE, 'eas-notary', 'aurora-notary'].filter(
    Boolean
  )
  const { execFileSync } = require('child_process')
  const usable = profileCandidates.find((p) => {
    try {
      // history 是只读查询，能跑通就说明这个档案的凭证还在且有效
      execFileSync('xcrun', ['notarytool', 'history', '--keychain-profile', p], {
        stdio: 'ignore',
        timeout: 60_000
      })
      return true
    } catch {
      return false
    }
  })
  if (!usable) {
    throw new Error(
      `公证凭证都不可用（试过：${profileCandidates.join(' / ')}）。\n` +
        `重建：xcrun notarytool store-credentials "eas-notary" ` +
        `--apple-id "<你的 Apple ID>" --team-id "D4FVS6QJXV"`
    )
  }
  if (usable !== profileCandidates[0]) {
    console.log(`[notarize] 档案「${profileCandidates[0]}」不可用，回退到「${usable}」`)
  }
  const keychainProfile = usable
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
