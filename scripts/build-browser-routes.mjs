import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const data=JSON.parse(fs.readFileSync(path.join(root,'src/shared/browserRoutes.json'),'utf8'))
const out=path.join(root,'docs/browser');fs.mkdirSync(out,{recursive:true})
fs.writeFileSync(path.join(out,'routes.json'),JSON.stringify(data,null,2)+'\n')
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const groups=data.categories.map(c=>'<section id="'+c.id+'"><h2>'+esc(c.name)+'</h2><div class="row">'+data.sites.filter(s=>s.category===c.id).map(s=>'<article id="'+s.id+'"><h3>'+esc(s.name)+'</h3><p>'+esc(s.description)+'</p><small>'+s.intents.map(esc).join(' · ')+'</small><p>'+(s.url?'<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">打开网站 ↗</a>':'网址待确认')+'</p></article>').join('')+'</div></section>').join('')
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eas-Term 网站路由入口</title><style>body{background:#18181a;color:#eee;font:14px -apple-system,sans-serif;padding:30px;max-width:1200px;margin:auto}h1{font-size:26px}p,small{color:#aaa;line-height:1.8}nav{display:flex;gap:20px;flex-wrap:wrap}a{color:inherit}section{padding-top:30px;scroll-margin-top:20px}.row{display:flex;gap:16px;overflow:auto;padding-bottom:15px}article{border:1px solid #38383b;border-radius:10px;padding:20px;flex:0 0 260px}article:target{border-color:#bbacde}section:target h2{color:#bbacde}</style></head><body><h1>网站入口</h1><p>本地路由目录 · 点击打开，不会自动发布。收藏表单与正式浏览器接线仍在实施中。</p><nav>'+data.categories.map(c=>'<a href="#'+c.id+'">'+esc(c.name)+'</a>').join('')+'</nav>'+groups+'<script type="application/json" id="site-routes">'+JSON.stringify(data).replace(/</g,'\\u003c')+'</script></body></html>')
console.log('Generated docs/browser/index.html + routes.json')
