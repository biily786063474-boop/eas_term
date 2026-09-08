import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('启动内置能力不重写用户全局 MCP、禁用设置或旧版配置', () => {
  const source = ts.createSourceFile('mcpBridge.ts', readFileSync(new URL('./mcpBridge.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'setupAgents')!
  const code = ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const mutations: string[] = []
  const setup = runInNewContext(code + '\nsetupAgents', {
    serverScriptPath: () => '/installed/eas-mcp.mjs', fs: { existsSync: () => true },
    shouldAutoInstall: () => true, readOptOut: () => false,
    removeLegacyAgentShims: () => mutations.push('remove-shims'),
    writeClaudeConfig: () => mutations.push('claude'), writeCodexConfig: () => mutations.push('codex'),
    purgeLegacyDshMcp: () => mutations.push('dsh'), console: { log() {} }
  })
  setup()
  assert.deepEqual(mutations, [])
})
