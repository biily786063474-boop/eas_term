import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
const require=createRequire(import.meta.url), React=require('react')
async function component(name) {
 const out=await build({entryPoints:[`src/renderer/src/features/agentChat/${name}.tsx`],bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,external:['react','react-dom','react-dom/server','react/jsx-runtime']})
 const m={exports:{}}; new Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);return m.exports[name]
}
test('default shortcuts expose three small labelled buttons, not permanent explanation',async()=>{
 const C=await component('ComposerActions')
 const html=renderToStaticMarkup(React.createElement(C,{picker:{close(){},activate(){}},text:'',chips:[]}))
 assert.match(html,/aria-label="发送内容预览"/)
 assert.doesNotMatch(html,/选择上下文，继续输入/)
 assert.match(html,/<svg/)
})
test('settings closed by default retains only labelled trigger',async()=>{
 const C=await component('ComposerSettings')
 const html=renderToStaticMarkup(React.createElement(C,{label:'默认模型'},React.createElement('select',{'aria-label':'内部模型'})))
 assert.match(html,/aria-expanded="false"/)
 assert.doesNotMatch(html,/内部模型/)
})
test('inherited role effort is described honestly rather than as CLI default',async()=>{
 const C=await component('EffortSlider')
 const html=renderToStaticMarkup(React.createElement(C,{levels:[{id:'high',label:'高'}],value:'',defaultDescription:'角色默认 · high',onChange(){}}))
 assert.match(html,/aria-valuetext="角色默认 · high"/)
 assert.doesNotMatch(html,/跟随 CLI 默认强度/)
})
