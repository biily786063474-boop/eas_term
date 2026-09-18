import {Document,Paragraph,TextRun,Packer,HeadingLevel} from 'docx'
import JSZip from 'jszip'
import xml from 'xml-js'
const MAX=8*1024*1024
const element=(name,elements=[],attributes)=>({type:'element',name,...(attributes?{attributes}:{}),elements})
const textElement=(name,text)=>element(name,[{type:'text',text}],{'xml:space':'preserve'})
function keys(v,allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('参数无效')}
function text(v,max=100000){if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('文本参数无效');return v}
export async function createDocument(args){
 keys(args,['title','paragraphs'])
 if(!Array.isArray(args.paragraphs)||!args.paragraphs.length||args.paragraphs.length>1000)throw Error('段落参数无效')
 const paragraphs=args.paragraphs.map(p=>{
  keys(p,['text','heading','bold','italic'])
  for(const k of ['bold','italic'])if(p[k]!==undefined&&typeof p[k]!=='boolean')throw Error('格式参数无效')
  if(p.heading!==undefined&&(!Number.isInteger(p.heading)||p.heading<1||p.heading>6))throw Error('标题参数无效')
  return new Paragraph({children:[new TextRun({text:text(p.text),bold:p.bold,italics:p.italic})],...(p.heading?{heading:HeadingLevel['HEADING_'+p.heading]}:{})})
 })
 if(JSON.stringify(args).length>MAX/2)throw Error('文档过大')
 if(args.title!==undefined)paragraphs.unshift(new Paragraph({text:text(args.title,1000),heading:HeadingLevel.TITLE}))
 return Packer.toBuffer(new Document({sections:[{children:paragraphs}]}))
}
async function unpack(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length>MAX)throw Error('DOCX超过8MB')
 const zip=await JSZip.loadAsync(buffer),entries=Object.values(zip.files)
 if(entries.length>2000)throw Error('DOCX条目过多')
 let size=0
 for(const f of entries){
  if(f.dir)continue
  const n=f._data?.uncompressedSize
  if(!Number.isSafeInteger(n)||n<0||(size+=n)>32*1024*1024)throw Error('DOCX展开体积超限')
  if(/vbaProject|^_xmlsignatures\//i.test(f.name))throw Error('不支持宏或已签名文档')
 }
 const entry=zip.file('word/document.xml');if(!entry)throw Error('不是Word DOCX')
 // Metadata alone is not a decompression bound: hostile ZIPs may lie about size.
 // Materialize each entry through a capped stream before parsing/repacking.
 let expanded=0,documentBytes
 for(const f of entries){
  if(f.dir)continue
  const chunks=[];let entryBytes=0
  const stream=f.nodeStream()
  await new Promise((resolve,reject)=>{
   stream.on('error',reject);stream.on('end',resolve)
   stream.on('data',chunk=>{
    expanded+=chunk.length;entryBytes+=chunk.length
    if(expanded>32*1024*1024||f.name==='word/document.xml'&&entryBytes>MAX){stream.destroy();reject(Error('DOCX展开体积超限'));return}
    chunks.push(chunk)
   })
  })
  const bytes=Buffer.concat(chunks)
  if(f.name==='word/document.xml')documentBytes=bytes
  zip.file(f.name,bytes)
 }
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(documentBytes)
 if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw Error('不支持XML实体声明')
 const doc=xml.xml2js(raw,{compact:false}),document=doc.elements?.find(e=>e.name==='w:document'),body=document?.elements?.find(e=>e.name==='w:body')
 if(!body)throw Error('不支持此Word命名空间或文档结构')
 return {zip,doc,paragraphs:(body.elements??[]).filter(e=>e.name==='w:p')}
}
function collect(node,name){return [...(node.name===name?[node]:[]),...(node.elements??[]).flatMap(e=>collect(e,name))]}
function content(node,name){return collect(node,name).map(e=>(e.elements??[]).filter(x=>x.type==='text').map(x=>x.text).join('')).join('')}
export async function readDocument(buffer){
 const {paragraphs}=await unpack(buffer)
 return {scope:'正文顶层段落；不含表格、页眉页脚或文本框',paragraphs:paragraphs.map((p,index)=>({index,text:content(p,'w:t'),deletedText:content(p,'w:delText'),tracked:!!(collect(p,'w:ins').length+collect(p,'w:del').length)}))}
}
export async function reviseDocument(buffer,args){
 keys(args,['paragraph','text','author'])
 if(!Number.isInteger(args.paragraph)||args.paragraph<0)throw Error('段落索引无效')
 if(typeof args.author!=='string'||!args.author.trim()||args.author.length>100)throw Error('修订作者无效')
 text(args.text);text(args.author)
 const {zip,doc,paragraphs}=await unpack(buffer),p=paragraphs[args.paragraph]
 if(!p)throw Error('段落不存在')
 if(collect(p,'w:ins').length||collect(p,'w:del').length)throw Error('该段落已有修订，请先在Word处理')
 // Never silently remove fields, links, drawings, bookmarks or other unsupported content.
 if((p.elements??[]).some(e=>e.type!=='element'||!['w:pPr','w:r'].includes(e.name)))throw Error('段落包含暂不支持的结构')
 const runs=(p.elements??[]).filter(e=>e.name==='w:r')
 if(runs.some(r=>(r.elements??[]).some(e=>e.type!=='element'||!['w:rPr','w:t'].includes(e.name))))throw Error('段落包含暂不支持的字段或内容')
 const ids=collect(doc,'w:ins').concat(collect(doc,'w:del')).map(e=>Number(e.attributes?.['w:id']||0))
 if(ids.some(n=>!Number.isSafeInteger(n)||n<0||n>1000000000))throw Error('已有修订编号无效')
 const id=Math.max(0,...ids)+1,attributes={'w:author':args.author,'w:date':new Date().toISOString()}
 const deleted=structuredClone(runs)
 for(const run of deleted)for(const e of run.elements??[])if(e.name==='w:t')e.name='w:delText'
 const style=runs[0]?.elements?.find(e=>e.name==='w:rPr')
 p.elements=[...(p.elements??[]).filter(e=>e.name==='w:pPr'),element('w:del',deleted,{...attributes,'w:id':String(id)}),element('w:ins',[element('w:r',[...(style?[structuredClone(style)]:[]),textElement('w:t',args.text)])],{...attributes,'w:id':String(id+1)})]
 zip.file('word/document.xml',xml.js2xml(doc,{compact:false}))
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
}
