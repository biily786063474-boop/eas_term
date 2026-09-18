// Binary adaptation of local-files/lib/files.mjs; same path/inode/link/write guards.
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
const hash=b=>createHash('sha256').update(b).digest('hex')
const MAX=8*1024*1024
export function createFiles(config){
 if(!config?.root||!['read','read-write'].includes(config.root.access))throw Error('缺少宿主目录授权')
 const root=fs.realpathSync(config.root.path),initial=fs.statSync(root)
 const active=()=>{const s=fs.statSync(root);if(!s.isDirectory()||s.dev!==initial.dev||s.ino!==initial.ino||fs.realpathSync(root)!==root)throw Error('授权目录已变化')}
 const inside=p=>p===root||p.startsWith(root+path.sep)
 function target(rel,missing=false){
  active()
  if(typeof rel!=='string'||rel.length>4096||rel.includes('\0')||path.isAbsolute(rel)||/[\\:]/.test(rel)||rel.split('/').some(x=>x==='..'||x==='.'||!x))throw Error('仅接受授权目录内相对路径')
  const file=path.join(root,rel),parent=fs.realpathSync(path.dirname(file))
  if(!inside(parent))throw Error('路径越出授权目录')
  const st=fs.lstatSync(file,{throwIfNoEntry:false})
  if(!st){if(missing)return file;throw Error('文件不存在')}
  if(st.isSymbolicLink()||!inside(fs.realpathSync(file))||st.isFile()&&st.nlink!==1)throw Error('不支持符号链接或多硬链接文件')
  return file
 }
 function read(rel){const file=target(rel),stat=fs.statSync(file);if(!stat.isFile()||stat.size>MAX)throw Error('仅支持不超过8MB的普通文件');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(fd);if(opened.dev!==stat.dev||opened.ino!==stat.ino)throw Error('文件已变化');const b=fs.readFileSync(fd);if(b.length>MAX)throw Error('文件过大');return b}finally{fs.closeSync(fd)}}
 return {
  list(args={}){
   if(Object.keys(args).some(k=>k!=='path'))throw Error('未知参数')
   active();const dir=args.path?target(args.path):root
   if(!fs.statSync(dir).isDirectory())throw Error('不是目录')
   const entries=fs.readdirSync(dir,{withFileTypes:true});return {entries:entries.slice(0,500).map(e=>({name:e.name,type:e.isSymbolicLink()?'symlink':e.isDirectory()?'directory':'file'})),truncated:entries.length>500}
  },
  read(args){if(!args||Object.keys(args).some(k=>k!=='path'))throw Error('参数无效');const b=read(args.path);return {buffer:b,sha256:hash(b)}},
  write(args){
   if(config.root.access!=='read-write')throw Error('目录只读')
   if(!args||Object.keys(args).some(k=>!['path','buffer','expectedSha256'].includes(k))||!Buffer.isBuffer(args.buffer)||Buffer.byteLength(args.buffer)>MAX)throw Error('DOCX参数无效或超过8MB')
   const file=target(args.path,true),exists=fs.existsSync(file)
   if(exists){if(typeof args.expectedSha256!=='string'||hash(read(args.path))!==args.expectedSha256)throw Error('覆盖前必须提供当前文件SHA256')}
   else if(args.expectedSha256!==undefined)throw Error('目标文件不存在，不能覆盖')
   const tmp=path.join(path.dirname(file),'.eas-write-'+randomUUID())
   try{
    fs.writeFileSync(tmp,args.buffer,{flag:'wx',mode:0o600});target(args.path,true)
    if(exists){if(hash(read(args.path))!==args.expectedSha256)throw Error('文件已变化');fs.renameSync(tmp,file)}
    else {fs.linkSync(tmp,file);fs.unlinkSync(tmp)}
    return {path:args.path,bytes:Buffer.byteLength(args.buffer),sha256:hash(Buffer.from(args.buffer))}
   }finally{try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT')throw e}}
  }
 }
}
