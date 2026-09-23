import fs from 'node:fs';
const pages=await (await fetch('http://127.0.0.1:9473/json/list')).json(),p=pages.find(p=>p.type==='page'&&p.url.includes('out/renderer')&&!p.url.includes('island'));
const ws=new WebSocket(p.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let i=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};
async function call(method,params={}){return new Promise(r=>{pending.set(++i,r);ws.send(JSON.stringify({id:i,method,params}))})}
const run=expression=>call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
console.log(await run("window.dispatchEvent(new CustomEvent('eas:open-settings',{detail:{tab:'ai'}}))"));
await call('Page.bringToFront');await new Promise(r=>setTimeout(r,1000));
console.log(JSON.stringify(await run("document.querySelector('.cset-box')?.innerText.slice(0,950)")));
const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/eas-onboarding-fullapp.png',Buffer.from(shot.result.data,'base64'));ws.close();
