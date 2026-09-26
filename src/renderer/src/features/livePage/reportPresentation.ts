import type { ReportAssociation } from './reportAssociation'

export function hasDualPresentation(page: { leafId: string; visible: boolean; popout: boolean } | undefined, report: ReportAssociation | undefined): boolean {
  return !!page && page.visible && !page.popout && !!report && page.leafId === report.leafId
}
