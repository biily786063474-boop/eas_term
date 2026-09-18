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
 private file(scope:CredentialScope,kind:'oauth'|'configuration'|'dynamic-oauth'='oauth'){return path.join(this.directory,scope.plugin+'-'+createHash('sha256').update(identity(scope)+(kind==='oauth'?'':'\n'+kind)).digest('hex')+'.json')}
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
  this.writePayload(file,payload,protection)
 }
 /** Dynamic public client and tokens form one atomic encrypted record; never two files. */
 saveDynamicAuthorization(scope:CredentialScope,value:{clientId:string;tokens:OAuthTokens},protection:CredentialProtection){
  protection.assertActive();assertClientId(value.clientId)
  const payload=JSON.stringify({version:3,kind:'dynamic-oauth',scope:identity(scope),savedAt:this.now(),clientId:value.clientId,tokens:OAuthTokensSchema.parse(value.tokens)})
  this.writePayload(this.file(scope,'dynamic-oauth'),payload,protection)
 }
 loadDynamicAuthorization(scope:CredentialScope,protection:CredentialProtection):{clientId:string;tokens:OAuthTokens}|undefined{
  protection.assertActive();const file=this.file(scope,'dynamic-oauth')
  if(!fs.existsSync(this.directory))return undefined
  this.checkDirectory();this.checkFile(file)
  let cipher:string
  try{cipher=fs.readFileSync(file,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}
  try{
   const payload=JSON.parse(protection.open(cipher))
   if(payload.version!==3||payload.kind!=='dynamic-oauth'||payload.scope!==identity(scope))throw Error('scope')
   assertClientId(payload.clientId)
   const tokens=OAuthTokensSchema.parse(payload.tokens)
   if(tokens.expires_in!==undefined){
    if(typeof payload.savedAt!=='number'||!Number.isFinite(payload.savedAt)||payload.savedAt>this.now())tokens.expires_in=0
    else tokens.expires_in=Math.max(0,tokens.expires_in-Math.ceil((this.now()-payload.savedAt)/1000))
   }
   protection.assertActive();return {clientId:payload.clientId,tokens}
  }catch{throw Error('插件动态授权损坏或作用域不匹配，请重新授权')}
 }
 removeDynamicAuthorization(scope:CredentialScope){
  const file=this.file(scope,'dynamic-oauth');if(!fs.existsSync(this.directory))return
  this.checkDirectory();this.checkFile(file)
  try{fs.unlinkSync(file)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 }
 private writePayload(file:string,payload:string,protection:CredentialProtection){
  protection.assertActive()
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
 /** Configuration values are never OAuth tokens, even under the same scope.
  * Scope must include the installed connection + schema identity chosen by main.
  * All values (including ordinary strings) are encrypted; no renderer readback here.
  */
 saveConfiguration(scope:CredentialScope,values:unknown,protection:CredentialProtection){
  protection.assertActive()
  const payload=JSON.stringify({version:2,kind:'configuration',scope:identity(scope),values:configurationValues(values)})
  this.writePayload(this.file(scope,'configuration'),payload,protection)
 }
 loadConfiguration(scope:CredentialScope,protection:CredentialProtection):Record<string,string>|undefined{
  protection.assertActive();const file=this.file(scope,'configuration')
  if(!fs.existsSync(this.directory))return undefined
  this.checkDirectory();this.checkFile(file)
  let cipher:string
  try{cipher=fs.readFileSync(file,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}
  try{
   const payload=JSON.parse(protection.open(cipher))
   if(payload.version!==2||payload.kind!=='configuration'||payload.scope!==identity(scope))throw Error('scope')
   const values=configurationValues(payload.values)
   protection.assertActive();return values
  }catch{throw Error('插件配置损坏或作用域不匹配，请重新配置')}
 }
 /** Remove all configurations/accounts for one plugin without unlocking/decrypting.
  * Owner prefix is deliberately non-secret; encrypted payload remains scope-bound.
  * This is the pre-release storage layout, not a migration of other apps' credentials.
  */
 removePlugin(plugin:string){
  if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(plugin))throw Error('插件身份无效')
  if(!fs.existsSync(this.directory))return
  this.checkDirectory()
  const pattern=new RegExp('^'+plugin+'-[a-f0-9]{64}\\.json$')
  const files=fs.readdirSync(this.directory).filter(name=>pattern.test(name)).map(name=>path.join(this.directory,name))
  for(const file of files)this.checkFile(file)
  for(const file of files){try{fs.unlinkSync(file)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
 }
 /** Local removal needs no decryption/unlock; caller must first invalidate active requests. */
 remove(scope:CredentialScope){
  const file=this.file(scope);if(!fs.existsSync(this.directory))return
  this.checkDirectory();this.checkFile(file)
  try{fs.unlinkSync(file)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 }
}

/** Storage envelope bounds only; field/type/grant validation is mandatory upstream. */
function configurationValues(raw:unknown):Record<string,string>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('插件配置值必须是对象')
 const entries=Object.entries(raw)
 if(entries.length>32)throw Error('插件配置字段超限')
 for(const [id,value] of entries){
  if(!/^[a-z][a-z0-9-]{0,39}$/.test(id)||typeof value!=='string'||value.length>16384||value.includes('\0'))throw Error('插件配置值无效')
 }
 return Object.fromEntries(entries) as Record<string,string>
}

function assertClientId(value:unknown):asserts value is string{
 if(typeof value!=='string'||!value.trim()||value.length>2048||/[\x00-\x1f\x7f]/.test(value))throw Error('动态客户端身份无效')
}
