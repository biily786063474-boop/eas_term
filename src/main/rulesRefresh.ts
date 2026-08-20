// 启动时把**已经装了的**规则更新到当前版本要不要写、写哪几个。
//
// 背景：`skills/eas-term/*.md` 打包在 app 里（extraResources），装了新版 app 之后
// **app 内的源是新的，但用户机器上那份分发产物还是旧的** —— `syncRules()` 只由
// 「扩展能力」面板的按钮触发，不在启动流程里。于是用户升级完，agent 读到的仍是上一版
// 的规则，而这件事没有任何提示。2026-08-19 就撞上了：generate.md 补了三条关键缺口，
// 分发出去的那份还是没有它们的旧版。
//
// **只更新、不安装。** 这条不能弄反 —— 用户卸载过「使用指引」，下次启动自己装回来
// 就是不听话（MCP 那条刚因为同样的问题改过，见 mcpOptOut.ts）。
// 判据是「目标目录现在有没有东西」：有 = 他装着，内容过期就该跟上；没有 = 他不要。
//
// 纯函数、不引 electron/fs，node --test 直接跑。

export interface SkillFile {
  name: string
  text: string
}

/**
 * @param src     app 里带的当前版本
 * @param onDisk  目标目录里现在有什么。**null 表示整个目录不存在**（＝没装）；
 *                空对象表示目录在、但里面没有 .md（那也算装着，只是被清空了，该补齐）
 * @returns 需要写的文件名。空数组 = 什么都不用做
 */
export function planRefresh(
  src: readonly SkillFile[],
  onDisk: Record<string, string> | null
): string[] {
  // 没装 → 一个字都不写
  if (onDisk === null) return []
  // 内容一致的不写：避免每次启动都动 mtime，也让「这次真的更新了什么」看得出来
  return src.filter((f) => onDisk[f.name] !== f.text).map((f) => f.name)
}
