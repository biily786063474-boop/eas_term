export interface TrendPoint { x: number; y: number }

/** Gentle monotone cubic interpolation. Keep real points and never bridge missing data.
 * Control points stay within each segment's y range, so smoothing cannot invent peaks. */
export function smoothTrendPath(points: readonly (TrendPoint | null)[]): string {
  const segments: TrendPoint[][] = []
  let segment: TrendPoint[] = []
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (segment.length) segments.push(segment)
      segment = []
    } else {
      if (segment.length && point.x <= segment[segment.length - 1].x) {
        segments.push(segment)
        segment = []
      }
      segment.push(point)
    }
  }
  if (segment.length) segments.push(segment)
  const f = (n: number): string => String(Number(n.toFixed(3)))
  return segments.map((ps) => {
    const slopes = ps.slice(1).map((p, i) => (p.y - ps[i].y) / (p.x - ps[i].x))
    const tangents = ps.map((_, i) => {
      if (i === 0) return slopes[0] ?? 0
      if (i === ps.length - 1) return slopes[i - 1]
      const a = slopes[i - 1], b = slopes[i]
      return a * b > 0 ? 2 * a * b / (a + b) : 0
    })
    let d = `M ${f(ps[0].x)} ${f(ps[0].y)}`
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1], b = ps[i], dx = (b.x - a.x) / 3
      const clamp = (v: number): number => Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), v))
      d += ` C ${f(a.x + dx)} ${f(clamp(a.y + tangents[i - 1] * dx))} ${f(b.x - dx)} ${f(clamp(b.y - tangents[i] * dx))} ${f(b.x)} ${f(b.y)}`
    }
    return d
  }).join(' ')
}
