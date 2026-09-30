import { t } from '../../i18n.ts'

/** Missing optional project directories are empty states, not permission failures. */
export function skillDirectoryNotice(error: string | undefined, project: boolean): { empty: boolean; title: string; description: string } {
  // 「这个目录不存在」是主进程回的错误原文，按原文比对，不翻
  const empty = error === '这个目录不存在' // i18n-allow: 匹配主进程回的错误原文
  return {
    empty,
    title: empty ? (project ? t('panels.skill.noticeProjectEmptyTitle') : t('panels.skill.noticeDirEmptyTitle')) : t('panels.skill.noticeReadFailTitle'),
    description: empty ? (project ? t('panels.skill.noticeProjectEmptyDesc') : t('panels.skill.noticeDirEmptyDesc')) : error || t('panels.skill.noticeReadFailDesc')
  }
}
