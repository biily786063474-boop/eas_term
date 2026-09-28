/** New chat nodes only: width stays 768; height grows another 20% from 456 to 547.
 * Screen margins stay fixed; frame chrome is reserved in world units after zoom conversion.
 * Do not apply to restored nodes, manual resize, split panes, or font sizes.
 */
export function agentNodeSize(viewWidth: number, viewHeight: number, zoom: number): {w:number;h:number} {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const cap = (value:number, margin:number, fallback:number):number =>
    Number.isFinite(value) && value > margin ? Math.min(fallback, Math.floor((value-32)/scale-margin)) : fallback
  return {w:Math.max(1,cap(viewWidth,32,768)),h:Math.max(1,cap(viewHeight,100,547))}
}
