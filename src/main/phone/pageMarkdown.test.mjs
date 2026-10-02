// 手机页（resources/phone/index.html）里 Markdown 渲染器的单测。
// 渲染器就在页面里（页面是零依赖单文件），这里按 `/* md:begin` … `/* md:end */` 把那段取出来，
// 在一个极简 DOM 替身里跑。重点钉两件事：常见语法渲染对，**原文里的 HTML / 危险链接绝不变成真元素**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const page = fs.readFileSync(new URL('../../../resources/phone/index.html', import.meta.url), 'utf8')
const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'))
const md = page.slice(page.indexOf('/* md:begin'), page.indexOf('/* md:end */'))

class Node { constructor () { this.childNodes = [] } appendChild (c) { this.childNodes.push(c); return c } get lastChild () { return this.childNodes[this.childNodes.length - 1] || null } }
class Text extends Node { constructor (t) { super(); this.data = String(t) } }
class Elem extends Node {
  constructor (tag) { super(); this.tag = tag; this.attrs = {}; this.className = ''; const self = this; this.classList = { add (c) { self.className = (self.className + ' ' + c).trim() } } }
  setAttribute (k, v) { this.attrs[k] = String(v) }
  set textContent (t) { this.childNodes = [new Text(t)] }
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const html = (n) => n instanceof Text ? esc(n.data)
  : `<${n.tag}${Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${n.childNodes.map(html).join('')}</${n.tag}>`
const ctx = { document: { createElement: (t) => new Elem(t), createTextNode: (t) => new Text(t) } }
vm.createContext(ctx)
vm.runInContext('var tr = function (k, p) { return k === "phone.img" ? "[图片] " + p.alt : k };\nvar el = function (t, c, txt) { var e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e }\n' + md + '\nthis.mdRender = mdRender', ctx)
const render = (s) => ctx.mdRender(s, new Elem('div')).childNodes.map(html).join('')

test('整个手机页脚本能被解析（语法错 = 整页打不开）', () => {
  assert.doesNotThrow(() => new vm.Script(script))
  assert.ok(!/\(\?<[=!]/.test(script.replace(/\/\/.*$/gm, '')), '不许用正则后行断言：iOS 16.4 以前的 Safari 解析失败')
})

test('标题 / 段落 / 粗斜体 / 行内代码 / 删除线', () => {
  assert.equal(render('# 标题\n\n正文 **粗** *斜* `code` ~~删~~'),
    '<h1>标题</h1><p>正文 <strong>粗</strong> <em>斜</em> <code>code</code> <del>删</del></p>')
})

test('单个换行保留为换行（AI 回复常这样分行）', () => {
  assert.equal(render('第一行\n第二行'), '<p>第一行<br></br>第二行</p>')
})

test('列表：无序 / 有序（保留起始号）/ 嵌套 / 任务勾选', () => {
  assert.equal(render('- a\n- b\n  - b1'), '<ul><li>a</li><li>b<ul><li>b1</li></ul></li></ul>')
  assert.equal(render('3. 三\n4. 四'), '<ol start="3"><li>三</li><li>四</li></ol>')
  assert.equal(render('- [x] 完成\n- [ ] 待办'), '<ul><li>☑ 完成</li><li>☐ 待办</li></ul>')
})

test('代码块原样保留（里面的 ** 和 <b> 都不解析）', () => {
  assert.equal(render('```js\nconst a = **1** <b>\n```'), '<pre><code data-lang="js">const a = **1** &lt;b&gt;</code></pre>')
})

test('引用、分隔线、表格（含转义竖线）', () => {
  assert.equal(render('> 引用 **重点**'), '<blockquote><p>引用 <strong>重点</strong></p></blockquote>')
  assert.equal(render('---'), '<hr></hr>')
  assert.equal(render('| 名 | 值 |\n|---|---:|\n| a\\|b | 1 |'),
    '<div><table><thead><tr><th>名</th><th>值</th></tr></thead><tbody><tr><td>a|b</td><td>1</td></tr></tbody></table></div>')
})

test('安全：原文 HTML 只当文字；javascript: 链接不生成 <a>；图片不加载', () => {
  const out = render('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[点我](javascript:alert(1)) ![p](http://x/a.png)')
  assert.ok(!/<script|<img|<a /.test(out), out)
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(out, /点我/)
  assert.match(out, /\[图片\] p/)
})

test('安全链接：http(s) / mailto 生成 <a>，新页面打开且不带 opener', () => {
  assert.equal(render('[文档](https://eas.biily.top/manual.html)'),
    '<p><a href="https://eas.biily.top/manual.html" target="_blank" rel="noopener noreferrer">文档</a></p>')
  assert.match(render('见 https://example.com/a。'), /<a href="https:\/\/example.com\/a"[^>]*>https:\/\/example.com\/a<\/a>。/)
})

test('未闭合的语法（流式输出到一半）不抛错、按文字显示', () => {
  assert.doesNotThrow(() => render('正在写 **粗体还没\n```py\nprint('))
  assert.match(render('正在写 **粗体还没'), /正在写 \*\*粗体还没/)
})

test('HTML 报告只进 sandbox="allow-scripts" 的 iframe，页面里绝不出现 allow-same-origin', () => {
  const code = script.replace(/\/\/.*$/gm, '')
  assert.match(code, /setAttribute\('sandbox', 'allow-scripts'\)/)
  assert.ok(!/allow-same-origin/.test(code), '两个都给等于没有沙箱：同源 iframe 能自己去掉 sandbox')
  assert.ok(!/allow-(top-navigation|popups|forms|modals)/.test(code))
})

test('手机页接入中英文：脚本里（注释除外）没有写死的中文；用到的词条与 phone 词典一一对应', () => {
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => (l.includes('://') ? l : l.split('//')[0])).join('\n')
  const cjk = code.split('\n').filter((l) => /[\u4e00-\u9fff]/.test(l))
  assert.deepEqual(cjk, [], '写死的中文会让英文界面的手机页冒中文：' + cjk.join(' | '))
  const used = new Set([...code.matchAll(/tr\('([\w.]+)'/g)].map((m) => m[1]))
  const dict = fs.readFileSync(new URL('../../shared/i18n/dict/phone.zh.ts', import.meta.url), 'utf8')
  const keys = new Set([...dict.matchAll(/'(phone\.[\w.]+)':/g)].map((m) => m[1]))
  assert.deepEqual([...used].filter((k) => !keys.has(k)), [], '页面用了词典里没有的键')
  assert.deepEqual([...keys].filter((k) => !used.has(k)), [], '词典里有页面没用的废键')
  assert.ok(page.includes('/*__EAS_I18N__*/null'), '注入占位被删了：主进程 pageSource 塞不进文案')
})

test('页面脚本里没有同名函数（提升后后一个赢，前一个静默失效）', () => {
  // 2026-10-02 真机回归：对话页与动态页各有一个 function startPoll，对话页的调用一直落到动态页那个 ——
  // 手机发完消息对话页从来不刷新，看不到「正在想」，回复要退出重进才出来
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const names = [...code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])
  const dup = names.filter((n, i) => names.indexOf(n) !== i)
  assert.deepEqual(dup, [], '重名函数：' + dup.join(', '))
})

test('处理中气泡：忙着且没吐字时出现，文字取主进程翻好的 activity，兜底「正在想」', () => {
  const code = script.replace(/\/\/.*$/gm, '')
  assert.match(code, /var working = chatBusy === true && !partial/)
  assert.match(code, /el\('span', 'act', r\.activity \|\| tr\('phone\.chat\.thinking'\)\)/)
  assert.match(page, /prefers-reduced-motion:reduce\)\{[^}]*\.bub\.status \.dots i\{animation:none\}/)
})

test('对话页轮询：就地换内容、留住输入框、滚的是 #body', () => {
  const code = script.replace(/\/\/.*$/gm, '')
  // 页面是 flex 布局、#body 自己 overflow:auto —— 滚 document 等于没滚，新消息压在输入框下面
  assert.ok(!/scrollingElement/.test(code), '滚动容器是 #body，不是 document')
  assert.match(page, /#body\{[^}]*overflow-y:auto/)
  // 轮询不走 shell()（它会清空 #body：闪白、滚动归零、输入框重建把没发的字清掉）
  assert.match(code, /var b = quiet && sess \? \$\('body'\) : shell\(/)
  assert.match(code, /var keep = quiet \? b\.querySelector\('\.composer'\) : null/)
  assert.match(code, /if \(sessKind === 'agent' && !keep\) b\.appendChild\(composer\(\)\)/)
})
