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
test('列表项里缩进的围栏代码块渲染成代码块，不被当成续行文字（2026-10-01 AI 回答里命令被拍扁）',()=>{
 const html=renderMarkdown('1. 在终端运行下面这条命令：\n   ```bash\n   eas-secret run --vars A,B -- aliyun swas-open CreateInstances --region cn-hongkong\n   ```\n2. 之后告诉我一声。','/doc.md')
 assert.equal((html.match(/<ol/g)||[]).length,1,'仍是同一个有序列表')
 assert.match(html,/<li>[^]*?<div class="md-codewrap" data-lang="bash">/,'代码块挂在列表项里')
 assert.match(html,/<code>eas-secret run --vars A,B -- aliyun swas-open CreateInstances --region cn-hongkong<\/code>/,'代码内容原样、去掉列表缩进')
 assert.doesNotMatch(html,/```/,'不再把围栏原样显示')
})
test('列表项之间隔着空行和代码块，编号不断（不会从 1 重新数）',()=>{
 const html=renderMarkdown('1. 第一步：\n\n   ```\n   npm install\n   ```\n\n2. 第二步\n3. 第三步','/doc.md')
 assert.equal((html.match(/<ol/g)||[]).length,1)
 assert.equal((html.match(/<li>/g)||[]).length,3)
 assert.match(html,/<code>npm install<\/code>/)
})
test('代码块里像列表或标题的行原样保留，不被解析',()=>{
 const html=renderMarkdown('- 配置：\n  ```yaml\n  - name: a\n  # 注释\n  ```','/doc.md')
 assert.match(html,/<code>- name: a\n# 注释<\/code>/)
})
test('顶层围栏代码块行为不变',()=>{
 const html=renderMarkdown('```js\nconst a = 1\n```','/doc.md')
 assert.match(html,/^<div class="md-codewrap" data-lang="js"><button class="md-copy"[^]*<code>const a = 1<\/code><\/pre><\/div>$/)
})
test('空行隔开的无序列表和有序列表仍是两个列表；空行后顶格段落不并进列表',()=>{
 const html=renderMarkdown('- 甲\n- 乙\n\n1. 一\n2. 二\n\n结尾段落','/doc.md')
 assert.equal((html.match(/<ul/g)||[]).length,1); assert.equal((html.match(/<ol/g)||[]).length,1)
 assert.match(html,/<\/ol>\n<p class="md-p">结尾段落<\/p>$/)
})
