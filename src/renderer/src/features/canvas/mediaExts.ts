// 「这个路径是哪类媒体」——**纯扩展名判定，零 import**。
//
// 单独一个文件是为了能测（同 tidyOrder.ts / viewModeRestore.ts 立的规矩）：
// media.ts 引到 store/shared，那条链一路牵出 electron，`node --test` 加载不了。
// 而扩展名清单恰恰是最该被锁住的东西——漏一个格式的表现是「我的 .flac 在
// 筛选里凭空消失」，不报错、不崩，只有人肉逐个试才发现。

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
export const VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'])
/** 音频。**画布上还没有音频节点** —— 这份清单目前只服务「插入文件」选择器的
 *  「仅多媒体」筛选（找素材时音频跟图片视频是同一类东西）。
 *  将来真做音频节点，播放能力另说，这份清单可以直接复用。 */
export const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff'])

const ext = (p: string): string => p.split('.').pop()?.toLowerCase() ?? ''

export const isImagePath = (p: string): boolean => IMAGE_EXTS.has(ext(p))
export const isVideoPath = (p: string): boolean => VIDEO_EXTS.has(ext(p))
export const isAudioPath = (p: string): boolean => AUDIO_EXTS.has(ext(p))
/** 图片 / 视频 / 音频三者之一 */
export const isMediaPath = (p: string): boolean =>
  isImagePath(p) || isVideoPath(p) || isAudioPath(p)
