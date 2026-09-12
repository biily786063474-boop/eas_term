import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
const code = (await build({entryPoints:[fileURLToPath(new URL('./CodeView.tsx',import.meta.url))], bundle:true, write:false, platform:'node', format:'cjs', jsx:'automatic', plugins:[{name:'isolate',setup(b){b.onResolve({filter:/.*/},a=>a.kind==='entry-point'?undefined:{path:a.path,external:true})}}]})).outputFiles[0].text
function fixture() {
  const effects=[], views=[], warnings=[]; let stateIndex=0, resolveLanguage, rejectLanguage
  const language = new Promise((resolve,reject)=>{resolveLanguage=resolve;rejectLanguage=reject})
  class EditorView {
    static theme(){return []} static updateListener={of:()=>[]}
    constructor(options){this.options=options;this.dispatched=[];views.push(this)}
    dispatch(value){this.dispatched.push(value)} destroy(){this.destroyed=true} focus(){this.focused=true}
  }
  class Compartment {of(v){return v} reconfigure(v){return v}}
  const jsx=(type,props)=>({type,props}), module={exports:{}}
  const imports={react:{useState:v=>{const i=stateIndex++;return [i===2?'# fixture':i===4?true:v,()=>{}]},useRef:v=>({current:v}),useEffect:f=>effects.push(f),useCallback:f=>f},'react-dom':{createPortal:v=>v},'react/jsx-runtime':{jsx,jsxs:jsx},codemirror:{EditorView,basicSetup:[]},'@codemirror/state':{EditorState:{create:x=>x,readOnly:{of:x=>x}},Compartment},'@codemirror/language':{LanguageDescription:{matchFilename:()=>({load:()=>language})}},'@codemirror/language-data':{languages:[]},'@codemirror/theme-one-dark':{oneDark:[]},'./markdown':{bindCodeCopy:()=>()=>{},renderMarkdown:()=>''},'./frontmatter':{splitFrontmatter:()=>null},'../../ui/Icons':{},'./editor.css':{}}
  vm.runInNewContext(code,{module,exports:module.exports,require:n=>imports[n],console:{warn:(...x)=>warnings.push(x)},setTimeout,clearTimeout})
  const tree=module.exports.CodeView({filePath:'/fixture.md'})
  function attach(node){if(!node||typeof node!=='object')return;if(node.props?.className==='code-view-host')node.props.ref.current={};for(const child of [node.props?.children].flat())attach(child)}
  attach(tree)
  return {effects, views,warnings, resolveLanguage,rejectLanguage}
}
test('高亮模块未返回时正文编辑器已创建且可编辑；失败仍可用',async()=>{
  const f=fixture(); const cleanup=f.effects[1]()
  assert.equal(f.views.length,1)
  assert.equal(f.views[0].options.state.doc,'# fixture')
  assert.ok(f.views[0].options.state.extensions.includes(false),'readOnly=false')
  f.rejectLanguage(new Error('ERR_FILE_NOT_FOUND'))
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(f.views.length,1)
  assert.equal(f.views[0].destroyed,undefined)
  assert.equal(f.warnings.length,1)
  cleanup()
})
test('卸载后迟到高亮不得写入旧编辑器',async()=>{
  const f=fixture();const cleanup=f.effects[1]()
  assert.equal(f.views.length,1)
  cleanup(); f.resolveLanguage(['highlight'])
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(f.views[0].destroyed,true)
  assert.equal(f.views[0].dispatched.length,0)
})
