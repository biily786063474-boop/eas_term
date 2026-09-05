// 甘特图里程碑模式的**判断层**：一批 git 提交 → 该画在时间轴上的菱形。
//
// **纯函数，`node --test` 直接跑。** 抽出来的理由：秒/毫秒、时间窗边界、tag 解析
// 这几处错了不会崩，只会表现成「菱形全跑到轴外」「tag 认不出来」，肉眼很难核对。
//
// ── 为什么里程碑是 commit 而不是对话（用户 2026-09-05）────────────────────
// 原来每次发送/返回各插一枚菱形，但回复内容从来没存过，那些菱形只有时间点没有
// 意义。commit 天然就是「功能落地」的时间点，还自带一句话说明。
// **版本号不是每个项目都有**：默认按纯 commit 画，refs 里有 `tag:` 的才大一号——
// 没有 tag 的项目一样成立，只是没有加粗的那几枚。

import type { GitCommit } from '../../../../shared/types'

export interface CommitMark {
  hash: string
  /** 毫秒（GitCommit.at 是 unix 秒，这里已换算——甘特图全程用毫秒） */
  at: number
  subject: string
  author: string
  files: number
  /** 从 refs 解析出的 tag 名（去掉 `tag: ` 前缀），没有就是空数组 */
  tags: string[]
  /** 有 tag = 版本点，画大一号 */
  isVersion: boolean
}

/** `%D` 形如 "HEAD -> main, origin/main, tag: v0.4.78, tag: latest"。只取 tag。 */
export function tagsOfRefs(refs: string): string[] {
  if (!refs) return []
  return refs
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('tag: '))
    .map((s) => s.slice('tag: '.length).trim())
    .filter(Boolean)
}

/** 时间窗 [t0, t1]（毫秒）内的提交，按时间升序。窗外的一律不要。 */
export function commitMarks(commits: readonly GitCommit[], t0: number, t1: number): CommitMark[] {
  const out: CommitMark[] = []
  for (const c of commits) {
    const at = c.at * 1000
    if (!Number.isFinite(at) || at < t0 || at > t1) continue
    const tags = tagsOfRefs(c.refs)
    out.push({
      hash: c.hash,
      at,
      subject: c.subject,
      author: c.author,
      files: c.files,
      tags,
      isVersion: tags.length > 0
    })
  }
  return out.sort((a, b) => a.at - b.at)
}
