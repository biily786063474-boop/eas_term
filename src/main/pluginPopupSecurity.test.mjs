import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const source=fs.readFileSync('src/main/pluginHost.ts','utf8')
test('host does not trust popup iframe canvas capabilities',()=>{
 assert.match(source,/panelCanvasCapabilities\(args\.ctx, info\.permissions\?\.canvas/)
 assert.match(source,/case 'eas\/canvas\.call': \{\s*if \(!panelMayCallCanvas\(p\.ctx\)\)/)
 assert.match(source,/args\.ctx\.surface === 'popup'.*enabled !== false/)
})
