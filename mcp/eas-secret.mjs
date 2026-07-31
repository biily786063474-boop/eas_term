#!/usr/bin/env node
// eas-secret —— 用密钥柜里的凭证跑一条命令，明文不经过任何人的眼睛。
//
//   eas-secret run --group "AWS 生产账号" -- aws s3 ls
//   eas-secret run --vars OPENAI_API_KEY -- python train.py
//
// 存在的理由：进程的环境变量在 spawn 那一刻就定死了。用户刚存进密钥柜的东西，
// 已经在跑的这个终端读不到 —— 原来只能让 agent 去开新终端，手上的活就断了。
//
// 三条不能破的性质（改这个文件前先读一遍）：
//   1. **绝不把值打到 stdout/stderr**。这里只做一件事：取值 → 塞进子进程 env → exec。
//      任何 console.log(env) 之类的调试语句都是把密钥直接喂给 AI 的对话。
//   2. **值不出现在命令行里**。参数只有组名/变量名，所以 shell history、ps、
//      /proc 里都看不到值。这是它比 `export VAR=xxx && cmd` 强的全部原因。
//   3. **退出码原样透传**。调用方（多半是 agent）要靠退出码判断成没成。
import { spawn } from 'child_process'
import os from 'os'

const PORT = process.env.EAS_TERM_PORT
const TOKEN = process.env.EAS_TERM_TOKEN

const die = (msg, code = 1) => {
  process.stderr.write(`eas-secret: ${msg}\n`)
  process.exit(code)
}

const USAGE = `用法：
  eas-secret run --group "<组名>" -- <命令> [参数...]
  eas-secret run --vars VAR1,VAR2 -- <命令> [参数...]

它把密钥柜里的这一组凭证放进子命令的环境变量再执行，
值不经过终端输出、也不进 shell history（命令行里只有组名）。`

const argv = process.argv.slice(2)
if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
  process.stdout.write(USAGE + '\n')
  process.exit(0)
}
if (argv[0] !== 'run') die(`不认识的子命令 ${argv[0]}\n\n${USAGE}`, 2)

// 解析到 `--` 为止，之后全是要执行的命令
let group, vars
let i = 1
for (; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--') { i++; break }
  else if (a === '--group') group = argv[++i]
  else if (a === '--vars') vars = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  else die(`不认识的参数 ${a}\n\n${USAGE}`, 2)
}
const cmd = argv.slice(i)
if (!cmd.length) die(`-- 后面要跟真正要执行的命令\n\n${USAGE}`, 2)
if (!group && !vars?.length) die(`要指定 --group 或 --vars\n\n${USAGE}`, 2)
if (!PORT || !TOKEN) {
  die('没检测到 Eas-Term 环境 —— 这个命令只能在 Eas-Term 的终端里用', 2)
}

let res
try {
  res = await fetch(`http://127.0.0.1:${PORT}/secret-env`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eas-token': TOKEN },
    body: JSON.stringify({ group, vars })
  })
} catch (e) {
  die(`连不上 Eas-Term（${e.message}）`, 2)
}
const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
// 失败信息里绝不会有值，可以原样透出去给用户和 agent 看
if (!j.ok) die(j.error || '取不到密钥', 2)

const child = spawn(cmd[0], cmd.slice(1), {
  // 值只在这里出现一次：直接进子进程的环境
  env: { ...process.env, ...j.env },
  stdio: 'inherit',
  shell: false
})
child.on('error', (e) => die(`跑不起来 ${cmd[0]}：${e.message}`, 127))
// 退出码原样透传：调用方（多半是 agent）要靠它判断成没成。
// 被信号杀掉的按 shell 惯例转成 128+信号号
child.on('exit', (code, signal) => {
  process.exit(signal ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 0))
})
