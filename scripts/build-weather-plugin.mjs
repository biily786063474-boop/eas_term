// Keep the stdio connector's address policy derived from the canonical host policy.
import fs from 'node:fs'
import ts from 'typescript'
fs.writeFileSync('plugins-store/weather/lib/address-policy.mjs','// Generated from endpointPolicy.ts; do not hand edit.\n'+ts.transpileModule(fs.readFileSync('src/main/pluginConnections/endpointPolicy.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText)
