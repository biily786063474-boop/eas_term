import test from 'node:test'
import assert from 'node:assert/strict'
import { panelCanvasCapabilities, panelMayCallCanvas } from './pluginPanelSurface.ts'
const canvas={nodeId:'n',frameId:'f',projectId:'p',cwd:'/x',surface:undefined}
const popup={nodeId:'',frameId:'',projectId:'p',cwd:'/x',surface:'popup' as const}
test('popup advertises and receives no canvas bridge even if manifest grants it',()=>{
 assert.deepEqual(panelCanvasCapabilities(popup,['canvas_add_note']),[])
 assert.equal(panelMayCallCanvas(popup),false)
 assert.deepEqual(panelCanvasCapabilities(canvas,['canvas_add_note']),['canvas_add_note'])
 assert.equal(panelMayCallCanvas(canvas),true)
})
