import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
// 仅隔离未调用的 fileUrlOf/store 边界，图片扩展名与 easfile 编码使用生产实现。
const code=(await build({entryPoints:[fileURLToPath(new URL('./markdown.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'store-boundary',setup(b){b.onResolve({filter:/store\/shared$/},()=>({path:'shared',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const fileUrlOf=p=>'file://'+p`}))}}]})).outputFiles[0].text
const {renderMarkdown}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const source=html=>Buffer.from(html.match(/src="easfile:\/\/media\/([^"]+)"/)?.[1]??'','base64url').toString()
test('空格项目绝对路径和相对路径都渲染图片',()=>{
 assert.equal(source(renderMarkdown('![图](/Projects/vibe coding/test image.png)','/Projects/vibe coding/doc.md')),'/Projects/vibe coding/test image.png')
 assert.equal(source(renderMarkdown('![图](./test image.png "标题")','/Projects/vibe coding/doc.md')),'/Projects/vibe coding/test image.png')
})
test('尖括号路径和 HTML 特殊字符不损坏文件名，也不能注入属性',()=>{
 assert.equal(source(renderMarkdown('![图](</Projects/vibe coding/a&b.png>)','/doc.md')),'/Projects/vibe coding/a&b.png')
 const html=renderMarkdown('![图](https://example.com/a.png" onerror="alert)','/doc.md')
 assert.doesNotMatch(html,/src="[^"]*"\s+onerror=/)
 assert.match(renderMarkdown('![图](https://example.com/a.png "标题")','/doc.md'),/<img src="https:\/\/example.com\/a.png"/)
})
