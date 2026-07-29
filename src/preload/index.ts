import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  Project,
  DirEntry,
  RecentFile,
  UserTerm,
  PtyCreateOptions,
  TextFileResult,
  ImageFileResult,
  BizoneCheck,
  BizoneProject,
  BizoneMedia,
  InsertResult,
  OpResult,
  PathProbe,
  GitStatus,
  GitDiffResult,
  GitCommit,
  GitCommitFile,
  AiResult,
  SessionIndex,
  SessionExchange,
  AgentProbe,
  SkillStatus,
  HookStatus,
  AgentRole,
  InstallPlan
} from '../shared/types'

// PTY 创建后到 xterm 挂载订阅前，shell 的首批输出（提示符等）会经 IPC 到达，
// 这里先缓冲，等 onData 注册时一次性回放，避免丢失。
const pendingBuffers = new Map<string, { chunks: string[]; listener: (e: IpcRendererEvent, d: string) => void }>()

function startBuffering(id: string): void {
  const chunks: string[] = []
  const listener = (_e: IpcRendererEvent, data: string): void => {
    chunks.push(data)
  }
  ipcRenderer.on(`pty:data:${id}`, listener)
  pendingBuffers.set(id, { chunks, listener })
}

const api = {
  platform: process.platform,
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
    addViaDialog: (): Promise<Project[]> => ipcRenderer.invoke('projects:addViaDialog'),
    remove: (id: string): Promise<Project[]> => ipcRenderer.invoke('projects:remove', id)
  },
  canvas: {
    // 画布场景持久化：整场景存 / 读（结构由渲染层定义，此处按 unknown 透传）
    load: (): Promise<unknown> => ipcRenderer.invoke('canvas:load'),
    save: (scene: unknown): Promise<void> => ipcRenderer.invoke('canvas:save', scene),
    // 同步落盘：退出/刷新前(beforeunload)调,阻塞到写完再放行,防「改完就退」丢失
    saveSync: (scene: unknown): void => {
      ipcRenderer.sendSync('canvas:save-sync', scene)
    }
  },
  agent: {
    // 开终端时探测：从 `claude --help` 真实解析 模型别名 / effort 档位（不硬编码）
    probe: (): Promise<AgentProbe> => ipcRenderer.invoke('agent:probe'),
    // Codex 起完之后按 cwd 捞它的 session id（Codex 没有指定会话 id 的启动参数）
    captureCodexSession: (cwd: string, sinceMs: number): Promise<{ id: string | null }> =>
      ipcRenderer.invoke('codex:captureSession', cwd, sinceMs),
    // 用户配了哪些 Codex MCP server（禁用清单要按它过滤：名字不存在 codex 会拒绝启动）
    codexServers: (): Promise<string[]> => ipcRenderer.invoke('agent:codexServers')
  },
  browser: {
    // 迷你浏览器里链接开新窗被拦成同 view 导航时,主进程通知渲染层聚焦该浏览器节点(传 guest webContents id)
    onFocus: (cb: (guestId: number) => void): (() => void) => {
      const h = (_e: unknown, guestId: number): void => cb(guestId)
      ipcRenderer.on('browser:focus', h)
      return () => ipcRenderer.removeListener('browser:focus', h)
    }
  },
  stt: {
    // 离线语音转文字(sherpa-onnx 流式)。渲染进程采麦送 16kHz Int16 PCM,主进程回传 partial/final。
    start: (): Promise<{ ok: boolean; error?: string; needDownload?: boolean }> =>
      ipcRenderer.invoke('stt:start'),
    sendAudio: (buf: ArrayBuffer): void => ipcRenderer.send('stt:audio', buf),
    stop: (): Promise<{ text: string }> => ipcRenderer.invoke('stt:stop'),
    onPartial: (cb: (text: string) => void): (() => void) => {
      const h = (_e: unknown, t: string): void => cb(t)
      ipcRenderer.on('stt:partial', h)
      return () => ipcRenderer.removeListener('stt:partial', h)
    },
    onFinal: (cb: (text: string) => void): (() => void) => {
      const h = (_e: unknown, t: string): void => cb(t)
      ipcRenderer.on('stt:final', h)
      return () => ipcRenderer.removeListener('stt:final', h)
    },
    // 模型「首次使用下载」：查状态 / 触发下载 / 订阅进度
    modelStatus: (): Promise<{ ready: boolean; missing: string[] }> =>
      ipcRenderer.invoke('stt:modelStatus'),
    downloadModels: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('stt:downloadModels'),
    onDownloadProgress: (
      cb: (p: { phase: string; received?: number; error?: string }) => void
    ): (() => void) => {
      const h = (_e: unknown, p: { phase: string; received?: number; error?: string }): void => cb(p)
      ipcRenderer.on('stt:downloadProgress', h)
      return () => ipcRenderer.removeListener('stt:downloadProgress', h)
    }
  },
  mcp: {
    // MCP 桥：主进程把 AI 的工具调用转过来，渲染层执行 store action 后回传结果
    onInvoke: (
      cb: (p: { id: number; tool: string; args: unknown; ctx: { ptyId?: string; project?: string } }) => void
    ): (() => void) => {
      const h = (_e: unknown, p: { id: number; tool: string; args: unknown; ctx: { ptyId?: string; project?: string } }): void => cb(p)
      ipcRenderer.on('mcp:invoke', h)
      return () => ipcRenderer.removeListener('mcp:invoke', h)
    },
    reply: (r: { id: number; ok: boolean; data?: unknown; error?: string }): void =>
      ipcRenderer.send('mcp:result', r)
  },
  skill: {
    // 配套技能包（告诉 AI 什么时候该用画板工具）：查状态 / 安装 / 关掉启动提醒
    status: (): Promise<SkillStatus> => ipcRenderer.invoke('skill:status'),
    install: (
      targets: ('claude' | 'codex')[]
    ): Promise<{ ok: boolean; error?: string; done?: string[]; status?: SkillStatus }> =>
      ipcRenderer.invoke('skill:install', targets),
    mute: (muted: boolean): Promise<SkillStatus> => ipcRenderer.invoke('skill:mute', muted),
    // 一个 CLI 都没装时，按这台机器的实际情况给出该跑哪条安装命令（只给命令，不代执行）
    installPlan: (): Promise<InstallPlan> => ipcRenderer.invoke('agent:installPlan')
  },
  hook: {
    // 「提交即复盘」钩子：查状态 / 装 / 卸。这是侵入性最高的一项，必须能一键卸干净
    status: (): Promise<HookStatus> => ipcRenderer.invoke('hook:status'),
    install: (
      targets: ('claude' | 'codex')[]
    ): Promise<{ ok: boolean; error?: string; done?: string[]; status?: HookStatus }> =>
      ipcRenderer.invoke('hook:install', targets),
    uninstall: (
      targets: ('claude' | 'codex')[]
    ): Promise<{ ok: boolean; error?: string; status?: HookStatus }> =>
      ipcRenderer.invoke('hook:uninstall', targets)
  },
  roles: {
    // Agent 角色（~/.eas/roles.json）：列 / 存 / 恢复内置
    list: (): Promise<AgentRole[]> => ipcRenderer.invoke('roles:list'),
    save: (roles: AgentRole[]): Promise<{ ok: boolean; error?: string; roles?: AgentRole[] }> =>
      ipcRenderer.invoke('roles:save', roles),
    reset: (): Promise<{ ok: boolean; error?: string; roles?: AgentRole[] }> =>
      ipcRenderer.invoke('roles:reset'),
    // 角色契约落成文件，供 claude --append-system-prompt-file 引用
    contractFile: (roleId: string): Promise<string | null> =>
      ipcRenderer.invoke('roles:contractFile', roleId)
  },
  design: {
    // 设计模块导出产物落盘到 <项目>/demo/（渲染层传导出 Blob 的 ArrayBuffer）
    exportToDemo: (
      projectPath: string,
      filename: string,
      data: ArrayBuffer
    ): Promise<{ ok: boolean; error?: string; path?: string }> =>
      ipcRenderer.invoke('design:exportToDemo', projectPath, filename, data),
    revealDemo: (filePath: string): Promise<void> => ipcRenderer.invoke('design:revealDemo', filePath)
  },
  fs: {
    readDir: (dirPath: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', dirPath),
    recentFiles: (rootPath: string, limit?: number): Promise<RecentFile[]> =>
      ipcRenderer.invoke('fs:recentFiles', rootPath, limit),
    // 用户自建词条（~/.eas/dict-user.json，由「提交即复盘」hook 沉淀）
    userTerms: (): Promise<UserTerm[]> => ipcRenderer.invoke('dict:userTerms'),
    readTextFile: (filePath: string): Promise<TextFileResult> =>
      ipcRenderer.invoke('fs:readTextFile', filePath),
    writeTextFile: (filePath: string, content: string): Promise<OpResult> =>
      ipcRenderer.invoke('fs:writeTextFile', filePath, content),
    readImageFile: (filePath: string): Promise<ImageFileResult> =>
      ipcRenderer.invoke('fs:readImageFile', filePath),
    openPath: (target: string): Promise<string> => ipcRenderer.invoke('fs:openPath', target),
    showInFolder: (target: string): Promise<void> => ipcRenderer.invoke('fs:showInFolder', target),
    rename: (oldPath: string, newName: string): Promise<OpResult> =>
      ipcRenderer.invoke('fs:rename', oldPath, newName),
    trash: (target: string): Promise<OpResult> => ipcRenderer.invoke('fs:trash', target),
    probePaths: (inputs: string[], baseCwd: string): Promise<(PathProbe | null)[]> =>
      ipcRenderer.invoke('fs:probePaths', inputs, baseCwd)
  },
  git: {
    status: (cwd: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', cwd),
    diff: (cwd: string, relPath: string, mode: 'worktree' | 'staged'): Promise<GitDiffResult> =>
      ipcRenderer.invoke('git:diff', cwd, relPath, mode),
    stage: (cwd: string, paths: string[]): Promise<OpResult> =>
      ipcRenderer.invoke('git:stage', cwd, paths),
    unstage: (cwd: string, paths: string[]): Promise<OpResult> =>
      ipcRenderer.invoke('git:unstage', cwd, paths),
    discard: (cwd: string, paths: string[], untracked: boolean): Promise<OpResult> =>
      ipcRenderer.invoke('git:discard', cwd, paths, untracked),
    commit: (cwd: string, message: string): Promise<OpResult> =>
      ipcRenderer.invoke('git:commit', cwd, message),
    log: (cwd: string, limit: number): Promise<GitCommit[]> =>
      ipcRenderer.invoke('git:log', cwd, limit),
    commitFiles: (cwd: string, hash: string): Promise<GitCommitFile[]> =>
      ipcRenderer.invoke('git:commitFiles', cwd, hash),
    commitDiff: (cwd: string, hash: string, relPath: string): Promise<GitDiffResult> =>
      ipcRenderer.invoke('git:commitDiff', cwd, hash, relPath),
    describe: (cwd: string, hash: string): Promise<AiResult> =>
      ipcRenderer.invoke('git:describe', cwd, hash),
    resetHard: (cwd: string, hash: string): Promise<OpResult> =>
      ipcRenderer.invoke('git:resetHard', cwd, hash)
  },
  session: {
    index: (cwd: string): Promise<SessionIndex> => ipcRenderer.invoke('session:index', cwd),
    exchange: (cwd: string, uuid: string, sessionId?: string): Promise<SessionExchange> =>
      ipcRenderer.invoke('session:exchange', cwd, uuid, sessionId)
  },
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),
    readText: (): Promise<string> => ipcRenderer.invoke('clipboard:readText'),
    hasImage: (): Promise<boolean> => ipcRenderer.invoke('clipboard:hasImage'),
    // 剪贴板图片 → <项目>/assets/img/pasted-<时间戳>.png
    saveImage: (projectPath: string): Promise<{ ok: boolean; error?: string; path?: string }> =>
      ipcRenderer.invoke('clipboard:saveImage', projectPath)
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
    // 终端里 CLI 调 `open <url>` 被 shim 劫持后，主进程经此通知渲染层在画板浏览器打开
    onOpenInCanvas: (cb: (url: string) => void): (() => void) => {
      const h = (_e: unknown, url: string): void => cb(url)
      ipcRenderer.on('shell:openInCanvas', h)
      return () => ipcRenderer.removeListener('shell:openInCanvas', h)
    }
  },
  bizone: {
    check: (): Promise<BizoneCheck> => ipcRenderer.invoke('bizone:check'),
    listProjects: (): Promise<BizoneProject[]> => ipcRenderer.invoke('bizone:listProjects'),
    listMedia: (projectId: string): Promise<BizoneMedia[]> =>
      ipcRenderer.invoke('bizone:listMedia', projectId),
    insertToVAssets: (mediaId: string, projectPath: string): Promise<InsertResult> =>
      ipcRenderer.invoke('bizone:insertToVAssets', mediaId, projectPath),
    revealMedia: (mediaId: string): Promise<void> =>
      ipcRenderer.invoke('bizone:revealMedia', mediaId)
  },
  pty: {
    create: async (opts: PtyCreateOptions): Promise<{ id: string }> => {
      const result: { id: string } = await ipcRenderer.invoke('pty:create', opts)
      startBuffering(result.id)
      return result
    },
    write: (id: string, data: string): void => {
      ipcRenderer.send('pty:write', id, data)
    },
    resize: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send('pty:resize', id, cols, rows)
    },
    kill: (id: string): void => {
      const pending = pendingBuffers.get(id)
      if (pending) {
        ipcRenderer.removeListener(`pty:data:${id}`, pending.listener)
        pendingBuffers.delete(id)
      }
      ipcRenderer.send('pty:kill', id)
    },
    busyByIds: (ids: string[]): Promise<string[]> => ipcRenderer.invoke('pty:busyByIds', ids),
    cwd: (id: string): Promise<string | null> => ipcRenderer.invoke('pty:cwd', id),
    onData: (id: string, cb: (data: string) => void): (() => void) => {
      const channel = `pty:data:${id}`
      const pending = pendingBuffers.get(id)
      if (pending) {
        ipcRenderer.removeListener(channel, pending.listener)
        pendingBuffers.delete(id)
        for (const chunk of pending.chunks) cb(chunk)
      }
      const listener = (_e: IpcRendererEvent, data: string): void => cb(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id: string, cb: (exitCode: number) => void): (() => void) => {
      const channel = `pty:exit:${id}`
      const listener = (_e: IpcRendererEvent, exitCode: number): void => cb(exitCode)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
