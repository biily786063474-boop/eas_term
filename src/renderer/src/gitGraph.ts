// Commit 轨道图（lane）布局算法 —— 侧栏 gutter 与主区域大图共用。
// 输入拓扑序的提交（父在子之后），为每行算出：节点所在 lane、行内上/下半段的连线。
// 连线坐标用 lane 索引 + 归一化 y（0=行顶, 0.5=节点, 1=行底），渲染时乘列宽/行高即可，
// 因此对可变行高天然适配（每行 SVG 撑满自身高度）。

import type { GitCommit } from '../../shared/types'

export interface GraphSegment {
  fromLane: number
  toLane: number
  fromY: number // 0 或 0.5
  toY: number // 0.5 或 1
  color: string
}

export interface GraphRow {
  commit: GitCommit
  lane: number
  color: string
  laneCount: number
  segments: GraphSegment[]
}

// lane 配色（按列索引循环），与设计中性偏冷的基调一致
const PALETTE = [
  '#a2b9e0',
  '#6cc98c',
  '#e0af68',
  '#f78bb0',
  '#8bd5e0',
  '#c9a0e0',
  '#e0896f',
  '#9ccf7a'
]
export const laneColor = (l: number): string => PALETTE[((l % PALETTE.length) + PALETTE.length) % PALETTE.length]

function firstFree(lanes: (string | null)[]): number {
  const i = lanes.indexOf(null)
  return i === -1 ? lanes.length : i
}

export function computeGraphRows(commits: GitCommit[]): GraphRow[] {
  const rows: GraphRow[] = []
  let lanes: (string | null)[] = [] // 每列当前"向下延伸、等待被画出的提交 hash"

  for (const commit of commits) {
    const incoming = lanes.slice()

    // 指向该提交的所有子所在 lane（incoming 中等于本 hash 的列）
    const childLanes: number[] = []
    for (let j = 0; j < incoming.length; j++) if (incoming[j] === commit.hash) childLanes.push(j)
    const myLane = childLanes.length ? Math.min(...childLanes) : firstFree(incoming)

    const outgoing = incoming.slice()
    while (outgoing.length <= myLane) outgoing.push(null)
    for (const j of childLanes) outgoing[j] = null // 子在此汇入节点

    const branchOut = new Set<number>()
    if (commit.parents.length > 0) {
      outgoing[myLane] = commit.parents[0] // 第一个父接替本 lane
      branchOut.add(myLane)
      for (let k = 1; k < commit.parents.length; k++) {
        let pl = outgoing.indexOf(commit.parents[k])
        if (pl === -1) pl = firstFree(outgoing)
        while (outgoing.length <= pl) outgoing.push(null)
        outgoing[pl] = commit.parents[k]
        branchOut.add(pl)
      }
    } else {
      outgoing[myLane] = null // 根提交，本 lane 结束
    }

    const segments: GraphSegment[] = []
    // 上半段（0 → 0.5）：incoming 每个非空 lane
    for (let j = 0; j < incoming.length; j++) {
      if (incoming[j] == null) continue
      if (incoming[j] === commit.hash) {
        segments.push({ fromLane: j, toLane: myLane, fromY: 0, toY: 0.5, color: laneColor(j) })
      } else {
        segments.push({ fromLane: j, toLane: j, fromY: 0, toY: 0.5, color: laneColor(j) })
      }
    }
    // 下半段（0.5 → 1）：outgoing 每个非空 lane
    for (let j = 0; j < outgoing.length; j++) {
      if (outgoing[j] == null) continue
      if (branchOut.has(j)) {
        segments.push({ fromLane: myLane, toLane: j, fromY: 0.5, toY: 1, color: laneColor(j) })
      } else {
        segments.push({ fromLane: j, toLane: j, fromY: 0.5, toY: 1, color: laneColor(j) })
      }
    }

    const laneCount = Math.max(incoming.length, outgoing.length, myLane + 1)
    rows.push({ commit, lane: myLane, color: laneColor(myLane), laneCount, segments })

    let end = outgoing.length
    while (end > 0 && outgoing[end - 1] == null) end--
    lanes = outgoing.slice(0, end)
  }
  return rows
}

// 解析 %D refs 为标签列表（去掉 "HEAD -> " 前缀、tag: 前缀标记类型）
export interface GitRef {
  name: string
  kind: 'head' | 'branch' | 'remote' | 'tag'
}
export function parseRefs(refs: string): GitRef[] {
  if (!refs) return []
  const out: GitRef[] = []
  for (let part of refs.split(',')) {
    part = part.trim()
    if (!part) continue
    if (part.startsWith('HEAD -> ')) {
      out.push({ name: part.slice('HEAD -> '.length), kind: 'head' })
    } else if (part === 'HEAD') {
      out.push({ name: 'HEAD', kind: 'head' })
    } else if (part.startsWith('tag: ')) {
      out.push({ name: part.slice('tag: '.length), kind: 'tag' })
    } else if (part.startsWith('origin/') || part.includes('/')) {
      out.push({ name: part, kind: 'remote' })
    } else {
      out.push({ name: part, kind: 'branch' })
    }
  }
  return out
}
