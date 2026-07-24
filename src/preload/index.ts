import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  Project,
  DirEntry,
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
  AgentProbe
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
    probe: (): Promise<AgentProbe> => ipcRenderer.invoke('agent:probe')
  },
  fs: {
    readDir: (dirPath: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', dirPath),
    readTextFile: (filePath: string): Promise<TextFileResult> =>
      ipcRenderer.invoke('fs:readTextFile', filePath),
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
      ipcRenderer.invoke('git:describe', cwd, hash)
  },
  session: {
    index: (cwd: string): Promise<SessionIndex> => ipcRenderer.invoke('session:index', cwd),
    exchange: (cwd: string, uuid: string, sessionId?: string): Promise<SessionExchange> =>
      ipcRenderer.invoke('session:exchange', cwd, uuid, sessionId)
  },
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),
    readText: (): Promise<string> => ipcRenderer.invoke('clipboard:readText'),
    hasImage: (): Promise<boolean> => ipcRenderer.invoke('clipboard:hasImage')
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
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
