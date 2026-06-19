import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import os from 'os'
import fs from 'fs'
import { execFile } from 'child_process'
import type { PtyCreateOptions } from '../shared/types'

interface Entry {
  pty: pty.IPty
  wcId: number
}

const ptys = new Map<string, Entry>()
let nextId = 1

function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/zsh'
}

// 判断哪些 shell 进程"忙"：一次性取系统所有进程的父 PID，
// 若某 shell 的 PID 出现在父 PID 集合里，说明它有子进程（前台命令或后台任务）在跑。
// 空闲的登录 shell 没有子进程，因此不会误报。跨平台：unix 用 ps，Windows 用 PowerShell。
function shellsWithChildren(shellPids: number[]): Promise<Set<number>> {
  return new Promise((resolve) => {
    if (shellPids.length === 0) {
      resolve(new Set())
      return
    }
    const collect = (stdout: string): void => {
      const parents = new Set<number>()
      for (const line of stdout.split('\n')) {
        const n = parseInt(line.trim(), 10)
        if (n > 0) parents.add(n)
      }
      resolve(new Set(shellPids.filter((pid) => parents.has(pid))))
    }
    if (process.platform === 'win32') {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Process).ParentProcessId'],
        { timeout: 4000, windowsHide: true },
        (err, stdout) => (err ? resolve(new Set()) : collect(stdout))
      )
    } else {
      execFile('ps', ['-axo', 'ppid='], { timeout: 2500 }, (err, stdout) =>
        err ? resolve(new Set()) : collect(stdout)
      )
    }
  })
}

/** 是否有任意终端正在运行命令（供退出确认用） */
export async function anyPtyBusy(): Promise<boolean> {
  const pids: number[] = []
  for (const entry of ptys.values()) {
    if (typeof entry.pty.pid === 'number') pids.push(entry.pty.pid)
  }
  const busy = await shellsWithChildren(pids)
  return busy.size > 0
}

export function registerPtyHandlers(): void {
  ipcMain.handle('pty:create', (e, opts: PtyCreateOptions) => {
    const id = String(nextId++)
    let cwd = opts.cwd || os.homedir()
    try {
      if (!fs.statSync(cwd).isDirectory()) cwd = os.homedir()
    } catch {
      cwd = os.homedir()
    }
    // PowerShell 不认 Unix 的 -l 登录参数，仅在非 Windows 传 -l
    const shellArgs = process.platform === 'win32' ? [] : ['-l']
    const proc = pty.spawn(defaultShell(), shellArgs, {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd,
      env: { ...process.env, TERM_PROGRAM: 'Eas-Term' } as Record<string, string>
    })
    const wc = e.sender
    proc.onData((data) => {
      if (!wc.isDestroyed()) wc.send(`pty:data:${id}`, data)
    })
    proc.onExit(({ exitCode }) => {
      ptys.delete(id)
      if (!wc.isDestroyed()) wc.send(`pty:exit:${id}`, exitCode)
    })
    ptys.set(id, { pty: proc, wcId: wc.id })
    return { id }
  })

  ipcMain.on('pty:write', (_e, id: string, data: string) => {
    ptys.get(id)?.pty.write(data)
  })

  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return
    try {
      ptys.get(id)?.pty.resize(cols, rows)
    } catch {
      // pty 可能正在退出，忽略
    }
  })

  ipcMain.on('pty:kill', (_e, id: string) => {
    const entry = ptys.get(id)
    if (entry) {
      ptys.delete(id)
      try {
        entry.pty.kill()
      } catch {
        // 已退出
      }
    }
  })

  // 给定一组 pty id，返回其中正在运行命令的那些
  ipcMain.handle('pty:busyByIds', async (_e, ids: string[]) => {
    const pairs: { id: string; pid: number }[] = []
    for (const id of ids) {
      const pid = ptys.get(id)?.pty.pid
      if (typeof pid === 'number') pairs.push({ id, pid })
    }
    const busyPids = await shellsWithChildren(pairs.map((p) => p.pid))
    return pairs.filter((p) => busyPids.has(p.pid)).map((p) => p.id)
  })
}

export function killPtysForWebContents(wcId: number): void {
  for (const [id, entry] of ptys) {
    if (entry.wcId === wcId) {
      ptys.delete(id)
      try {
        entry.pty.kill()
      } catch {
        // 已退出
      }
    }
  }
}

export function killAllPtys(): void {
  for (const [, entry] of ptys) {
    try {
      entry.pty.kill()
    } catch {
      // 已退出
    }
  }
  ptys.clear()
}
