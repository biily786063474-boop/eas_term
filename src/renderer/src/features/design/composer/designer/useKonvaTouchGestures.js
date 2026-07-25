// [Eas-Term 移植] 桩掉 taptv 专有的 iPad 触屏手势 hook(原 94 行,双指捏合/平移)。
// Eas-Term 桌面端不需要触屏手势,桩成 no-op:effect-only hook,无返回值被使用。
// 签名与原 hook 保持一致:(stageRef, getState, onChange, opts) —— 全部忽略。
export function useKonvaTouchGestures(_stageRef, _getState, _onChange, _opts) {
  // no-op
}
