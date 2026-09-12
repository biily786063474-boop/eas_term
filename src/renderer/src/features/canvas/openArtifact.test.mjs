import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import vm from 'node:vm'
import {fileURLToPath} from 'node:url'
const code=(await build({entryPoints:[fileURLToPath(new URL('./openArtifact.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'fixture-store',setup(b){b.onResolve({filter:/^\.\.\/\.\.\/store$/},()=>({path:'fixture-store',external:true}))}}]})).outputFiles[0].text
function fixture(){const frame={id:'owned',nodes:[]},calls=[];const s={viewMode:'canvas',canvas:{frames:[frame]},focusCanvasNode:(f,id)=>calls.push(['focus',f,id]),addFileNode:(f,pane)=>frame.nodes.push({id:'new',pane}),addWebNode:(f,url)=>frame.nodes.push({id:'web',pane:{kind:'web',url}})};const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:()=>({useStore:{getState:()=>s}}),window:{dispatchEvent:e=>calls.push(['refresh',e.detail.nodeId])},CustomEvent:class{constructor(type,init){this.detail=init.detail}}});return{frame,calls,open:module.exports.openArtifact}}
test('明确提交一次新建，再次提交刷新原节点而非重复占位',()=>{const f=fixture(),pane={kind:'image',filePath:'/p/x.png'};assert.equal(f.open('owned',pane).reused,false);assert.equal(f.open('owned',pane).reused,true);assert.equal(f.frame.nodes.length,1);assert.ok(f.calls.some(c=>c[0]==='refresh'&&c[1]==='new'))})
test('不存在的 Frame 拒绝，不能落到其他 Frame',()=>{const f=fixture();assert.throws(()=>f.open('other',{kind:'code',filePath:'/p/x.md'}),/已关闭/);assert.equal(f.frame.nodes.length,0)})
