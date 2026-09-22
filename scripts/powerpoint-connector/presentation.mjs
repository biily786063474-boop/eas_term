import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import {SaxesParser} from 'saxes'
import path from 'node:path'
const MAX=8*1024*1024,EXPANDED=32*1024*1024
const DRAW='http://schemas.openxmlformats.org/drawingml/2006/main'
const PRES='http://schemas.openxmlformats.org/presentationml/2006/main'
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
function keys(v,allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('参数无效')}
function text(v,max){if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('文本无效');return v}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
function parse(raw,visit=()=>{},close=()=>{},ontext=()=>{}){
 if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw Error('不支持XML实体')
 const parser=new SaxesParser({xmlns:true});let depth=0
 parser.on('opentag',n=>{if(++depth>100)throw Error('XML嵌套超限');visit(n,parser.position,depth)})
 parser.on('closetag',n=>{close(n,parser.position,depth);depth--})
 parser.on('text',ontext);parser.on('cdata',ontext);parser.write(raw).close()
}
async function encoded(zip){const buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});if(buffer.length>MAX)throw Error('PPTX超过8MB');return buffer}
export async function createPresentation(args){
 keys(args,['slides']);if(!Array.isArray(args.slides)||!args.slides.length||args.slides.length>100||JSON.stringify(args).length>1024*1024)throw Error('幻灯片数量/大小无效')
 const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='Eas-Term PowerPoint';pptx.subject='Text presentation'
 for(const item of args.slides){
  keys(item,['title','body']);const title=text(item.title,2000),body=item.body===undefined?'':text(item.body,10000)
  const slide=pptx.addSlide();slide.background={color:'FFFFFF'}
  slide.addText(title,{x:0.6,y:0.4,w:12.1,h:1,fontSize:28,bold:true,color:'111111',breakLine:false,fit:'shrink'})
  if(body)slide.addText(body,{x:0.6,y:1.6,w:12.1,h:5.2,fontSize:20,color:'222222',valign:'top',fit:'shrink'})
 }
 const bytes=Buffer.from(await pptx.write({outputType:'nodebuffer',compression:true}));if(bytes.length>MAX)throw Error('PPTX超过8MB');return bytes
}
async function load(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length>MAX)throw Error('PPTX超过8MB')
 const zip=await JSZip.loadAsync(buffer),files=Object.values(zip.files),xml=new Map()
 if(files.length>2000||!zip.file('ppt/presentation.xml'))throw Error('PPTX结构无效')
 let expanded=0,declared=0
 for(const f of files){if(f.dir)continue
  if(/vbaProject|embeddings|activeX|_xmlsignatures/i.test(f.name))throw Error('不支持宏、嵌入对象或签名')
  if(f.unsafeOriginalName&&f.unsafeOriginalName!==f.name||f.name.startsWith('/')||f.name.split('/').includes('..'))throw Error('ZIP路径无效')
  const n=f._data?.uncompressedSize;if(!Number.isSafeInteger(n)||n<0||(declared+=n)>EXPANDED)throw Error('PPTX展开超限')
  const parts=[],stream=f.nodeStream();await new Promise((resolve,reject)=>{stream.on('error',reject);stream.on('end',resolve);stream.on('data',c=>{expanded+=c.length;if(expanded>EXPANDED){stream.destroy();reject(Error('PPTX展开超限'));return}parts.push(c)})})
  if(/\.(xml|rels)$/i.test(f.name)){
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))
   parse(raw,node=>{
    if(node.local!=='Relationship')return
    const target=node.attributes.Target?.value||'',type=node.attributes.Type?.value||''
    if(node.attributes.TargetMode?.value==='External'||/^[a-z][a-z0-9+.-]*:|^[/\\]/i.test(target))throw Error('不支持外部关系')
    if(/\/(vbaProject|oleObject|package|control|activeXControl|activeXControlBinary)$/i.test(type))throw Error('不支持活动内容关系')
   })
   xml.set(f.name,raw)
  }
 }
 const relationships=new Map()
 parse(xml.get('ppt/_rels/presentation.xml.rels')||'',node=>{
  if(node.local!=='Relationship')return
  const id=node.attributes.Id?.value,target=node.attributes.Target?.value,type=node.attributes.Type?.value
  if(!id||!target||relationships.has(id)||target.includes('\\')||target.startsWith('/')||target.includes(':'))throw Error('幻灯片关系无效')
  relationships.set(id,{name:path.posix.normalize('ppt/'+target),type})
 })
 const slides=[]
 parse(xml.get('ppt/presentation.xml'),node=>{
  if(node.uri!==PRES||node.local!=='sldId')return
  const id=Object.values(node.attributes).find(a=>a.uri===REL&&a.local==='id')?.value,rel=relationships.get(id)
  if(!rel||rel.type!==REL+'/slide'||!/^ppt\/slides\/[^/]+\.xml$/.test(rel.name)||!xml.has(rel.name)||slides.includes(rel.name))throw Error('幻灯片关系无效')
  slides.push(rel.name)
 })
 if(!slides.length||slides.length>100)throw Error('幻灯片数量无效')
 return {zip,xml,slides}
}
function runs(raw){
 const result=[];let current=null
 parse(raw,(node,pos,depth)=>{
  if(current)throw Error('文本节点嵌套无效')
  if(node.uri===DRAW&&node.local==='t')current={start:pos,end:pos,text:'',depth,selfClosing:node.isSelfClosing}
 },(node,pos,depth)=>{
  if(current&&depth===current.depth){
   current.end=current.selfClosing?current.start:raw.lastIndexOf('<',pos-1)
   result.push(current);current=null
   if(result.length>10000)throw Error('文本数量超限')
  }
 },t=>{if(current)current.text+=t})
 return result
}
export async function readPresentation(buffer){
 const {xml,slides}=await load(buffer)
 const result={slides:slides.map((name,index)=>({index,texts:runs(xml.get(name)).map(r=>r.text)})),note:'按幻灯片顺序提取文本，不渲染图表、图片或排版。'}
 if(JSON.stringify(result).length>4*1024*1024)throw Error('读取结果过大');return result
}
export async function editPresentation(buffer,args){
 keys(args,['slide','textIndex','text']);text(args.text,10000)
 const {zip,xml,slides}=await load(buffer)
 if(!Number.isInteger(args.slide)||args.slide<0||args.slide>=slides.length)throw Error('幻灯片索引无效')
 const name=slides[args.slide],raw=xml.get(name),items=runs(raw)
 if(!Number.isInteger(args.textIndex)||args.textIndex<0||args.textIndex>=items.length)throw Error('文本索引无效')
 const run=items[args.textIndex];if(run.selfClosing)throw Error('暂不编辑自闭合空文本节点')
 zip.file(name,raw.slice(0,run.start)+escape(args.text)+raw.slice(run.end))
 return encoded(zip)
}
