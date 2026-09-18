// Preparation: npm ci --prefix scripts/web-fetch-connector --ignore-scripts
// Runtime package is fully offline; never run npm/npx on user installation.
import {buildSync} from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
const source='scripts/web-fetch-connector',target='plugins-store/web-fetch'
buildSync({entryPoints:[source+'/extract.mjs'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:target+'/lib/extract.cjs',legalComments:'external'})
// Preserve notices embedded by upstream bundles as well as lockfile dependencies.
const embedded=target+'/lib/extract.cjs.LEGAL.txt'
if(fs.existsSync(embedded))fs.writeFileSync(embedded,fs.readFileSync(embedded,'utf8').split(/\r?\n/).map(line=>line.trimEnd()).join('\n'))
const lock=JSON.parse(fs.readFileSync(source+'/package-lock.json','utf8'))
const notices=[]
for(const [relative,p] of Object.entries(lock.packages)){
 if(!relative)continue
 const dir=path.join(source,relative),manifest=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'))
 const licenses=fs.readdirSync(dir).filter(n=>/^licen[cs]e(?:\.|$)|^copying(?:\.|$)/i.test(n)).sort()
 let licenseText=licenses.map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('\n')
 if(!licenseText)throw Error('Missing license notice: '+manifest.name)
 notices.push(manifest.name+' '+manifest.version+' — '+String(manifest.license)+'\n'+licenseText)
}
fs.writeFileSync(target+'/THIRD-PARTY-NOTICES.txt',notices.join('\n\n--------------------\n\n').replace(/\r\n/g,'\n').split('\n').map(line=>line.trimEnd()).join('\n'))
console.log('Bundled WebFetch connector and '+notices.length+' dependency notices')

const {default:ts}=await import('typescript');fs.writeFileSync(target+'/lib/address-policy.mjs','// Generated from endpointPolicy.ts; do not hand edit.\n'+ts.transpileModule(fs.readFileSync('src/main/pluginConnections/endpointPolicy.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText)
