/** Missing optional project directories are empty states, not permission failures. */
export function skillDirectoryNotice(error: string | undefined, project: boolean): { empty: boolean; title: string; description: string } {
  const empty = error === '这个目录不存在'
  return {
    empty,
    title: empty ? (project ? '这个项目还没有专属技能' : '技能目录尚未建立') : '暂时无法读取技能',
    description: empty ? (project ? '全局技能仍可使用；添加项目技能后会显示在这里。' : '添加技能或选择已有目录后，技能会显示在这里。') : error || '读取失败，请刷新后重试。'
  }
}
