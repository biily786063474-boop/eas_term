import path from 'node:path'
import fs from 'node:fs'
import type { BizoneInstallation } from './bizoneRuntime.ts'

/** Consume Electron's native protocol-handler executable path, never a command string.
 * Identity and complete unpacked production payload are required before execution. */
export function validateBizoneWindowsInstallation(executable: unknown, options: {
  read?: (file: string) => string
  exists?: (file: string) => boolean
} = {}): BizoneInstallation | undefined {
  if (typeof executable !== 'string' || !/^[A-Za-z]:\\/.test(executable) ||
      /["\x00-\x1f]/.test(executable) || !/\.exe$/i.test(executable) ||
      executable.split('\\').some(part => part === '..' || part === '.') || executable.slice(2).includes(':')) return undefined
  const root = path.win32.dirname(executable)
  const appRoot = path.win32.join(root, 'resources', 'app')
  const server = path.win32.join(appRoot, 'electron', 'mcpServer.js')
  const read = options.read ?? ((file: string) => fs.readFileSync(file, 'utf8'))
  const exists = options.exists ?? fs.existsSync
  try {
    const manifest = JSON.parse(read(path.win32.join(appRoot, 'package.json')))
    if (manifest.name !== 'bizone-canvas' || manifest.main !== 'electron/main.js' || manifest.type !== 'module') return undefined
    if (![executable, server, path.win32.join(appRoot, 'electron', 'main.js'),
      path.win32.join(appRoot, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json')].every(exists)) return undefined
    return { app: root, executable, server }
  } catch { return undefined }
}

/** No registration, shell, URL opening, or executable launch occurs during discovery. */
export async function discoverBizoneWindowsInstallation(
  getApplicationInfo: (url: string) => Promise<{ path: string }>,
  options?: Parameters<typeof validateBizoneWindowsInstallation>[1]
): Promise<BizoneInstallation | undefined> {
  try { return validateBizoneWindowsInstallation((await getApplicationInfo('bzone://')).path, options) }
  catch { return undefined }
}
