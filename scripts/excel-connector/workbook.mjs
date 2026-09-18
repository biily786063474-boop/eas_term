import Workbook from 'exceljs/lib/doc/workbook.js'
import JSZip from 'jszip'
import {SaxesParser} from 'saxes'
const MAX=8*1024*1024,MAX_CELLS=50000
function keys(v,allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('参数无效')}
function text(v,max=32767){if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('文本无效');return v}
function sheetName(v){text(v,31);if(!v||/[\\/?*\[\]:]/.test(v))throw Error('工作表名称无效');return v}
function address(v){const m=typeof v==='string'&&/^([A-Z]{1,3})([1-9]\d{0,4})$/.exec(v);if(!m)throw Error('单元格地址无效');let col=0;for(const c of m[1])col=col*26+c.charCodeAt(0)-64;if(col>1000||Number(m[2])>10000)throw Error('单元格地址超出10000行/1000列');return v}
const allowedFunctions=new Set(['SUM','AVERAGE','MIN','MAX','COUNT','COUNTA','IF','AND','OR','NOT','ABS','ROUND','ROUNDUP','ROUNDDOWN'])
function value(v){
 if(v===null||typeof v==='boolean')return v
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('数值无效');return v}
 if(typeof v==='string')return text(v)
 keys(v,['formula'])
 const formula=text(v.formula,2048)
 if(!formula||/[^A-Za-z0-9_.$:+\-*/^%=<>() ,]/.test(formula)||formula.startsWith('='))throw Error('公式仅支持本表数值运算与白名单函数')
 for(const match of formula.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g))if(!allowedFunctions.has(match[1].toUpperCase()))throw Error('公式函数不支持')
 for(const match of formula.matchAll(/[A-Za-z_$][A-Za-z0-9_.$]*/g)){
  const word=match[0].toUpperCase(),rest=formula.slice(match.index+match[0].length)
  if(/^\s*\(/.test(rest)){if(!allowedFunctions.has(word))throw Error('公式函数不支持')}
  else if(!['TRUE','FALSE'].includes(word)){try{address(word.replaceAll('$',''))}catch{throw Error('公式只允许本表单元格引用')}}
 }
 return {formula}
}
async function encode(book){book.calcProperties.fullCalcOnLoad=true;const buffer=Buffer.from(await book.xlsx.writeBuffer());if(buffer.length>MAX)throw Error('XLSX超过8MB');return buffer}
export async function createWorkbook(args){
 keys(args,['sheets']);if(!Array.isArray(args.sheets)||!args.sheets.length||args.sheets.length>20||JSON.stringify(args).length>MAX/2)throw Error('工作簿大小无效')
 const book=new Workbook();book.creator='Eas-Term Excel';let count=0
 for(const sheet of args.sheets){keys(sheet,['name','rows']);const name=sheetName(sheet.name);if(book.worksheets.some(s=>s.name.toLowerCase()===name.toLowerCase()))throw Error('工作表重名')
  if(!Array.isArray(sheet.rows)||sheet.rows.length>10000)throw Error('行数无效')
  const ws=book.addWorksheet(name)
  for(const row of sheet.rows){if(!Array.isArray(row)||row.length>1000||(count+=row.length)>MAX_CELLS)throw Error('单元格过多');ws.addRow(row.map(value))}
 }
 return encode(book)
}
/** Inflate with an actual total cap before ExcelJS sees the archive; no XML entities or active content. */
async function load(buffer,editing=false){
 if(!Buffer.isBuffer(buffer)||buffer.length>MAX)throw Error('XLSX超过8MB')
 const zip=await JSZip.loadAsync(buffer),entries=Object.values(zip.files);if(entries.length>2000||!zip.file('xl/workbook.xml'))throw Error('XLSX结构无效')
 let expanded=0,cells=0,declared=0
 for(const f of entries){if(f.dir)continue
  if(/vbaProject|externalLinks|embeddings|_xmlsignatures|connections\.xml/i.test(f.name))throw Error('不支持宏、外部数据或签名工作簿')
  if(editing&&/drawings|charts|pivot|slicer|vml|printerSettings|customXml/i.test(f.name))throw Error('复杂工作簿仅可读取，拒绝丢失内容改写')
  const n=f._data?.uncompressedSize;if(!Number.isSafeInteger(n)||n<0||(declared+=n)>32*1024*1024)throw Error('XLSX展开超限')
  const chunks=[],stream=f.nodeStream();await new Promise((resolve,reject)=>{stream.on('error',reject);stream.on('end',resolve);stream.on('data',chunk=>{expanded+=chunk.length;if(expanded>32*1024*1024){stream.destroy();reject(Error('XLSX展开超限'));return}chunks.push(chunk)})})
  const bytes=Buffer.concat(chunks)
  if(/\.(xml|rels)$/i.test(f.name)){
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
   if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw Error('不支持XML实体')
   let depth=0;const parser=new SaxesParser({xmlns:true})
   parser.on('opentag',node=>{
    if(++depth>100)throw Error('XML嵌套超限')
    const attr=k=>node.attributes[k]?.value
    if(node.local==='Relationship'&&attr('TargetMode')==='External')throw Error('不支持外部关系')
    if(f.name.startsWith('xl/worksheets/')){
     if(node.local==='c'){if(++cells>MAX_CELLS)throw Error('单元格过多');address(attr('r'))}
     if(node.local==='row'&&(!/^\d+$/.test(attr('r')||'')||Number(attr('r'))>10000))throw Error('行地址无效')
     if(node.local==='col'&&Number(attr('max'))>1000)throw Error('列地址超限')
    }
   });parser.on('closetag',()=>depth--);parser.write(raw).close()
  }
 }
 const book=new Workbook();await book.xlsx.load(buffer)
 if(book.worksheets.length>20)throw Error('工作表过多')
 return book
}
function plain(v){
 if(v===null||typeof v!=='object')return v
 if(v instanceof Date)return {date:v.toISOString()}
 if(v.formula||v.sharedFormula)return {formula:v.formula??v.sharedFormula,...(v.result===undefined?{}:{cachedResult:v.result})}
 if(v.richText)return v.richText.map(t=>t.text).join('')
 if(v.error)return {error:v.error}
 return {unsupported:true}
}
export async function readWorkbook(buffer){const book=await load(buffer);const sheets=book.worksheets.map(ws=>{
 if(ws.rowCount>10000||ws.columnCount>1000)throw Error('工作表范围过大')
 const rows=[];let count=0
 for(let r=1;r<=ws.rowCount;r++){const row=ws.getRow(r);if((count+=row.cellCount)>MAX_CELLS)throw Error('单元格过多');const values=[];for(let c=1;c<=row.cellCount;c++)values.push(plain(row.getCell(c).value));rows.push(values)}
 return {name:ws.name,rows}
 });const result={sheets,calculated:false,note:'只读取公式及已有缓存，不执行计算；不代表完整图表/透视/排版还原'};if(JSON.stringify(result).length>4*1024*1024)throw Error('读取结果超过4MB');return result}
export async function updateWorkbook(buffer,args){
 keys(args,['sheet','cells']);sheetName(args.sheet);if(!Array.isArray(args.cells)||!args.cells.length||args.cells.length>1000)throw Error('修改单元格数量无效')
 const changes=args.cells.map(c=>{keys(c,['address','value']);return {address:address(c.address),value:value(c.value)}})
 if(new Set(changes.map(c=>c.address)).size!==changes.length)throw Error('修改地址重复')
 const book=await load(buffer,true),sheet=book.getWorksheet(args.sheet);if(!sheet)throw Error('工作表不存在')
 for(const c of changes){const cell=sheet.getCell(c.address);if(cell.isMerged)throw Error('暂不修改合并单元格');cell.value=c.value}
 return encode(book)
}
