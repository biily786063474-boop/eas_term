import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'

test('安装完成后的启动卡片应提示登录，不再提示安装', async () => {
  const out = await build({ entryPoints: ['src/renderer/src/features/agentChat/StartupSetupCard.tsx'], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, external: ['react', 'react/jsx-runtime'] })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', out.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const { StartupSetupCard } = module.exports
  const React = createRequire(import.meta.url)('react')
  const cli = { id: 'codex', displayName: 'Codex', auth: 'cli-login', available: true, chatSupported: true, installCmd: 'official' }
  const html = renderToStaticMarkup(React.createElement(StartupSetupCard, {cli, detecting:false, blockedByAuth:true, error:null, alternatives:[], onPick(){}, onSetup(){}, onRefresh(){} }))
  assert.match(html, /Codex · 待登录/)
  assert.match(html, /登录并继续/)
  assert.doesNotMatch(html, /未安装|安装并继续/)
})
