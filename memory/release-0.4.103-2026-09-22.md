# 0.4.103 发布进行中（用户明确优先）
插件/WPS工作暂停保留在 ../release-0.4.102，不能混入这版。
工作区本目录 release-0.4.103，origin/main 0613056 + local main ffe7022 合并 d9bc78e；发布准备 97494eb 已推 origin/release/0.4.103。主目录脏改动未动。
全检3289通过19跳过，构建成功；UI及失败证据见 docs/verification/releases/0.4.103.md。
Windows CI 35703021002 success，EXE在 ~/Eas-Term-release，截图已看。
第一次Mac共享node_modules漏fd-slicer导致启动原生错误，未发布，失败保留；改独立npm ci。Node26 postinstall yargs失败，现使用 ~/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node (22.23.2)，独立npm ci成功，重新签名公证中。
后台任务 session 99396，日志 /tmp/eas-plugin-visible-task.log；wrapper每5秒更新原Frame进度页。完成前不结束跟踪。
官网仍0.4.102；未push main/tag、未创建Release。/tmp/eas-publish-103.py 已备但未执行，有release-gates-passed.json防误发门槛；须先双架构smoke/签名/公证/DMG核对，记录真通过才能生成门槛文件。
服务器两层索引/单机档案已读，mini域发布前504其他6站200，pm2五个online，不改服务。
