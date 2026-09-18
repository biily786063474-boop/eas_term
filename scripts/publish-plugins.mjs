#!/usr/bin/env node
import {publishPluginRegistries,SshPluginPublisher} from './plugin-publish.mjs'
// Requiring an explicit flag makes an accidental script invocation non-mutating.
if(process.argv.length!==3||process.argv[2]!=='--publish'){
 console.error('Usage: bash scripts/publish-plugins.sh --publish\nExplicit --publish is required. No connection or upload was made.')
 process.exitCode=2
}else{
 try{
  const result=await publishPluginRegistries({
   source:process.env.EAS_PLUGIN_OUT_ROOT||'dist/plugins',
   baseUrl:process.env.EAS_PLUGIN_BASE_URL||'https://eas.biily.top/plugins',
   transport:new SshPluginPublisher({host:process.env.EAS_PLUGIN_PUBLISH_HOST||'server',root:process.env.EAS_PLUGIN_PUBLISH_ROOT||'/www/wwwroot/eas/plugins'})
  })
  console.log(JSON.stringify(result,null,2))
  console.log('Remote files promoted. HTTP/CDN visibility still requires separate verification; no service reload performed.')
 }catch(error){console.error('Publish stopped: '+error.message+'\nDo not blindly retry an uncertain SSH result; inspect the release directory/lock first.');process.exitCode=1}
}
