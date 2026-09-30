import type { Candidate, DictEntry } from './composerCandidates'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { t, getLang } from '../../i18n.ts'
import { userTermIdentity } from '../dict/userTermIdentity'
import { loadDictEn, localizeTerm, termName } from '../dict/dictEn'
import { isSkillExposed } from '../../../../shared/skillExposure'
import { skillInsertText } from './skillInsert'

// Read-only sources. No writes, connections or CLI launches from candidate selection.
export async function loadDictionary(): Promise<DictEntry[]> {
  const terms = (await import('../dict/dictionary-bundle.json')).default.terms
  if (getLang() !== 'en') return terms
  // 英文界面：候选名（chip 标签）用英文名，插入的提示词用英文版；中文名留在 keywords 里，照样能 @ 中文搜到
  const en = await loadDictEn()
  return terms.map(term => {
    const loc = localizeTerm(term, en)
    return { ...loc, zh: termName(term, en), keywords: [term.zh, ...term.keywords] }
  })
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
    return { id: `file:${f.rel}`, category: 'file', name: f.rel, description: f.name, insert: `@${quote(f.rel)}`, imagePath: /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(f.rel) ? f.path : undefined }
  })
  return [...rows, ...[...folders].map(name => ({ id: `folder:${name}`, category: 'folder' as const, name, description: t('chat.picker.projectDir'), insert: `@${quote(name)}` }))]
}
export async function loadSkills(ctx: { cli?: string; mode?: '/' | '@'; cwd?: string } = {}): Promise<Candidate[]> {
  const dirs = await window.api.skillLibrary.listDirs()
  // 「AI 自动发现」关掉的 skill：这里是它唯一的入口，标一句让用户知道它得靠点名。
  // 插进去的那句话由 skillInsertText 决定（Claude 在开头用 / 选就是原生 /名字，直接执行）。
  const expo = await Promise.resolve().then(() => window.api.skillLibrary.getExposure()).catch(() => null)
  const claudeDirs = [
    ...dirs.filter(d => d.id === 'claude-global').map(d => d.path),
    ...(ctx.cwd ? [ctx.cwd.replace(/[/\\]+$/, '') + '/.claude/skills'] : [])
  ]
  const rows = await Promise.all(dirs.map(async d => {
    const r = await window.api.skillLibrary.list(d.path)
    if (!r.ok) throw new Error(t('chat.picker.skillDirFail'))
    return r.skills.filter(s => !r.disabled.includes(s.path)).map(s => {
      const name = s.name || s.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || s.path
      const exposed = !expo || isSkillExposed(expo, s.path)
      // insert 是发给 AI 的原文（不翻译），规则见 skillInsert.ts；description 是界面文字，走词典
      return { id: `skill:${s.path}`, category: 'skill' as const, name, description: (exposed ? '' : t('chat.picker.needName')) + (s.description || t('chat.picker.installedSkill')), aliases: [s.path], insert: skillInsertText({ cli: ctx.cli, mode: ctx.mode, skillPath: s.path, name, exposed, claudeDirs }) }
    })
  }))
  return [...new Map(rows.flat().map(c => [c.id, c])).values()]
}
export async function loadPlugins(cli: string, boundPluginId?: string): Promise<Candidate[]> {
  const plugins = await window.api.plugins.list()
  // 总闸：只 @ 得到**开启的**插件（在「更多 › 插件」里关掉的不出现）
  return plugins.filter(p => (p.cli === cli || p.cli === 'eas') && p.enabled !== false).map(p => ({ id: `plugin:${p.id}`, category: !p.mcpServers && !p.mcp && !p.remote ? 'app' : 'plugin', name: p.displayName, description: p.description || p.name, insert: '使用插件「' + p.displayName + '」', disabled: p.id === boundPluginId ? undefined : 'chat.picker.pluginBindHint' })) // i18n-allow: 插入到输入框的文字，会发给 AI
}
export function browserCandidates(): Candidate[] {
  const s = useStore.getState()
  const panes = [...s.canvas.frames.flatMap(f => f.nodes.map(n => n.pane)), ...s.tabs.flatMap(t => collectLeaves(t.root).map(l => l.pane))]
  const rows = panes.flatMap(p => p?.kind === 'web' && p.url && /^https?:\/\//.test(p.url) ? [{ id: `browser:${p.url}`, category: 'browser' as const, name: p.title || p.url, description: p.url, insert: `参考网页 ${p.url}` }] : [])
  return [...new Map(rows.map(c => [c.id, c])).values()]
}
