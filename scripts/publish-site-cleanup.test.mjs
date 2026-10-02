// publish-site.sh 的「清理旧版本」一段：把它原样抽出来、用假 ssh 跑，不碰服务器。
// 钉的是 0.4.122 审查遗留：读不到线上 latest.json（ssh 失败 / 文件坏）时原先会把所有旧版本当成「没人引用」删掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const src = fs.readFileSync('scripts/publish-site.sh', 'utf8').split('\n')
const start = src.findIndex((l) => l.includes('# ── 清理：只留最近 KEEP 个版本'))
const end = src.findIndex((l, i) => i > start && l.startsWith('# ── reload'))
// 段尾是外层 `if … fi` 的那个 fi（清理只在非 --site-only 时跑），抽出来时去掉
const block = src.slice(start, end).join('\n').replace(/\nfi\s*$/, '\n')

function run({ versions, latest, sshDown = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-cleanup-'))
  const log = path.join(dir, 'ssh.log')
  // 假 ssh：记下每条远程命令；ls 返回版本目录，cat latest.json 返回给定内容，rm 只记账
  const stub = `
say(){ echo "$*"; }
ssh(){ [ "$1" = "-n" ] && shift; shift; echo "$*" >> ${JSON.stringify(log)}
  ${sshDown ? 'return 255' : ''}
  case "$*" in
    *"ls -d v*/"*) printf '%s\\n' ${versions.map((v) => `'${v}'`).join(' ')} ;;
    *"cat "*latest.json*) ${latest === null ? 'return 1' : `printf '%s' '${latest}'`} ;;
    *) return 0 ;;
  esac; }
HOST=fake; DL=/fake/eas-dl; KEEP=2; VERSION=0.4.999
`
  const r = spawnSync('bash', ['-c', stub + block], { encoding: 'utf8', cwd: process.cwd() })
  const cmds = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''
  fs.rmSync(dir, { recursive: true, force: true })
  return { out: r.stdout + r.stderr, removed: [...cmds.matchAll(/rm -rf \/fake\/eas-dl\/(v[\d.]+)/g)].map((m) => m[1]) }
}

const versions = ['v0.4.100', 'v0.4.113', 'v0.4.200', 'v0.4.999']
const latest = '{"version":"0.4.999","win":"/download/v0.4.999/x.exe"}'

test('正常：只删超出 KEEP 且下载页、latest.json 都不引用的版本（0.4.113 是下载页钉住的入口）', () => {
  const r = run({ versions, latest })
  assert.deepEqual(r.removed, ['v0.4.100'], r.out)
  assert.match(r.out, /跳过 v0\.4\.113/)
})

test('latest.json 指着的旧版本不删', () => {
  const r = run({ versions, latest: '{"version":"0.4.999","win":"/download/v0.4.100/x.exe"}' })
  assert.deepEqual(r.removed, [], r.out)
})

test('读不到 latest.json：一个都不删', () => {
  const r = run({ versions, latest: null })
  assert.deepEqual(r.removed, [], r.out)
  assert.match(r.out, /本次不清理/)
})

test('latest.json 内容坏了（不是那份清单）：一个都不删', () => {
  const r = run({ versions, latest: '<html>502 Bad Gateway</html>' })
  assert.deepEqual(r.removed, [], r.out)
})

test('ssh 连不上：一个都不删', () => {
  const r = run({ versions, latest, sshDown: true })
  assert.deepEqual(r.removed, [], r.out)
})
