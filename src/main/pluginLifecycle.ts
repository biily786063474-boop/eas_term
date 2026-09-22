import fs from 'node:fs'
import path from 'node:path'
// FSEvents can replay a rename that predates a newly attached watcher. Compare
// actual filesystem state so reinstall does not immediately kill the new process.
function revision(root: string): string {
  const rows: string[] = []
  const visit = (file: string): void => {
    const stat = fs.lstatSync(file)
    rows.push([file, stat.ino, stat.size, stat.mtimeMs, stat.mode].join(':'))
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of fs.readdirSync(file).sort()) {
        if (name !== '.git') visit(path.join(file, name))
      }
    }
  }
  try { const real=fs.realpathSync(root); rows.push(real); visit(real); return rows.join('\n') } catch { return 'unavailable' }
}
/** Watch only the hosted plugin's own directory; never project data or other processes. */
export function watchPluginFiles(root: string, invalidate: () => void): () => void {
  let closed = false
  const initial = revision(root)
  if (initial === 'unavailable') throw new Error('插件目录不可读，无法建立生命周期监听')
  const watcher = fs.watch(root, {recursive: true}, () => {
    if (closed || revision(root) === initial) return
    closed = true
    watcher.close()
    invalidate()
  })
  watcher.on('error', () => {
    if (closed) return
    closed = true
    watcher.close()
    invalidate()
  })
  watcher.unref()
  return () => { closed = true; watcher.close() }
}
