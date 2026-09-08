import fs from 'node:fs'
import path from 'node:path'

// Export only exact fixture tool identities, never arbitrary native messages or credentials.
export function ompCanvasProof(profile, file, tool = 'canvas_open_file') {
  const base = path.join(profile, 'omp', 'agent', 'sessions')
  const found = []
  const walk = directory => {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(target)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        for (const line of fs.readFileSync(target, 'utf8').split('\n')) {
          let message; try { message = JSON.parse(line).message } catch { continue }
          for (const part of message?.content ?? []) {
            if (part.type === 'toolCall' && (part.name === tool || part.name?.endsWith('_' + tool)) && part.arguments?.path === file) {
              found.push({ execId: part.id, tool: part.name, path: file, sessionFile: path.relative(profile, target) })
            }
          }
        }
      }
    }
  }
  walk(base)
  return found
}
