# 浏览器收藏夹视觉稿
用户要先出视觉稿，暂未批准正式功能实现。本地交互稿 docs/prototype/2026-09-08-browser-favorites.html，已通过canvas_open_html放入frame-9-pd0nj。五个默认固定分类：动效、设计、办公、服务器网站、自媒体平台。顶部收藏栏→一级目录网站卡片；明暗切换、搜索、登录设置模拟开关。字母是占位图标。保留登录是计划行为，不是已实现，不保证站点永久免登录。
用户提供站点/描述已当场保存在HTML数据；避免未经核实的数量/大厂宣传。Motion Sites多同名域名待确认，小红书创作者中心抓取失败如实标注。补充Notion/飞书/Cloudflare/Vercel/抖音，官网已浏览。实际Electron独立预览截图在/tmp/eas-favorites-*.png；运行通过，首轮临时profile缓存创建报错，不影响页面渲染，不隐瞒为浏览器产品验证。
# 前一任务发布交接
官网与latest0.4.87已发布且公网核验通过。main已ff到f497bdf并push。GitHub五包上传已完成，但2026-09-08 22:09查询仍为draft，摘要/发布/证据归档未完成；不要误称GitHub正式发布完成。旧PTY失效，后续先核对原release，不重复上传。不阻塞本次视觉稿。

## 22:29 悬停白色长条修复
用户截图指出hover时巨大白条。真实Electron mouseMove复现，同时出现tile memory limits exceeded。DOM边界正常。控制实验：禁用backdrop-filter或改2D变换均消除；根因锁定rotateX+背景模糊合成组合。最终移除原backdrop-filter（不叠覆盖规则），用近不透明多层渐变模拟磨砂，保留3D展开。真实hover截图 /tmp/folder-hover-fixed.png 已检查，无白条；实际mouseDown/up进入动效目录通过。仅本地视觉稿，不是正式软件代码。

## 22:34 收藏链路03
用户批准把收藏链路落入当前视觉稿。☆打开网站名称/网址/文件夹面板，默认示例React Bits；选择预置或自定义、新建命名选贴纸并自动选中、收藏成功toast进入目录。自定义分类点击进入/右键编辑，空状态可收藏。重名文件夹、重复URL、非HTTP(S)/含凭证URL拒绝，动态文本转义。仅内存演示，刷新不保留，尚未接入正式WebView或持久化。实际Electron验证8项通过，截图/tmp/favorites-save-flow.png。已清理两份自己开的旧视觉稿，打开最新一份。

## 22:49 网站卡片04
用户提供海报式彩色卡片参考，已存 docs/prototype/2026-09-08-site-card-reference.png。网站卡片改上方预览区域、下方大标题/简介/域名/标签；文件夹不变。当前上方用明确标注的构图示意封面，不冒充真实网站截图；正式接入仍需网站截图获取/失败回退方案。收藏链路回归8项通过，真实Electron卡片截图已检查 /tmp/favorites-poster-cards.png。原型未接入生产代码。

## 22:58 弧形画廊05
用户指定CircularGallery语义效果，motion-picker索引确认webgl-ogl/ogl。已在二级目录加入自写OGL圆弧排布适配（非原组件直接复制），海报生成本地canvas纹理并内联OGL bundle，无远程依赖。源码docs/prototype/browser-gallery/gallery-entry.js。滚轮/拖拽/方向键、ambient、hover暂停自动移动；明确链接按钮避免拖动误开；可切列表，reduced-motion默认列表，WebGL失败回退。DPR最多1.5、离屏/后台停止render、切目录释放几何/纹理/program/context。真实Electron画面已渲染，收藏8项回归通过；尚未正式应用接入。预览图仍示意非官网截图。

## 22:59 本轮统一规划
用户要求把词典蓝图hover弹窗不消失一起纳入浏览器收藏/画廊本轮。已写spec与七阶段plan：docs/superpowers/{specs,plans}/2026-09-08-browser-favorites-and-dict.md。仅规划，未改正式源码。发现BlueprintPanel词条缺局部leave而普通词条已有，是待复现根因候选；WebView已persist:browser，不重复实现登录存储。

