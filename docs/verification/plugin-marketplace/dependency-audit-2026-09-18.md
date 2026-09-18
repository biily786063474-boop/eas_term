# MCP SDK 引入时的依赖审计

SDK：@modelcontextprotocol/sdk 1.30.0，精确锁定，安装时禁用 lifecycle scripts。
npm audit 当前报告18项：1 moderate、16 high、1 critical。下表逐路径对比改动前lock。
所有被报告路径版本在改动前已存在；这不是风险豁免，也不表示新增SDK不会使用这些依赖。未执行 audit fix --force。

|包|严重性|旧版本→当前|
|---|---|---|
|@electron/node-gyp|high|10.2.0-electron.1 → 10.2.0-electron.1|
|@electron/rebuild|high|3.7.2 → 3.7.2|
|@xmldom/xmldom|high|0.8.13 → 0.8.13|
|baseline-browser-mapping|moderate|2.10.35 → 2.10.35|
|brace-expansion|high|1.1.15 → 1.1.15 / 1.1.16 → 1.1.16 / 2.1.1 → 2.1.1 / 5.0.6 → 5.0.6|
|browserslist|high|4.28.2 → 4.28.2|
|cacache|high|16.1.3 → 16.1.3|
|electron|high|37.10.3 → 37.10.3|
|extract-zip|high|2.0.1 → 2.0.1|
|fast-uri|high|3.1.2 → 3.1.2|
|form-data|high|4.0.5 → 4.0.5|
|ip-address|high|10.2.0 → 10.2.0|
|js-yaml|high|4.2.0 → 4.2.0|
|make-fetch-happen|high|10.2.1 → 10.2.1|
|nanoid|high|3.3.12 → 3.3.12|
|postcss|high|8.5.15 → 8.5.15|
|tar|critical|6.2.1 → 6.2.1 / 7.5.16 → 7.5.16|
|undici|high|6.26.0 → 6.26.0|

Critical 位于 tar；修复应单独评估 Electron 打包与重建依赖链并完成回归。当前远程模块尚未接入生产宿主。
