/** 每个产物节点独立持有，重复提交合并成一次刷新。 */
export function createArtifactRefreshGate(refresh: () => void) {
  let dirty = false
  let editing = false
  let pending = false
  const flush = (): void => {
    if (!dirty && !editing && pending) { pending = false; refresh() }
  }
  return {
    setDirty(value: boolean): void { dirty = value; flush() },
    setEditing(value: boolean): void { editing = value; flush() },
    request(): void { pending = true; flush() }
  }
}