## 23:00 追加规划
用户反馈二级卡片小、Frame模块从全屏缩回严重卡顿。已追加spec与plan Task5A/6A：中心卡放大/减少可见数量/可读性与自适应；全屏恢复先做跨模块真实trace定位，不假定是OGL导致，不叠动画补丁。未改实现，未复现卡顿，不能宣称修复。

## 23:16 用户取消扇形
最新决定覆盖旧方案：网站卡片水平一排、直立大卡、原生横向滚动，不使用OGL/圆弧/倾斜/自动转动。spec/plan已补覆盖规则，原型06已移除内联OGL运行时并改340px横排卡；收藏回归通过。旧gallery-entry.js仅历史参考，禁止接入正式代码。

## 23:23后正式实施第一批
已建立隔离worktree `.worktrees/browser-favorites` / branch `feat/browser-favorites`，提交ad790f9。主目录用户脏改未动、未合并未push未发版。
- 新增shared/browserRoutes.json单一路由源、生成脚本、docs/browser/{routes.json,index.html,AGENT-ROUTING.md}。小红书发布意图直达creator入口；HTML只读、MCP发现与表单deep-link尚未接。
- BlueprintPanel词条onMouseLeave最小修复；静态红绿与真实组件红绿，构建应用真实词典→蓝图hover/leave验证通过，证据worktree/docs/verification/browser-wave/dict-hover。
- npm run build通过、修改前baseline typecheck通过；3项定向回归通过；整轮check未跑。
- 下一步：收藏schema/受保护IPC/真实WebView首页与表单/本机截图/横排大卡提示/会话测试/agent路由安装包与MCP接线/Frame收回trace。不要误把只读HTML说成完整收藏产品。用户要求整个计划落实，目前仅首批完成。
- 当前已有useFlip.ts里延迟恢复useHidingHolder与等待廉价帧逻辑，卡顿曾有旧修复，必须全局查冲突并trace，不再随便叠等待。

## 2026-09-09 整轮实现与开发验收交付
隔离worktree `.worktrees/browser-favorites` / `feat/browser-favorites` 已提交 `9614b9f`（前批ad790f9），工作树干净；未合并、未push、未发版。
- 正式收藏schema/窄IPC/贴纸目录与自定义收藏闭环/340px直排大卡/边缘提示/可选本地截图/HTML表单及MCP browser_routes全部接线。persist:browser不变，完整重启Cookie+收藏回归通过。
- 全量2805项：2792通过、13跳过、0失败。构建成功；真实工作流19项、字典2项、混合UI35项（含20轮4宿主与50%/150%缩放终点）通过，独立审查Important已修复并复核。
- 收回改为隐藏但保留布局+恒定旧内容布局，只动画transform；冷帧175→58.4ms，暖机约10ms；仍有冷收尾，不说零掉帧。Windows、真实运行终端/付费对话负载未实测。
- Motion Sites和短视频助手具体网址仍待用户确认，异步问题已发；保留pending，没猜。无公开站点截图时明确暂无预览。
- 开发验收实例已打开并刷新到最新代码：PID81467 / debugger61540，独立profile `/var/folders/7s/29s7qf5s7w778xnb_txz3_q00000gn/T/eas-builtin-ui-qMen5d`。标题“浏览器收藏 · 开发实例”，主Frame“开发验收 · 收藏与模块动效”；由用户关，不全局杀进程。Node监护工具session9803保持运行，本机fixture HTTP也随之存活。
- 证据与操作：worktree/docs/verification/browser-wave/README.md；instance.json在该目录acceptance/（git忽略）；重开命令`node scripts/open-browser-acceptance.mjs`。详细源码记忆在worktree/memory/agent_browser-favorites-2026-09-09.md。
