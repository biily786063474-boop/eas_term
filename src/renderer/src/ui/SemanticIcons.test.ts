import assert from 'node:assert/strict'
import test from 'node:test'
import { fileIconKind } from './semanticIconKinds.ts'

test('fileIconKind maps approved filenames and extensions', () => {
  const cases = { 'afterPack.js': 'javascript', 'hero.PNG': 'image', 'App.ICNS': 'image', 'mark.SVG': 'vector', 'Info.plist': 'config', 'AGENTS.md': 'skill', 'CLAUDE.md': 'skill', 'view.tsx': 'typescript', 'README.md': 'markdown', 'data.json': 'json', '.gitignore': 'git', 'unknown.xyz': 'generic' } as const
  for (const [name, expected] of Object.entries(cases)) assert.equal(fileIconKind(name), expected, name)
})
