import type { Candidate, DictEntry } from './composerCandidates'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { userTermIdentity } from '../dict/userTermIdentity'

// Read-only sources. No writes, connections or CLI launches from candidate selection.
export async function loadDictionary(): Promise<DictEntry[]> {
  return (await import('../dict/dictionary-bundle.json')).default.terms
}
export const loadUserDictionary = async (): Promise<DictEntry[]> =>
  (await window.api.fs.userTerms()).map(term => ({ ...term, ...userTermIdentity(term) }))
export async function loadFiles(cwd: string): Promise<Candidate[]> {
  if (!cwd) return []
  // Reuse the existing scanner's 20,000-entry/depth-8 bound and exclusions.
  // readDir also distinguishes an inaccessible root from a successful empty scan.
  const [files, rootEntries] = await Promise.all([window.api.fs.recentFiles(cwd, 20000, false), window.api.fs.readDir(cwd)])
  const folders = new Set(rootEntries.filter(e => e.isDir && !e.isHidden && !['node_modules', 'out', 'dist', 'build', 'release'].includes(e.name)).map(e => e.name + '/'))
  const quote = (s: string): string => /\s/.test(s) ? JSON.stringify(s) : s
  const rows: Candidate[] = files.map(f => {
    const parts = f.rel.replaceAll('\\', '/').split('/')
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/') + '/')
    return { id: `file:${f.rel}`, category: 'file', name: f.rel, description: f.name, insert: `@${quote(f.rel)}` }
  })
  return [...rows, ...[...folders].map(name => ({ id: `folder:${name}`, category: 'folder' as const, name, description: '项目目录', insert: `@${quote(name)}` }))]
}
export async function loadSkills(): Promise<Candidate[]> {
  const dirs = await window.api.skillLibrary.listDirs()
  const rows = await Promise.all(dirs.map(async d => {
    const r = await window.api.skillLibrary.list(d.path)
    if (!r.ok) throw new Error('技能目录读取失败')
    return r.skills.filter(s => !r.disabled.includes(s.path)).map(s => {
      const name = s.name || s.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || s.path
      return { id: `skill:${s.path}`, category: 'skill' as const, name, description: s.description || '已安装技能', aliases: [s.path], insert: `使用技能「${name}」（${s.path.replace(/[/\\]+$/, '')}/SKILL.md）` }
    })
  }))
  return [...new Map(rows.flat().map(c => [c.id, c])).values()]
}
export async function loadPlugins(cli: string, boundPluginId?: string): Promise<Candidate[]> {
  const plugins = await window.api.plugins.list()
  return plugins.filter(p => p.cli === cli || p.cli === 'eas').map(p => ({ id: `plugin:${p.id}`, category: !p.mcpServers && !p.mcp ? 'app' : 'plugin', name: p.displayName, description: p.description || p.name, insert: '使用插件「' + p.displayName + '」', disabled: p.id === boundPluginId ? undefined : '请从插件面板打开绑定该插件的对话；引用名称不会建立连接' }))
}
export function browserCandidates(): Candidate[] {
  const s = useStore.getState()
  const panes = [...s.canvas.frames.flatMap(f => f.nodes.map(n => n.pane)), ...s.tabs.flatMap(t => collectLeaves(t.root).map(l => l.pane))]
  const rows = panes.flatMap(p => p?.kind === 'web' && p.url && /^https?:\/\//.test(p.url) ? [{ id: `browser:${p.url}`, category: 'browser' as const, name: p.title || p.url, description: p.url, insert: `参考网页 ${p.url}` }] : [])
  return [...new Map(rows.map(c => [c.id, c])).values()]
}
