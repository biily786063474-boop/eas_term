import { t } from '../../i18n.ts'
import type { I18nKey } from '../../../../shared/i18n/index.ts'
import { isMobileBlueprint } from './blueprintEn.ts'
export interface Region { block:string; x:number; y:number; w:number; h:number; location:string; overlay?:boolean }
interface Blueprint {id:string;platform:string;slots:{block:string;note:string}[]}
/** 最后一项是区块说明的词典键（渲染时现取，语言可切换） */
type Box=[number,number,number,number,I18nKey,boolean?]
// 对象键是区块的中文名 —— 数据键（与 blueprints.json 的 slots.block 对应），不是界面文案。
/** Schematic positions, not a promise of exact pixels in the user's product. */
export function blueprintRegions(bp:Blueprint):Region[]{
 const mobile=isMobileBlueprint(bp)
 const boxes:Record<string,Box>=mobile?{
  '导航栏':[76,24,168,28,'dictUi.bp.loc.m.nav'], // i18n-allow: 区块数据键
  '搜索':[76,60,168,25,'dictUi.bp.loc.m.search'], // i18n-allow: 区块数据键
  '首屏':[76,94,168,50,'dictUi.bp.loc.m.hero'], // i18n-allow: 区块数据键
  '轮播':[76,151,168,35,'dictUi.bp.loc.m.carousel'], // i18n-allow: 区块数据键
  '金刚区':[76,194,168,39,'dictUi.bp.loc.m.iconGrid'], // i18n-allow: 区块数据键
  '列表':[76,242,168,53,'dictUi.bp.loc.m.list'], // i18n-allow: 区块数据键
  '标签栏':[76,308,168,28,'dictUi.bp.loc.m.tabBar'], // i18n-allow: 区块数据键
  '图集':[76,63,168,118,'dictUi.bp.loc.m.gallery'], // i18n-allow: 区块数据键
  '卡片':[76,194,168,92,'dictUi.bp.loc.m.card'], // i18n-allow: 区块数据键
  '表单':[76,68,168,208,'dictUi.bp.loc.m.form'], // i18n-allow: 区块数据键
  '按钮':[76,306,168,30,'dictUi.bp.loc.m.button'], // i18n-allow: 区块数据键
  '弹层':[94,137,132,104,'dictUi.bp.loc.m.overlay',true], // i18n-allow: 区块数据键
  '空状态':[90,161,140,70,'dictUi.bp.loc.m.empty',true] // i18n-allow: 区块数据键
 }:{
  '导航栏':[16,28,288,31,'dictUi.bp.loc.d.nav'], // i18n-allow: 区块数据键
  '侧边栏':[16,67,66,242,'dictUi.bp.loc.d.sidebar'], // i18n-allow: 区块数据键
  '首屏':[16,70,288,118,'dictUi.bp.loc.d.hero'], // i18n-allow: 区块数据键
  '搜索':[92,69,212,28,'dictUi.bp.loc.d.search'], // i18n-allow: 区块数据键
  '卡片':[92,77,212,70,'dictUi.bp.loc.d.card'], // i18n-allow: 区块数据键
  '表格':[92,78,212,200,'dictUi.bp.loc.d.table'], // i18n-allow: 区块数据键
  '列表':[92,159,212,148,'dictUi.bp.loc.d.list'], // i18n-allow: 区块数据键
  '表单':[16,76,166,210,'dictUi.bp.loc.d.form'], // i18n-allow: 区块数据键
  '按钮':[16,310,288,27,'dictUi.bp.loc.d.button'], // i18n-allow: 区块数据键
  '页脚':[16,313,288,27,'dictUi.bp.loc.d.footer'], // i18n-allow: 区块数据键
  '弹层':[115,120,168,121,'dictUi.bp.loc.d.overlay',true], // i18n-allow: 区块数据键
  '空状态':[116,170,162,70,'dictUi.bp.loc.d.empty',true] // i18n-allow: 区块数据键
 }
 if(bp.id==='m-profile'){boxes['卡片']=[76,30,168,83,'dictUi.bp.loc.profileCard'];boxes['列表']=[76,125,168,165,'dictUi.bp.loc.profileList']} // i18n-allow: 区块数据键
 if(bp.id==='m-list')boxes['列表']=[76,98,168,193,'dictUi.bp.loc.listList'] // i18n-allow: 区块数据键
 if(bp.id==='d-landing')boxes['卡片']=[16,202,288,61,'dictUi.bp.loc.landingCard'] // i18n-allow: 区块数据键
 if(bp.id==='d-editor')boxes['卡片']=[195,76,109,210,'dictUi.bp.loc.editorCard'] // i18n-allow: 区块数据键
 if(bp.id==='d-docs'){boxes['列表']=[245,76,59,215,'dictUi.bp.loc.docsList'];boxes['卡片']=[92,98,143,150,'dictUi.bp.loc.docsCard']} // i18n-allow: 区块数据键
 if(bp.id==='d-landing')boxes['按钮']=[104,276,112,26,'dictUi.bp.loc.landingButton'] // i18n-allow: 区块数据键
 return bp.slots.map(s=>{const box=boxes[s.block];if(!box)throw Error('Missing blueprint region: '+s.block);const [x,y,w,h,loc,overlay]=box;return {block:s.block,x,y,w,h,location:t(loc),overlay}})
}
