import type { Candidate } from './composerCandidates.ts'

export type ReferenceKind = 'dict' | 'file' | 'folder' | 'skill' | 'plugin' | 'app' | 'browser' | 'image'
export interface ComposerReference {
  id: string
  kind: ReferenceKind
  label: string
  raw: string
  payload: string
  detail: string
  imagePath?: string
  imageUrl?: string
}
export const REFERENCE_LABELS: Record<ReferenceKind, string> = { dict: '辞典', file: '文件', folder: '文件夹', skill: '技能', plugin: '插件', app: '应用', browser: '网页', image: '图片' }
export const REFERENCE_GLYPHS: Record<ReferenceKind, string> = { dict: '▤', file: '▧', folder: '▱', skill: '✧', plugin: '◇', app: '▦', browser: '↗', image: '▣' }
export function referenceFromCandidate(c: Candidate): ComposerReference {
  return { id: c.id, kind: c.imagePath ? 'image' : c.category as ReferenceKind, label: c.name, raw: c.insert, payload: c.chip?.text.trim() ?? c.insert, detail: c.description, imagePath: c.imagePath }
}
/** Rendering only: the editor document and transport retain the original text. */
export function referenceRanges(text: string, references: readonly ComposerReference[]): { from: number; to: number; reference: ComposerReference }[] {
  const refs = [...references].filter(r => r.raw).sort((a, b) => b.raw.length - a.raw.length)
  const ranges: { from: number; to: number; reference: ComposerReference }[] = []
  for (let i = 0; i < text.length;) {
    const ref = refs.find(r => text.startsWith(r.raw, i)
      && (!r.raw.startsWith('@') || i === 0 || !/[\w\u4e00-\u9fa5]/.test(text[i - 1]))
      && (!['file', 'folder', 'image', 'browser'].includes(r.kind) || i + r.raw.length === text.length || /[\s,，。；;:：)）\]】!?！？]/.test(text[i + r.raw.length])))
    if (ref) { ranges.push({ from: i, to: i + ref.raw.length, reference: ref }); i += ref.raw.length }
    else i++
  }
  return ranges
}
