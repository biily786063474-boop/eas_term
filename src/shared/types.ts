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

// ---------- Git（源代码管理面板） ----------

// 单个变更文件。x/y 对应 `git status` 的 XY 两位状态码（索引/工作区）。
export interface GitFileEntry {
  path: string // 相对仓库根
  origPath?: string // 重命名/复制的原路径
  x: string // 索引（暂存区）状态码：M A D R C ? U .
  y: string // 工作区状态码
  staged: boolean // 有已暂存改动
  unstaged: boolean // 有未暂存/未跟踪改动
  untracked: boolean
  conflicted: boolean
}

export interface GitStatus {
  isRepo: boolean
  root?: string
  branch?: string
  ahead?: number
  behind?: number
  files: GitFileEntry[]
  error?: string
}

// diff 以「原始文本 vs 修改后文本」返回，前端交给 CodeMirror merge 计算并高亮，
// 不在主进程解析 unified diff。
export interface GitDiffResult {
  ok: boolean
  original: string
  modified: string
  binary: boolean
  truncated: boolean
  error?: string
}

// 历史里的一次提交（版本）
export interface GitCommit {
  hash: string
  parents: string[] // 父提交（第一个是主父），用于画分支轨道图
  refs: string // 原始 %D（如 "HEAD -> main, origin/main, tag: v1"），前端解析
  author: string // 作者名（%an）
  at: number // 提交时间（unix 秒）
  subject: string // 提交信息首行
  files: number // 改动文件数
}

// 某次提交里改动的单个文件（用于「点提交看这次改了啥」）
export interface GitCommitFile {
  path: string
  origPath?: string // 重命名的原路径
  status: string // A/M/D/R/C…（首字母）
}

// AI 简述（复用终端里的 claude CLI 生成）
export interface AiResult {
  ok: boolean
  text?: string
  error?: string
}

// ---------- Claude Code 对话导航（读 ~/.claude/projects 的 transcript） ----------

// 用户发的一条消息（导航目录项）
export interface SessionTurn {
  uuid: string
  at: number // 时间戳（ms）
  preview: string // 消息文本预览
  imageCount?: number // 该消息附带的图片数（粘贴的截图等）
}

// 消息里附带的一张图片（transcript 中以 base64 内联）
export interface SessionImage {
  mediaType: string // 如 image/png
  data: string // base64
}

// 某条用户消息 + 当时 Claude 的回答（点击后展开）
export interface SessionExchange {
  userText: string
  assistantText: string
  at: number
  images?: SessionImage[]
}

export interface SessionIndex {
  found: boolean // 是否找到该 cwd 的 Claude Code 会话
  sessionId?: string
  turns: SessionTurn[]
}
