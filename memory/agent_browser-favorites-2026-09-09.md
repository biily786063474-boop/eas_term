# 浏览器收藏本轮验收
工作树 .worktrees/browser-favorites，分支 feat/browser-favorites，前批ad790f9。实现与测试证据见docs/verification/browser-wave/README.md。
最终方向：五目录贴纸文件夹+自定义，二级340px直排（无OGL），末尾渐隐/粒子呼吸仅有后续内容且激活时；滚轮/拖拽，显式确认本地页面预览；个人登录沿用persist:browser。
正式browser_routes工具+eas-favorites home/save路由和随包本地HTML/JSON已接。CSP只放行本地预览img协议，guest无法读主窗口IPC。
全量2805项2792通过13skip0fail，真实工作流/字典/重启/20轮4宿主回归通过；截图已看。缩回保留隐藏几何并恒定内容布局，冷首轮峰值175→58.3ms，暖机约9–10ms；仍有冷收尾，不承诺低端GPU零卡。Windows及真实运行终端/付费AI负载未测。
Motion Sites/短视频助手准确URL仍pending，用户异步问题已发；不猜。未批量抓取公共截图，无截图就写暂无预览。
开发实例由scripts/open-browser-acceptance.mjs启动，profile及PID见docs/verification/browser-wave/acceptance/instance.json（git忽略）。用户自行关闭，不全局杀服务。保留正式版和root dirty文件；不发版/不push/不合并。
