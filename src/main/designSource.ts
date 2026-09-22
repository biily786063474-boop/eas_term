// Read only the existing curated preview endpoint; never execute downloaded HTML.
export async function readDesignSource(
 slug: unknown,
 index: Record<string, { previewUrl?: string }>,
 request: typeof fetch = fetch
): Promise<{ source: string; url: string; bytes: number }> {
 if (typeof slug !== 'string' || !Object.hasOwn(index, slug) || !index[slug].previewUrl) throw Error('未收录此页面源码')
 const url = new URL(index[slug].previewUrl!)
 if (url.origin !== 'https://design.biily.top' || !url.pathname.startsWith('/cdn-mirror/template-kits/') || !url.pathname.endsWith('.html') || url.username || url.password) throw Error('源码来源不受支持')
 const response = await request(url.href, {redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)})
 if (!response.ok) { await response.body?.cancel(); throw Error('源码读取失败，请重试') }
 if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) { await response.body?.cancel(); throw Error('源码响应不是 HTML') }
 const reader = response.body?.getReader()
 if (!reader) throw Error('源码为空')
 const chunks: Uint8Array[] = []; let bytes = 0
 try {
  while (true) {
   const {done,value} = await reader.read(); if (done) break
   bytes += value.byteLength
   if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw Error('源码过大（超过 2 MB），未截断或插入') }
   chunks.push(value)
  }
 } finally { reader.releaseLock() }
 const source = Buffer.concat(chunks).toString('utf8')
 if (!/<(?:!doctype\s+html|html)\b/i.test(source)) throw Error('未取得有效 HTML 源码')
 return {source,url:url.href,bytes}
}

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
type Authorize = (p: unknown) => {ok:true;path:string}|{ok:false;error:string}
export function saveDesignSource(project: string, slug: string, source: string, authorize: Authorize): string {
 if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw Error('源码名称无效')
 const checked=(p:string):string=>{const r=authorize(p);if(!r.ok)throw Error(r.error);return r.path}
 const root=checked(project)
 if (!fs.statSync(root).isDirectory()) throw Error('目标项目不存在')
 const dir=checked(path.join(root,'.eas','design-references'))
 fs.mkdirSync(dir,{recursive:true})
 const hash=createHash('sha256').update(source).digest('hex')
 const file=checked(path.join(dir,slug+'-'+hash+'.html'))
 try {fs.writeFileSync(file,source,{flag:'wx',mode:0o600})}
 catch(e) {
  if ((e as NodeJS.ErrnoException).code!=='EEXIST')throw e
  if(fs.readFileSync(file,'utf8')!==source)throw Error('已有源码文件不一致，未覆盖')
 }
 return file
}
