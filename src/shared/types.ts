export interface Project {
  id: string
  name: string
  path: string
  addedAt: number
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  isHidden: boolean
}

export interface PtyCreateOptions {
  cwd?: string
  cols?: number
  rows?: number
}

export interface TextFileResult {
  ok: boolean
  content: string
  truncated: boolean
  binary: boolean
  size: number
  error?: string
}

export interface ImageFileResult {
  ok: boolean
  dataUrl: string
  size: number
  error?: string
}

export interface BizoneCheck {
  installed: boolean
  website: string
  downloadUrl: string
}

export interface BizoneProject {
  id: string
  name: string
  updatedAt: number
  nodeCount: number
}

export interface BizoneMedia {
  mediaId: string
  kind: 'image' | 'video'
  mimeType: string
  size: number
  createdAt: number
  title?: string
  prompt?: string
  model?: string
}

export interface InsertResult {
  ok: boolean
  relPath?: string
  absPath?: string
  error?: string
}

export interface OpResult {
  ok: boolean
  path?: string
  error?: string
}

// 终端链接：把终端输出里的候选路径解析成绝对路径并确认其存在。
// null 表示该候选不是真实存在的文件/目录（不应渲染为可点击链接）。
export interface PathProbe {
  absPath: string
  isDir: boolean
}
