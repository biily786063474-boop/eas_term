// canvasSel 里一条选中项 → 它所在的 Frame。纯函数、零 import（node --test 能直接跑，
// 和 mediaExts.ts / skillSections.ts 同一条规矩：值 import 会把 electron 拖进来）。
//
// key 的编码（构造点在 CanvasStage.tsx）：
//   f:<frameId>            Frame 本身
//   n:<frameId>:<nodeId>   Frame 内的节点 —— **frameId 就在 key 里，不用回场景里查**
//   p:<nodeId>             自由节点：世界坐标，不属于任何 Frame
//   s:<shapeId>            图形/便签：同上
//
// 「选中的东西在哪个 Frame 里」以前是就地写在两个地方（canvasSlice 的 followSel、
// skill 面板的 selectedProjectId），且两处都只认 `f:`——选中 Frame 里的一个终端
// 就当成「什么都没选」。两处合并到这里，免得再长出第三套判据。

/** 选中项所在的 Frame id；不在任何 Frame 里（自由节点/图形）或 key 不认识时返回 null。 */
export function frameIdOfSelKey(key: string): string | null {
  if (typeof key !== 'string') return null
  if (key.startsWith('f:')) return key.slice(2) || null
  if (key.startsWith('n:')) {
    // 只切第一个冒号：nodeId 里有没有冒号都不影响前面那段
    const rest = key.slice(2)
    const i = rest.indexOf(':')
    return (i < 0 ? rest : rest.slice(0, i)) || null
  }
  return null // p: / s: 本来就不在 Frame 里
}

/**
 * 一组选中项 → 唯一的 Frame id。**只认「选中的东西全都在同一个 Frame 里」**：
 * 空选、跨 Frame 多选、以及选中了 Frame 外的东西（自由节点/图形），都返回 null。
 *
 * 为什么允许多选而不是只认单选：框选一个 Frame 里的三个终端，人眼看就是「在这个项目里」，
 * 没有理由因为选了三个而不是一个就当成没选。跨 Frame 才是真的说不清该算哪个项目。
 */
export function soleFrameIdOfSel(keys: readonly string[]): string | null {
  if (!Array.isArray(keys) || keys.length === 0) return null
  let found: string | null = null
  for (const k of keys) {
    const fid = frameIdOfSelKey(k)
    if (!fid) return null // 选中了 Frame 外的东西 → 说不清是哪个项目
    if (found === null) found = fid
    else if (found !== fid) return null // 跨 Frame
  }
  return found
}
