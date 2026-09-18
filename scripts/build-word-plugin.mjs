// Preparation: npm ci --prefix scripts/word-connector --ignore-scripts
// Runtime package is fully offline; never run npm/npx on user installation.
import {buildSync} from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
const source='scripts/word-connector',target='plugins-store/word'
buildSync({entryPoints:[source+'/document.mjs'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:target+'/lib/document.cjs',legalComments:'none'})
const lock=JSON.parse(fs.readFileSync(source+'/package-lock.json','utf8'))
const notices=[]
for(const [relative,p] of Object.entries(lock.packages)){
 if(!relative)continue
 const dir=path.join(source,relative),manifest=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'))
 const licenses=fs.readdirSync(dir).filter(n=>/^licen[cs]e(?:\.|$)|^copying(?:\.|$)/i.test(n)).sort()
 let licenseText=licenses.map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('\n')
 if(!licenses.length&&['hash.js','isarray'].includes(manifest.name)){
  const readme=fs.readFileSync(path.join(dir,'README.md'),'utf8')
  const section=readme.search(/^#{1,6}\s+LICENSE\s*$/im)
  if(section>=0)licenseText=readme.slice(section)
 }
 if(!licenseText)throw Error('Missing license notice: '+manifest.name)
 notices.push(manifest.name+' '+manifest.version+' — '+String(manifest.license)+'\n'+licenseText)
}
fs.writeFileSync(target+'/THIRD-PARTY-NOTICES.txt',notices.join('\n\n--------------------\n\n').replace(/\r\n/g,'\n'))
console.log('Bundled Word connector and '+notices.length+' dependency notices')
