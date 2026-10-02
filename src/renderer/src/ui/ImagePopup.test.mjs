import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import vm from 'node:vm'
import {fileURLToPath} from 'node:url'
const code=(await build({entryPoints:[fileURLToPath(new URL('./ImagePopup.tsx',import.meta.url))],jsx:'automatic',bundle:true,write:false,platform:'node',format:'cjs',external:['react','react-dom','react/jsx-runtime'],loader:{'.css':'empty'}})).outputFiles[0].text
function fixture(){
 const effects=[],calls=[];let closed=0
 const jsx=(type,props)=>({type,props}),module={exports:{}}
 const prior={isConnected:true,focus:opts=>calls.push(['focus',opts.preventScroll])}
 vm.runInNewContext(code,{module,exports:module.exports,document:{activeElement:prior,body:{}},require:n=>n==='react'?{useRef:()=>({current:{showModal:()=>calls.push('open'),close:()=>calls.push('close')}}),useEffect:fn=>effects.push(fn)}:n==='react-dom'?{createPortal:x=>x}:{jsx,jsxs:jsx}})
 const tree=module.exports.ImagePopup({src:'fixture.png',onClose:()=>closed++})
 return {tree,calls,mount:()=>effects[0](),get closed(){return closed}}
}
test('使用原生 modal；卸载恢复焦点且不滚动',()=>{const f=fixture(),cleanup=f.mount();assert.equal(f.tree.type,'dialog');assert.equal(f.calls[0],'open');cleanup();assert.deepEqual(f.calls,['open','close',['focus',true]])})
test('Esc、遮罩、关闭按钮关闭；图片内部点击不关闭',()=>{const f=fixture();let prevented=false;f.tree.props.onCancel({preventDefault(){prevented=true}});assert.ok(prevented);const target={};f.tree.props.onClick({target,currentTarget:target});f.tree.props.onClick({target:{},currentTarget:target});f.tree.props.children[0].props.onClick();assert.equal(f.closed,3)})
test('有图走可缩放舞台；弹窗里的滚轮/按下/键盘不冒泡到画布',()=>{const f=fixture();const stage=f.tree.props.children[1];assert.equal(stage.type.name,'ZoomableImage');assert.equal(stage.props.src,'fixture.png');let stopped=0;const ev={stopPropagation(){stopped++}};f.tree.props.onWheel(ev);f.tree.props.onMouseDown(ev);f.tree.props.onKeyDown(ev);assert.equal(stopped,3)})
