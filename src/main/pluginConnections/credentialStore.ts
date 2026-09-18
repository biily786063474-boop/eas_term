import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
import {OAuthTokensSchema,type OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'

export interface CredentialScope {plugin:string;issuer:string;resource:string;account:string}
export interface CredentialProtection {assertActive():void;seal(value:string):string;open(cipher:string):string}
function identity(scope:CredentialScope){
 if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(scope.plugin))throw Error('插件身份无效')
 for(const value of [scope.issuer,scope.resource,scope.account])if(typeof value!=='string'||!value||value.length>4096)throw Error('凭证作用域无效')
 return JSON.stringify([scope.plugin,scope.issuer,scope.resource,scope.account])
}
/** Only construct with a main-process-owned userData subdirectory, never an IPC path.
 * Synchronous atomic replacement prevents lock/unload callbacks interleaving with commit.
 * No token cache; all reads re-check the vault lease and decrypt on demand.
 */
export class PluginCredentialStore {
 private readonly directory:string
 private readonly now:()=>number
 constructor(directory:string,now:()=>number=Date.now){this.directory=path.resolve(directory);this.now=now}
 private file(scope:CredentialScope){return path.join(this.directory,createHash('sha256').update(identity(scope)).digest('hex')+'.json')}
 private checkDirectory(create=false){
  if(create)fs.mkdirSync(this.directory,{recursive:true,mode:0o700})
  if(fs.realpathSync(this.directory)!==this.directory||!fs.lstatSync(this.directory).isDirectory())throw Error('凭证目录不能经过符号链接')
 }
 private checkFile(file:string){
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>256*1024)throw Error('凭证文件类型或大小不安全')}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 }
 load(scope:CredentialScope,protection:CredentialProtection):OAuthTokens|undefined {
  protection.assertActive();const file=this.file(scope)
  if(!fs.existsSync(this.directory))return undefined
  this.checkDirectory();this.checkFile(file)
  let cipher:string
  try{cipher=fs.readFileSync(file,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}
  try{
   const payload=JSON.parse(protection.open(cipher))
   if(payload.version!==1||payload.scope!==identity(scope))throw Error('scope')
   const tokens=OAuthTokensSchema.parse(payload.tokens)
   if(tokens.expires_in!==undefined){
    if(typeof payload.savedAt!=='number'||!Number.isFinite(payload.savedAt)||payload.savedAt>this.now())tokens.expires_in=0
    else tokens.expires_in=Math.max(0,tokens.expires_in-Math.ceil((this.now()-payload.savedAt)/1000))
   }
   protection.assertActive();return tokens
  }catch{throw Error('插件凭证损坏或作用域不匹配，请重新授权')}
 }
 save(scope:CredentialScope,tokens:OAuthTokens,protection:CredentialProtection){
  protection.assertActive();const file=this.file(scope)
  const payload=JSON.stringify({version:1,savedAt:this.now(),scope:identity(scope),tokens:OAuthTokensSchema.parse(tokens)})
  if(Buffer.byteLength(payload)>64*1024)throw Error('插件凭证大小超限')
  const cipher=protection.seal(payload)
  this.checkDirectory(true);this.checkFile(file)
  const tmp=file+'.'+randomBytes(12).toString('hex')+'.tmp'
  try{
   fs.writeFileSync(tmp,cipher,{encoding:'utf8',mode:0o600,flag:'wx'})
   fs.chmodSync(tmp,0o600)
   protection.assertActive();fs.renameSync(tmp,file)
  }finally{try{fs.unlinkSync(tmp)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
 }
 /** Local removal needs no decryption/unlock; caller must first invalidate active requests. */
 remove(scope:CredentialScope){
  const file=this.file(scope);if(!fs.existsSync(this.directory))return
  this.checkDirectory();this.checkFile(file)
  try{fs.unlinkSync(file)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 }
}
