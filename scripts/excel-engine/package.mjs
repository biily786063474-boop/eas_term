// Build-time only. Output must be a new staging directory, never an installed plugin.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const source=path.dirname(fileURLToPath(import.meta.url))
const targets=[['darwin','arm64','darwin-arm64'],['darwin','amd64','darwin-x64'],['windows','amd64','win32-x64']]
export function sealEnginePackage(root,notices){
 if(typeof notices!=='string'||!notices.trim())throw Error('Missing dependency notices')
 const manifest={}
 for(const [goos,,key] of targets){
  const file=path.join(root,'bin','excel-engine-'+key+(goos==='windows'?'.exe':'')),stat=fs.lstatSync(file)
  if(!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>64*1024*1024)throw Error('Invalid engine binary: '+key)
  manifest[key]={size:stat.size,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}
 }
 fs.mkdirSync(path.join(root,'lib'),{recursive:true})
 fs.copyFileSync(path.join(source,'worker.mjs'),path.join(root,'lib/worker.mjs'))
 fs.writeFileSync(path.join(root,'THIRD-PARTY-NOTICES.txt'),notices)
 const legacy=path.resolve(source,'../../plugins-store/excel')
 fs.copyFileSync(path.join(legacy,'lib/files.mjs'),path.join(root,'lib/files.mjs'))
 fs.copyFileSync(path.join(source,'connector.mjs'),path.join(root,'lib/connector.mjs'))
 fs.copyFileSync(path.join(source,'server.mjs'),path.join(root,'server.mjs'))
 const manifestSource=JSON.parse(fs.readFileSync(path.join(legacy,'plugin.json'),'utf8'))
 manifestSource.version='1.1.0'
 manifestSource.description='读取、创建和更新XLSX，计算受支持公式，添加多系列图表与需刷新显示的透视表。'
 fs.writeFileSync(path.join(root,'plugin.json'),JSON.stringify(manifestSource,null,2)+'\n')
 fs.writeFileSync(path.join(root,'bin/integrity.json'),JSON.stringify(manifest,null,2)+'\n')
 return manifest
}
export function buildEnginePackage(go,output){
 if(!path.isAbsolute(go)||!path.isAbsolute(output))throw Error('Use absolute Go and output paths')
 const env={...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',CGO_ENABLED:'0',GOFLAGS:''}
 const run=(args,extra={})=>execFileSync(go,args,{cwd:source,env:{...env,...extra},encoding:'utf8',maxBuffer:8*1024*1024})
 if(!/^go version go1\.26\.8 /.test(run(['version'])))throw Error('Expected qualified Go 1.26.8')
 run(['mod','verify'])
 const modules=[...new Set(run(['list','-mod=readonly','-deps','-f','{{with .Module}}{{if not .Main}}{{.Path}}|{{.Version}}|{{.Dir}}{{end}}{{end}}','./cmd/excel-engine']).trim().split('\n').filter(Boolean))]
 const notices=[]
 for(const line of modules){
  const [name,version,dir]=line.split('|')
  const licenses=fs.readdirSync(dir).filter(n=>/^(LICENSE|COPYING|NOTICE)(\..*)?$/i.test(n)&&fs.statSync(path.join(dir,n)).isFile()).sort()
  if(!licenses.length)throw Error('Missing license: '+name)
  notices.push(name+' '+version+'\n'+licenses.map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('\n'))
 }
 const goroot=run(['env','GOROOT']).trim()
 notices.push('Go runtime 1.26.8\n'+fs.readFileSync(path.join(goroot,'LICENSE'),'utf8'))
 fs.mkdirSync(output) // Existing destinations fail; never replace a released package.
 fs.mkdirSync(path.join(output,'bin'))
 for(const [GOOS,GOARCH,key] of targets){
  console.log('Building '+key)
  run(['build','-mod=readonly','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',path.join(output,'bin','excel-engine-'+key+(GOOS==='windows'?'.exe':'')),'./cmd/excel-engine'],{GOOS,GOARCH})
 }
 return sealEnginePackage(output,notices.join('\n\n--------------------\n\n'))
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 console.log(JSON.stringify(buildEnginePackage(process.argv[2]||'',process.argv[3]||''),null,2))
}
