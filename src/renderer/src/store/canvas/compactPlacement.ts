/** New modules only: preserve existing positions, fill holes, then balance the occupied envelope. */
interface Box { x: number; y: number; w: number; h: number }
export function compactPlacement(others: readonly Box[], w: number, h: number,
  opts: { gap: number; startX: number; startY: number }): { x: number; y: number } {
 const { gap, startX, startY } = opts
 const right = Math.max(startX, ...others.map(b => b.x + b.w))
 const bottom = Math.max(startY, ...others.map(b => b.y + b.h))
 const xs = new Set([startX]); const ys = new Set([startY])
 for (const b of others) {
  xs.add(Math.max(startX,b.x)); xs.add(b.x+b.w+gap); xs.add(Math.max(startX,b.x-w-gap))
  ys.add(Math.max(startY,b.y)); ys.add(b.y+b.h+gap); ys.add(Math.max(startY,b.y-h-gap))
 }
 let best = { x: startX, y: bottom+gap }; let bestScore = [Infinity]
 for (const x of xs) for (const y of ys) {
  if (x < startX || y < startY || others.some(b => x < b.x+b.w+gap && x+w+gap > b.x && y < b.y+b.h+gap && y+h+gap > b.y)) continue
  const width = Math.max(right,x+w)-startX, height = Math.max(bottom,y+h)-startY
  // Existing holes win; expansion minimizes enclosing square, then area. Row-major ties.
  const score = [x+w<=right && y+h<=bottom ? 0 : 1, Math.max(width,height), width*height, y, x]
  const differing = score.findIndex((v,i) => v !== bestScore[i])
  if (differing >= 0 && (bestScore[differing] === undefined || score[differing] < bestScore[differing])) { best={x,y}; bestScore=score }
 }
 return best
}
