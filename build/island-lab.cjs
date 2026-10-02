const base=require('../package.json').build
module.exports={
 ...base,
 appId:'com.biily.easterm.islandlab',productName:'Eas-Term Island Lab',
 extraMetadata:{name:'eas-term-island-lab',productName:'Eas-Term Island Lab',version:'0.4.114-islandlab.1'},
 directories:{...base.directories,output:'release-island-lab'},
 publish:null,afterSign:undefined,
 mac:{...base.mac,identity:null,target:[{target:'dir',arch:['arm64']}],artifactName:'Eas-Term-Island-Lab-${version}-${arch}.${ext}'},
 // 原生宿主与页面资源已在 base.mac.extraResources（正式版同款），这里不再重复加
}
