#!/usr/bin/env node
// Build both catalogs locally; publishing is a separate explicit operation.
// v1 receives legacy packages only. v2 preserves compatibility requirements.
import {buildPluginRegistries} from './plugin-registry-build.mjs'
const {v1,v2}=buildPluginRegistries({
 plugins:['plugins-store/pomodoro','resources/plugins/board','plugins-store/local-files','plugins-store/web-fetch','plugins-store/excel','plugins-store/powerpoint','plugins-store/weather','plugins-store/amap'],
 outRoot:process.env.EAS_PLUGIN_OUT_ROOT||'dist/plugins',
 baseUrl:process.env.EAS_PLUGIN_BASE_URL||'https://eas.biily.top/plugins'
})
console.log(`Built registry.json: ${v1.plugins.length} legacy packages`)
console.log(`Built v2/registry.json: ${v2.plugins.length} packages, ${v2.unavailable.length} unavailable entries`)
