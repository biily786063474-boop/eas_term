#!/usr/bin/env node
// 打包首批插件 + 生成 registry.json，全部落到 dist/plugins/（gitignored，构建产物）。
// publish-plugins.sh 再把 dist/plugins/ 逐个 scp 到服务器。
//
// 收录清单在 PLUGINS 里。往里加一个自家插件目录、重跑本脚本、再 publish 即可上架。
//   · board —— 自包含、跨平台（纯 node）、带 panel + mcp，第一步的样板。
//   · computer 暂不收录：它依赖一个 macOS 专用的 bin/eas-windows（构建产物，非源码），
//     跨平台一键装要分平台打包，留到第二步；MCP wrapper（收录开源 MCP server）是策展步骤，同样后置。
import fs from 'node:fs'
import path from 'node:path'
import { packPlugin } from './pack-plugin.mjs'

const PLUGINS = ['resources/plugins/board']
const OUT_ROOT = 'dist/plugins'
const BASE_URL = process.env.EAS_PLUGIN_BASE_URL || 'https://eas.biily.top/plugins'

const entries = []
for (const dir of PLUGINS) {
  const { entry, zipPath } = packPlugin(dir, { outRoot: OUT_ROOT, baseUrl: BASE_URL })
  console.log(`✓ ${entry.name}@${entry.version}  ${entry.size} B  ${path.relative(process.cwd(), zipPath)}`)
  entries.push(entry)
}

const registry = {
  schema: 1,
  updated: new Date().toISOString(),
  plugins: entries
}
const regPath = path.resolve(OUT_ROOT, 'registry.json')
fs.mkdirSync(path.dirname(regPath), { recursive: true })
fs.writeFileSync(regPath, JSON.stringify(registry, null, 2) + '\n')
console.log(`\nregistry.json 写好: ${path.relative(process.cwd(), regPath)}（${entries.length} 条）`)
