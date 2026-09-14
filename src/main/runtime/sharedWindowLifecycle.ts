interface OwnedWindow {id:number;on(event:'did-navigate',listener:()=>void):unknown;on(event:'render-process-gone',listener:()=>void):unknown;once(event:'destroyed',listener:()=>void):unknown}
const observed=new WeakSet<object>()
/** A renderer reload replaces the owner page even while its WebContents survives. */
export function observeSharedWindow(window:OwnedWindow,release:(windowId:number)=>void){
 if(observed.has(window))return
 observed.add(window)
 const id=window.id,cleanup=()=>release(id)
 window.on('did-navigate',cleanup)
 window.on('render-process-gone',cleanup)
 window.once('destroyed',cleanup)
}
