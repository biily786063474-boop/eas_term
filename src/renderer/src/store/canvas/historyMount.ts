/** A history can have only one writable canvas mount. No copy/delete migration. */
export function canMountHistory(frames: {id:string; nodes:{id:string; chatId?:string}[]}[], frameId:string, nodeId:string, chatId:string): boolean {
  if (!/^[a-zA-Z0-9_-]+$/.test(chatId)) return false
  if (!frames.find(f => f.id === frameId)?.nodes.some(n => n.id === nodeId)) return false
  return !frames.some(f => f.nodes.some(n => (f.id !== frameId || n.id !== nodeId) && (n.chatId ?? n.id) === chatId))
}
