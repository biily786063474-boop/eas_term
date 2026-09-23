/** 每行统一字距；末行保持自然字距，不让孤立词条被撑散。 */
export function rowLetterSpacing(
  rows: { width: number; chars: number }[][],
  availableWidth: number,
  gap: number
): number[] {
  return rows.map((row, index) => {
    if (index === rows.length - 1 || row.length < 2) return 0
    const used = row.reduce((sum, pill) => sum + pill.width, 0) + gap * (row.length - 1)
    const chars = row.reduce((sum, pill) => sum + pill.chars, 0)
    return chars > 0 ? Math.max(0, availableWidth - used) / chars : 0
  })
}
