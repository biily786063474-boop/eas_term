import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
const root=process.cwd()
if(process.platform!=='darwin')process.exit(0)
const out=path.join(root,'resources/island-native/bin/IslandHost.app/Contents')
fs.mkdirSync(path.join(out,'MacOS'),{recursive:true});fs.mkdirSync(path.join(out,'Resources'),{recursive:true})
fs.copyFileSync('resources/island-native/bridge.js',path.join(out,'Resources/bridge.js'))
// 版本号跟主程序走：没有它时「关于这台 Mac › 系统报告」、崩溃报告和 codesign 显示都是空的（0.4.122 审查遗留）
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('package.json version 不是 x.y.z：'+version)
fs.writeFileSync(path.join(out,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>'+version+'</string><key>CFBundleShortVersionString</key><string>'+version+'</string><key>CFBundleIdentifier</key><string>com.biily.easterm.islandhost</string><key>CFBundleExecutable</key><string>IslandHost</string><key>CFBundleName</key><string>Eas-Term Island Host</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>12.0</string></dict></plist>')
const parts=[]
for(const arch of ['arm64','x86_64']){
 const file=path.join(out,'MacOS',arch)
 execFileSync('/usr/bin/swiftc',['-O','-target',arch+'-apple-macos12','resources/island-native/Host.swift','-o',file],{stdio:'inherit'});parts.push(file)
}
execFileSync('/usr/bin/lipo',['-create',...parts,'-output',path.join(out,'MacOS/IslandHost')]);for(const p of parts)fs.unlinkSync(p)
execFileSync('/usr/bin/codesign',['--force','--sign','-',path.dirname(out)],{stdio:'inherit'})
// Copy only the static dependency closure of the island entry; never the whole workbench.
const source=path.join(root,'out/renderer'),assetRoot=path.join(root,'out/island-native-assets')
// 先清空：electron-vite 只清它自己的 out 子目录，旧构建的带哈希 bundle 会留在这里被 extraResources 一起打进包
fs.rmSync(assetRoot,{recursive:true,force:true})
fs.mkdirSync(assetRoot,{recursive:true})
const pending=['island.html'],seen=new Set()
while(pending.length){
 const name=pending.pop();if(seen.has(name))continue
 const file=path.resolve(source,name)
 if(!file.startsWith(source+'/')||!fs.statSync(file).isFile())throw Error('invalid island dependency')
 seen.add(name)
 if(/\.(html|js|css)$/.test(name)){
  const content=fs.readFileSync(file,'utf8')
  for(const match of content.matchAll(/["'(]([^"')\s]+)["')]/g)){
   const ref=match[1].split(/[?#]/)[0]
   if(!ref||ref.includes(':'))continue
   const candidate=path.resolve(path.dirname(file),ref)
   if(candidate.startsWith(source+'/')&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile())pending.push(path.relative(source,candidate))
  }
 }
 const dest=path.join(assetRoot,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest)
}
const entry=path.join(assetRoot,'island.html'),html=fs.readFileSync(entry,'utf8')
const meta=/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i
if(!meta.test(html))throw Error('island CSP entry missing')
fs.writeFileSync(entry,html.replace(meta,`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'">`))
fs.writeFileSync(path.join(assetRoot,'island-assets.json'),JSON.stringify([...seen]))
console.log('native island universal helper built; allowed assets:',seen.size)
