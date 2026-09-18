import test from 'node:test'
import assert from 'node:assert/strict'
import {catalogSource} from './pluginCatalogSource.ts'
test('new clients use the approved v2 catalog',()=>{assert.equal(catalogSource().url,'https://eas.biily.top/plugins/v2/registry.json')})
test('source-specific cache never reuses an unbound legacy cache',()=>{const s=catalogSource();assert.notEqual(s.cacheFile,'plugin-registry-v2.json');assert.match(s.cacheFile,/^plugin-registry-v2-[a-f0-9]{64}\.json$/)})
test('distinct catalog endpoints cannot share offline entries',()=>{assert.notEqual(catalogSource('https://eas.biily.top/plugins/registry.json').cacheFile,catalogSource().cacheFile);assert.notEqual(catalogSource('http://127.0.0.1:1/a').cacheFile,catalogSource('http://127.0.0.1:2/a').cacheFile)})
test('same explicit source has stable cache identity',()=>{assert.deepEqual(catalogSource('https://eas.biily.top/plugins/v2/registry.json'),catalogSource());assert.deepEqual(catalogSource(''),catalogSource())})
