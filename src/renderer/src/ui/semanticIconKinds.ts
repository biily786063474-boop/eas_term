import type { SemanticIconKind } from './SemanticIcons'

/** Pure filename mapping shared by every FileTree surface. */
export function fileIconKind(name: string): SemanticIconKind {
  const lower = name.toLowerCase()
  if (lower === 'agents.md' || lower === 'claude.md') return 'skill'
  if (lower === '.git' || lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules') return 'git'
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  if (ext === 'ts' || ext === 'tsx') return 'typescript'
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'javascript'
  if (ext === 'md' || ext === 'mdx') return 'markdown'
  if (ext === 'json' || ext === 'jsonc') return 'json'
  if (ext === 'svg') return 'vector'
  if (['png', 'icns', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'image'
  if (['plist', 'yaml', 'yml', 'toml', 'ini', 'conf', 'config'].includes(ext)) return 'config'
  return 'generic'
}
