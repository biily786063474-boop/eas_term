import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {clampContent,CONTENT_MIN,CONTENT_MAX} from '../canvas/zoomMath.ts'
const source=ts.createSourceFile('WebView.tsx',fs.readFileSync(new URL('./WebView.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='WebView')!
const js=ts.transpileModule(fn.getText(source).replace('export function','function'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText
const render=runInNewContext(js+';WebView',{React:{createElement:(type:any,props:any,...children:any[])=>({type,props:props??{},children})},useRef:(current:any)=>({current}),useState:(v:any)=>[v,()=>{}],useEffect:()=>{},useStore:{getState:()=>({})},parseFavoriteRoute:()=>null,FavoritesPanel:'favorites',ChevronLeftIcon:'left',ChevronRightIcon:'right',RefreshIcon:'refresh',CloseIcon:'close',GlobeIcon:'globe',MinusIcon:'minus',PlusIcon:'plus',clampContent,CONTENT_MIN,CONTENT_MAX})
const flat=(n:any):any[]=>!n||typeof n!=='object'?[]:[n,...(n.children??[]).flatMap((x:any)=>Array.isArray(x)?x.flatMap(flat):flat(x))]
test('最大化浏览器提供独立缩小/比例复位/放大，使用受限内容比例',()=>{
 const values:number[]=[]
 const tree=flat(render({url:'about:blank',zoom:1.15,onZoomChange:(v:number)=>values.push(v)}))
 for(const label of ['缩小网页','重置网页比例','放大网页']){
  const button=tree.find(n=>n.props['aria-label']===label);assert.ok(button,label+'必须可见');button.props.onClick()
 }
 assert.deepEqual(values,[1,1,clampContent(1.15*1.15)])
 assert.ok(tree.some(n=>n.props['aria-label']==='重置网页比例'&&n.children.join('')==='115%'))
 for(const [zoom,label] of [[CONTENT_MIN,'缩小网页'],[CONTENT_MAX,'放大网页']] as const){
  assert.equal(flat(render({url:'about:blank',zoom,onZoomChange:()=>{}})).find(n=>n.props['aria-label']===label).props.disabled,true)
 }
})
test('非最大化浏览器不增加比例栏，避免混用画布缩放',()=>{
 assert.equal(flat(render({url:'about:blank',zoom:1})).some(n=>n.props['aria-label']==='网页显示比例'),false)
})
