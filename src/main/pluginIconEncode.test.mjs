import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {encodePluginIcon,svgIsSafe,MAX_ICON_BYTES} from '../../scripts/plugin-icon-data.mjs'
import {buildPluginRegistries} from '../../scripts/plugin-registry-build.mjs'
import {parseCatalog} from './pluginCatalog.ts'
const SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#f00"/></svg>'
function dir(t,files,manifest={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'icon-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const d=path.join(root,'demo');fs.mkdirSync(d);for(const[f,c]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(d,f)),{recursive:true});fs.writeFileSync(path.join(d,f),c)}fs.writeFileSync(path.join(d,'plugin.json'),JSON.stringify({name:'demo',version:'1.0.0',mcp:{command:'node'},...manifest}));return {root,d}}
test('svgIsSafe rejects script, event handlers, javascript: and external refs',()=>{
 assert.equal(svgIsSafe(SVG),true)
 assert.equal(svgIsSafe('<svg><use href="#a"/><path id="a"/></svg>'),true)
 for(const bad of ['<svg><script>1</script></svg>','<svg><SCRIPT>1</SCRIPT></svg>','<svg onload="x()"/>','<svg><rect onclick = "x"/></svg>','<svg><a href="javascript:x"/></svg>','<svg><image href="https://e.com/a.png"/></svg>','<svg><image xlink:href="http://e.com/a.png"/></svg>','<svg><image href="data:image/png;base64,AA=="/></svg>','<svg><foreignObject/></svg>'])assert.equal(svgIsSafe(bad),false,bad)
})
test('encodePluginIcon encodes svg/png/webp/jpeg inside the plugin dir',t=>{
 const {d}=dir(t,{'ui/icon.svg':SVG,'a.png':Buffer.from([1,2,3]),'b.webp':Buffer.from([1]),'c.jpg':Buffer.from([2]),'d.jpeg':Buffer.from([3])})
 assert.equal(encodePluginIcon(d,'./ui/icon.svg').dataUrl,'data:image/svg+xml;base64,'+Buffer.from(SVG).toString('base64'))
 assert.match(encodePluginIcon(d,'a.png').dataUrl,/^data:image\/png;base64,/)
 assert.match(encodePluginIcon(d,'b.webp').dataUrl,/^data:image\/webp;base64,/)
 assert.match(encodePluginIcon(d,'c.jpg').dataUrl,/^data:image\/jpeg;base64,/)
 assert.match(encodePluginIcon(d,'d.jpeg').dataUrl,/^data:image\/jpeg;base64,/)
})
test('encodePluginIcon skips with a reason: missing, escape, symlink, type, size, unsafe svg',t=>{
 const {root,d}=dir(t,{'big.png':Buffer.alloc(MAX_ICON_BYTES+1),'x.gif':'GIF','bad.svg':'<svg onload="1"/>'})
 fs.writeFileSync(path.join(root,'outside.svg'),SVG)
 fs.symlinkSync(path.join(root,'outside.svg'),path.join(d,'link.svg'))
 for(const rel of [undefined,'nope.svg','../outside.svg','link.svg','big.png','x.gif','bad.svg']){const r=encodePluginIcon(d,rel);assert.equal(r.dataUrl,undefined,String(rel));assert.equal(typeof r.reason,'string')}
 assert.equal(encodePluginIcon(d,undefined).reason,'未声明图标')
})
test('registry entries carry iconDataUrl (composerIcon, logo fallback); missing icon omits field; catalog still validates',t=>{
 const a=dir(t,{'ui/icon.svg':SVG},{composerIcon:'./ui/icon.svg'})
 const b=dir(t,{'l.svg':SVG},{logo:'l.svg'})
 const c=dir(t,{})
 const out=path.join(a.root,'out'),warn=[]
 for(const x of [a,b,c]){const r=buildPluginRegistries({plugins:[x.d],outRoot:path.join(x.root,'out'),onWarn:m=>warn.push(m)});const e=r.v2.plugins[0]
  if(x===c)assert.equal('iconDataUrl' in e,false);else assert.match(e.iconDataUrl,/^data:image\/svg\+xml;base64,/)
  assert.equal(parseCatalog(r.v1,{allowedHosts:['eas.biily.top']}).ok,true)
  assert.equal(r.v1.plugins[0].iconDataUrl,e.iconDataUrl)}
 assert.ok(warn.some(m=>/demo/.test(m)))
})
