import fs from 'node:fs'
const out='docs/verification/settings-hierarchy';fs.mkdirSync(out,{recursive:true})
const pages=await(await fetch('http://127.0.0.1:9452/json/list')).json()
const ws=new WebSocket(pages.find(p=>p.title==='Eas-Term').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r)
let id=0;const pending=new Map();ws.onmessage=e=>{let m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}
async function call(method,params={}){return new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value}
const wait=ms=>new Promise(r=>setTimeout(r,ms))
await ev('location.reload()');await wait(1700)
const results=[]
for(const key of ['theme','board','sound','keys','ai','mcp','phone','update','perf','privacy']){
 await ev(`window.dispatchEvent(new CustomEvent('eas:open-settings',{detail:{tab:'${key}'}}))`);await wait(650)
 results.push(await ev(`(()=>{let p=document.querySelector('.cset-pane');return {key:'${key}',title:document.querySelector('.cset-pagehead h2').textContent,overflow:p.scrollWidth>p.clientWidth+1,groups:[...p.querySelectorAll('h3')].map(e=>e.textContent),text:p.innerText.length}})()`))
 const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+'/'+key+'.png',Buffer.from(shot.result.data,'base64'))
}
await ev(`(()=>{const i=document.querySelector('.cset-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'黑匣子');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(100)
const search=await ev(`[...document.querySelectorAll('.cset-tab')].map(x=>x.textContent)`)
await ev(`window.dispatchEvent(new CustomEvent('eas:open-settings',{detail:{tab:'ai'}}))`);await wait(200)
const detail=await ev(`(()=>{let s=document.querySelector('.cset-details summary');s.click();return s.parentElement.open})()`)
const toggle=await ev(`(()=>{let e=document.querySelector('.cset-row input');return {appearance:getComputedStyle(e).appearance,thumb:getComputedStyle(e,'::before').backgroundColor}})()`)
fs.writeFileSync(out+'/ui.json',JSON.stringify({results,search,detail,toggle},null,2))
console.log(JSON.stringify({results,search,detail,toggle},null,2));ws.close()
