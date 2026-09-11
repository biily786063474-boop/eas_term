import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const s = fs.readFileSync(new URL('./PaneView.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('./workspace.css', import.meta.url), 'utf8')
test('canvas sessions share node shell, heading and content clipping', () => {
 assert.ok(s.includes("canvasSession ? ' cfile-node' : ''"))
 assert.ok(s.includes("canvasSession ? 'cfile-head' : 'pane-header'"))
 assert.ok(s.includes("canvasSession ? 'pane-body cfile-body' : 'pane-body'"))
 assert.match(css, /\.pane\.cfile-node\s*\{\s*overflow:\s*visible;/)
 assert.doesNotMatch(css, /\.pane-header > \.cfile-badge/)
})
test('canvas identities stay static; split-pane switcher remains', () => {
 assert.match(s, /if \(canvasMode && \(kind === 'terminal' \|\| kind === 'agent'\)\)/)
 assert.match(s, /className="cfile-badge"/)
 assert.match(s, /pane-kind-btn/)
})
