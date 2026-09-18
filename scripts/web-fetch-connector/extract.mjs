import {Parser} from 'htmlparser2'
const omitted=new Set(['script','style','template','noscript','iframe','svg','canvas','head'])
const blocks=new Set(['p','div','main','article','section','header','footer','nav','h1','h2','h3','h4','h5','h6','li','tr','br','hr','blockquote','pre'])
/** No DOM/browser execution, subresource requests or hidden form field extraction. */
export function extractPage(body,contentType,base){
 if(typeof body!=='string'||Buffer.byteLength(body)>2*1024*1024)throw Error('网页超过2MB')
 const type=contentType.split(';')[0].trim().toLowerCase()
 if(type==='text/plain')return {title:'',text:body.slice(0,50000),truncated:body.length>50000,links:[]}
 if(type!=='text/html')throw Error('不支持的网页类型')
 const stack=[],links=[];let text='',title='',total=0
 const append=value=>{total+=value.length;if(text.length<50001)text+=value.slice(0,50001-text.length)}
 const parser=new Parser({
  onopentag(name,attrs){
   const parent=stack.at(-1),skip=!!parent?.skip||omitted.has(name)||Object.hasOwn(attrs,'hidden')||attrs['aria-hidden']==='true'
   const node={name,skip,title:name==='title',anchor:name==='a'&&!skip?{href:attrs.href,text:''}:null};stack.push(node)
   if(!skip&&blocks.has(name))append('\n')
  },
  ontext(value){
   if(stack.some(n=>n.title)){title=(title+value).slice(0,500);return}
   if(stack.at(-1)?.skip)return
   append(value)
   for(let i=stack.length-1;i>=0;i--)if(stack[i].anchor){const a=stack[i].anchor;a.text=(a.text+value).slice(0,300);break}
  },
  onclosetag(){
   const node=stack.pop();if(!node)return
   if(!node.skip&&blocks.has(node.name))append('\n')
   if(node.anchor?.href&&links.length<100){try{
    const url=new URL(node.anchor.href,base)
    if(url.protocol==='https:'&&!url.username&&!url.password&&url.href.length<=4096&&!links.some(l=>l.url===url.href))links.push({text:node.anchor.text.trim(),url:url.href})
   }catch{}}
  }
 },{decodeEntities:true})
 parser.end(body)
 return {title:title.trim(),text:text.replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,50000),truncated:total>50000,links}
}
