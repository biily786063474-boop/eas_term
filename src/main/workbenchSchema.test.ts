import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { McpClient } from './mcpClient.ts'

test('legacy entry serves exactly the shared packaged catalog, and remains empty outside Eas-Term', async () => {
  const schema = JSON.parse(readFileSync(new URL('../../mcp/workbench-tools.json', import.meta.url), 'utf8'))
  assert.equal(schema.length, 38)
  assert.equal(new Set(schema.map((tool: { name: string }) => tool.name)).size, schema.length)
  for (const managed of [false, true]) {
    const client = new McpClient({ name: 'schema-test', command: process.execPath, args: [fileURLToPath(new URL('../../mcp/eas-mcp.mjs', import.meta.url))], env: managed ? { EAS_TERM_PORT: '1', EAS_TERM_TOKEN: 'test-only' } : {}, cwd: process.cwd() })
    try {
      await client.initialize('test')
      assert.deepEqual(await client.listTools(), managed ? schema : [])
    } finally { client.close() }
  }
})

test('catalog annotations distinguish read-only inspection, additive local actions and unsafe operations', () => {
  const tools = JSON.parse(readFileSync(new URL('../../mcp/workbench-tools.json', import.meta.url), 'utf8'))
  const byName = new Map(tools.map((tool: any) => [tool.name, tool.annotations]))
  for (const tool of tools) {
    assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', tool.name)
    assert.equal(typeof tool.annotations?.destructiveHint, 'boolean', tool.name)
    assert.equal(typeof tool.annotations?.openWorldHint, 'boolean', tool.name)
  }
  for (const name of ['canvas_get_state', 'canvas_list_frames', 'todo_list', 'secret_check', 'wiki_query', 'team_status']) {
    assert.deepEqual(byName.get(name), { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, name)
  }
  for (const name of ['canvas_open_image', 'canvas_focus_node', 'canvas_maximize_node', 'canvas_add_note', 'notify', 'wiki_log']) {
    assert.deepEqual(byName.get(name), { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, name)
  }
  // File previews also accept executable HTML and may evict old content nodes.
  for (const name of ['canvas_open_file', 'canvas_open_html', 'canvas_open_url', 'team_spawn', 'team_send', 'canvas_new_terminal']) {
    assert.deepEqual(byName.get(name), { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, name)
  }
  // Snapshot can irreversibly clear annotations when the user's stored preference says so.
  for (const name of ['canvas_snapshot', 'canvas_close_node', 'wiki_archive_exec', 'team_dissolve', 'skill_categorize']) {
    assert.equal((byName.get(name) as any).destructiveHint, true, name)
    assert.equal((byName.get(name) as any).readOnlyHint, false, name)
  }
})
