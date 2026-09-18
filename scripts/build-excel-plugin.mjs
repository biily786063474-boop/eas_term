// Preparation: npm ci --prefix scripts/excel-connector --ignore-scripts
// Runtime package is fully offline; never run npm/npx on user installation.
import {buildSync} from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
const source='scripts/excel-connector',target='plugins-store/excel'
const result=buildSync({metafile:true,entryPoints:[source+'/workbook.mjs'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:target+'/lib/workbook.cjs',legalComments:'external'})
// Upstream source comments contain blank lines with trailing spaces.
const bundle=target+'/lib/workbook.cjs'
fs.writeFileSync(bundle,fs.readFileSync(bundle,'utf8').replace(/^[ \t]+$/gm,''))
// Preserve notices embedded by upstream bundles as well as lockfile dependencies.
const embedded=target+'/lib/workbook.cjs.LEGAL.txt'
if(fs.existsSync(embedded))fs.writeFileSync(embedded,fs.readFileSync(embedded,'utf8').split(/\r?\n/).map(line=>line.trimEnd()).join('\n'))
const lock=JSON.parse(fs.readFileSync(source+'/package-lock.json','utf8'))
const notices=[]
const used=new Set(Object.keys(result.metafile.inputs).filter(p=>p.includes('/node_modules/')).map(p=>{let dir=path.dirname(p);while(!fs.existsSync(path.join(dir,'package.json')))dir=path.dirname(dir);return path.relative(source,dir)}))
for(const [relative,p] of Object.entries(lock.packages)){
 if(!relative||!used.has(relative))continue
 const dir=path.join(source,relative),manifest=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'))
 const licenses=fs.readdirSync(dir).filter(n=>/^licen[cs]e(?:\.|$)|^copying(?:\.|$)/i.test(n)).sort()
 let licenseText=licenses.map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('\n')
 if(!licenseText&&manifest.name==='isarray'){const readme=fs.readFileSync(path.join(dir,'README.md'),'utf8');licenseText=readme.slice(readme.indexOf('## License'))}
 if(!licenseText&&manifest.name==='saxes')licenseText=fs.readFileSync(source+'/licenses/saxes-5.0.1.txt','utf8')
 if(!licenseText)throw Error('Missing license notice: '+manifest.name)
 notices.push(manifest.name+' '+manifest.version+' — '+String(manifest.license)+'\n'+licenseText)
}
fs.writeFileSync(target+'/THIRD-PARTY-NOTICES.txt',notices.join('\n\n--------------------\n\n').replace(/\r\n/g,'\n').split('\n').map(line=>line.trimEnd()).join('\n'))
console.log('Bundled Excel connector and '+notices.length+' dependency notices')
