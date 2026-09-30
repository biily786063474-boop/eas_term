// 首次决定界面语言（2026-09-29 英文适配上线时定的规矩）：
//
// - **老用户升级上来 → 中文。** 英文适配之前的版本都是中文界面；不少中文用户的系统语言是英文
//   （开发者尤其多），「跟随系统」会让他们一升级界面和 AI 回答突然全变英文。
// - **全新安装 → 跟随系统。**
//
// 「是不是老用户」不看 prefs.json 在不在 —— 没改过任何开关的人根本没有这个文件。
// 看应用自己写的数据文件：用过就一定有项目列表或画布存档。
// 决定只做一次，当场写进 prefs.json：以后新用户也会有这些文件，不写下来的话下次启动会被误判成老用户。
import fs from 'fs'
import path from 'path'
import type { LangPref } from '../shared/i18n/index.ts'

/** 用过英文适配之前版本的痕迹 */
export const LEGACY_MARKERS = ['projects.json', 'canvas.json'] as const

export function decideInitialLang(userData: string, exists: (p: string) => boolean = fs.existsSync): LangPref {
  return LEGACY_MARKERS.some((f) => exists(path.join(userData, f))) ? 'zh' : 'system'
}
