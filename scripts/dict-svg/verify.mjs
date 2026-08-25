// 校验会动的词条示意图。**肉眼查不出 SMIL 静默失效，所以这个脚本是必跑项。**
//
// 三道检查：
//   ① 动画有没有真的在动 —— pauseAnimations() 后 setCurrentTime() 定格，
//      读每个「带 animate 的宿主元素」的计算属性。纹丝不动就是失效。
//      **采样点取自动画自己的 keyTimes**，不是均匀撒点：
//      文字乱码那类字符只显示 120ms，4 秒均匀采 24 点根本落不进那个窗口，
//      会把真动画误判成死的。按 keyTimes 采就一个转折都不会漏。
//      keyTimes 不合规时浏览器**不报错、不降级、不打日志**，元素停在初始属性上；
//      第一版防抖就是这样只剩两条横线，截图发出来才发现。
//   ② 过不过得了 dict.ts 的 sanitizeSvg() —— 被剥掉标签或被 8000 字符截断都算挂。
//   ③ 声明的时序对不对 —— 词条自己给 expect，扫时间轴对答案（可选）。
//
// 用项目自己的 electron 跑，不借别的仓库的 playwright —— 换台机器就跑不了的校验等于没有。
//
//   node scripts/dict-svg/verify.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

/** 把 dict.ts 里真正在用的那个 sanitizeSvg 抠出来跑 —— 复刻一份迟早会和真身脱节。 */
function loadSanitizer() {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/dict.ts'), 'utf8')
  const i = src.indexOf('function sanitizeSvg')
  let d = 0, end = -1
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++
    else if (src[k] === '}' && --d === 0) { end = k + 1; break }
  }
  const body = src.slice(i, end)
    .replace('(raw: unknown): string {', '(raw) {')
    .replace(/:\s*(string|boolean|number|unknown|RegExp)\b(?!\w)/g, '')
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return sanitizeSvg`)()
}

export async function verify(entries) {
  const sanitizeSvg = loadSanitizer()
  const fails = []

  // ② 先在 node 里做，不用起浏览器
  for (const [id, svg] of Object.entries(entries)) {
    if (svg.length > 8000) fails.push(`${id}: ${svg.length}B 超 8000 上限，会被静默截断`)
    else if (sanitizeSvg(svg) !== svg) fails.push(`${id}: 过不了 sanitizeSvg，有标签或属性被剥掉`)
  }

  // ① 起 electron 定格实测
  const tmp = path.join(ROOT, 'node_modules/.cache/dict-svg-verify')
  fs.mkdirSync(tmp, { recursive: true })
  const dataFile = path.join(tmp, 'data.json')
  fs.writeFileSync(dataFile, JSON.stringify(entries))
  const elec = (await import('electron')).default
  const out = await new Promise((res) => {
    // 探针是独立文件不是内嵌字符串 —— 嵌在模板字符串里的话，
    // 探针代码本身用一个反引号就会把外层字符串截断。
    const p = spawn(elec, [path.join(HERE, 'probe.cjs'), dataFile], { env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } })
    let buf = '', err = ''
    // **必须有超时。** 探针一旦卡住，调用方只会看到命令超时，
    // 拿不到任何线索 —— 挂死的校验比报错的校验更糟。
    const timer = setTimeout(() => { p.kill('SIGKILL'); res(buf + '\n@@TIMEOUT') }, 120000)
    p.stdout.on('data', (d) => { buf += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', () => { clearTimeout(timer); res(buf || '\n@@DIED' + JSON.stringify(err.slice(-400))) })
  })
  const line = out.split('\n').find((l) => l.startsWith('@@'))
  // 没结果、超时、探针自己挂了 —— 一律算失败。**跑不成绝不能当通过。**
  if (!line) { fails.push('electron 没吐出结果 —— 校验没跑成'); return { fails, dead: [] } }
  if (line.startsWith('@@TIMEOUT')) { fails.push('探针 120s 没返回，已强杀 —— 校验没跑成'); return { fails, dead: [] } }
  if (line.startsWith('@@ERR')) { fails.push(`探针在页面里抛错：${JSON.parse(line.slice(5))}`); return { fails, dead: [] } }
  if (line.startsWith('@@DIED')) { fails.push(`electron 异常退出：${JSON.parse(line.slice(6))}`); return { fails, dead: [] } }
  const dead = JSON.parse(line.slice(2))
  for (const d of dead) fails.push(`${d.id}: ${d.n} 条动画在自己所有 keyTime 上纹丝不动 —— 静默失效（${d.tags}）`)
  return { fails, dead }
}


// 路径里有空格时 import.meta.url 是百分号编码的，跟 argv[1] 直接比会永远不等 ——
// 脚本静静地什么都不做、还退 0，比报错更坑。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { A } = await import('./batch-a.mjs')
  const { fails } = await verify(A)
  const n = Object.keys(A).length
  if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); console.log(`\n  ✗ ${n} 条里 ${fails.length} 处不合格`); process.exit(1) }
  console.log(`  ✓ ${n} 条全部通过：动画真的在动 · 过得了 sanitizeSvg · 未超 8000 字符`)
}
