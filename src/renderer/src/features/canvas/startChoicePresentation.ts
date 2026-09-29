import { t } from '../../i18n.ts'
/** 空 Frame 入口的用户文案，不改 CLI 的内部身份和其他界面名称。 */
export function startChoicePresentation(
  cli: { id: string; displayName: string }
): { name: string; tip: string } {
  if (cli.id === 'omp') {
    return { name: t('canvas.start.ompName'), tip: t('canvas.start.ompTip') }
  }
  if (cli.id === 'claude' || cli.id === 'codex') {
    return { name: cli.displayName, tip: t('canvas.start.officialTip') }
  }
  return { name: cli.displayName, tip: t('canvas.start.genericTip', { name: cli.displayName }) }
}
