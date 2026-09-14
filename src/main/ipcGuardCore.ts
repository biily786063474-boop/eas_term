// ipcGuard 的纯判定部分（零 electron，可测）：主 frame 且归属某个窗口才算工作台发来的。
export type GuardEvent = { senderFrame: unknown; sender: { mainFrame: unknown } }
export function isWorkbenchSender<W>(event: GuardEvent, fromWebContents: (wc: W) => unknown): boolean {
  if (event.senderFrame !== event.sender.mainFrame) return false
  return !!fromWebContents(event.sender as unknown as W)
}
