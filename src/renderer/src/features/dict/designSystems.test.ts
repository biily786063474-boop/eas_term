import test from 'node:test'
import assert from 'node:assert/strict'
import { designPrompt, findDesignSystems } from './designSystems.ts'
const sample={slug:'test',title:'Test kit',services:['AI'],tone:'light',corpus:'背景 #fafafa\n字体：Example\n圆角：24px',swatch:[{n:'--bg-100',v:'#fafafa'}],tokenCount:3,colorCount:1}
test('只配色不携带字体/圆角语料，并明确保护项目设计基因',()=>{const p=designPrompt(sample,'colors');assert.match(p,/#fafafa/);assert.doesNotMatch(p,/Example|24px/);assert.match(p,/保留.*字体.*圆角/)} )
test('完整系统只包含所选语料',()=>{assert.match(designPrompt(sample,'system'),/Example/);assert.match(designPrompt(sample,'system'),/项目/)} )
test('搜索名称分类，明暗过滤组合生效',()=>{assert.equal(findDesignSystems([sample],'test','light').length,1);assert.equal(findDesignSystems([sample],'AI','dark').length,0)})
test('界面类型独立于业务标签并支持多类型和组合筛选',()=>{
 const mobile={...sample,interfaceTypes:['mobile','webapp']}
 assert.equal(findDesignSystems([mobile],'AI','light','mobile').length,1)
 assert.equal(findDesignSystems([mobile],'','light','desktop').length,0)
 assert.equal(findDesignSystems([sample],'','all','unknown').length,1)
 assert.equal(findDesignSystems([mobile],'手机端','all','all').length,1)
})
test('完整模式必须包含规范正文与全部tokens，不能冒充摘要为完整系统',()=>{
 const kit={...sample,designSpec:{text:'Typography 标准正文',tokensCss:':root { --space-9: 36px; }',page:'design-specs/test.html'}}
 const p=designPrompt(kit,'system')
 assert.match(p,/Typography 标准正文/);assert.match(p,/--space-9: 36px/)
 assert.match(designPrompt(sample,'system'),/未收录完整/)
 assert.doesNotMatch(designPrompt(kit,'colors'),/Typography|--space-9/)
})
