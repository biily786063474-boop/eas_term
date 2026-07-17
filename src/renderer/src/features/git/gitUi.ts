// Git 状态字母 → 徽章文案与配色 class（侧栏「版本」与历史大视图共用）

export function statusInfo(letter: string): { label: string; cls: string } {
  switch (letter) {
    case 'A':
    case '?':
      return { label: letter === '?' ? 'U' : 'A', cls: 'add' }
    case 'D':
      return { label: 'D', cls: 'del' }
    case 'U':
    case '!':
      return { label: 'U', cls: 'conflict' }
    case 'R':
    case 'C':
      return { label: letter, cls: 'mod' }
    default:
      return { label: 'M', cls: 'mod' }
  }
}
