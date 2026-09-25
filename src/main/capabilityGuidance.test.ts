import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCapabilityGuidance } from './capabilityGuidance.ts'

test('guidance is session-scoped, short, conditional and never equates installed with connected', () => {
  const options = { preferences: { workbench: true, bizone: true, guidance: true }, directory: '/安装 包/指引', version: '1', bizoneInstalled: false }
  const text = buildCapabilityGuidance(options)
  assert.match(text, /page_live_open/)
  assert.match(text, /依赖未找到/)
  assert.match(text, /实际工具清单/)
  assert.match(text, /安装 包/)
  assert.ok(text.length < 800)
  assert.equal(buildCapabilityGuidance({ ...options, preferences: { ...options.preferences, guidance: false } }), '')
  assert.match(buildCapabilityGuidance({ ...options, preferences: { ...options.preferences, workbench: false, bizone: false } }), /工作台模块已禁用/)
  assert.doesNotMatch(buildCapabilityGuidance({ ...options, preferences: { ...options.preferences, workbench: false, bizone: false } }), /canvas\.md/)
})

test('long guidance directory is sent once without removing safety routes',()=>{
 const directory='/Applications/Eas-Term.app/Contents/Resources/plugins/eas-capabilities/guidance'
 const text=buildCapabilityGuidance({preferences:{guidance:true,workbench:true,bizone:true},directory,version:'1',bizoneInstalled:true})
 assert.equal(text.split(directory).length-1,1)
 for(const word of ['SKILL.md','canvas.md','secrets.md','generate.md','plugins.md','先报价再确认','不重复生成','原有规则'])assert.ok(text.includes(word),word)
})
