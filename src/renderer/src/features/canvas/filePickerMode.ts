// 插件入口不覆盖文件视图偏好。
const KEY = 'eas.canvasFilePickerMode'
export function readFilePickerMode(storage: Pick<Storage, 'getItem'>): 'tree' | 'recent' {
  try { return storage.getItem(KEY) === 'recent' ? 'recent' : 'tree' }
  catch { return 'tree' }
}
export function saveFilePickerMode(storage: Pick<Storage, 'setItem'>, mode: string): void {
  if (mode !== 'tree' && mode !== 'recent') return
  try { storage.setItem(KEY, mode) } catch { /* 不影响本次切换 */ }
}
