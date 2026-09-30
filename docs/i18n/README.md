# 界面多语言（i18n）

2026-09-29 起步（P0 框架）。方案与分期见 `docs/reports/2026-09-29-i18n-plan.html`。

## 怎么写文案
- 词典按区域拆：`src/shared/i18n/dict/<区域>.zh.ts` / `.en.ts`（app、chat、canvas、settings、island、status、dialogs）。`zh.ts` / `en.ts` 只做汇总。
  键名以区域开头（`chat.xxx`），不同区域不许同名（`i18n.test.ts` 会拦）。
  **每个 `.en.ts` 的类型是 `Record<同区域 zh 的键, string>`，中文加了键英文没补，`npm run typecheck` 直接失败。**
- 占位符写 `{name}`：`t('dock.runningFor', { dur })`。中英两边占位符必须一致（`i18n.test.ts` 校验）。
- 组件里：`const t = useT()`（语言切换后自动重渲染）；非组件：`import { t } from '…/i18n.ts'`。
  - 主窗口：`src/renderer/src/i18n.ts`；灵动岛：`src/renderer/island/i18n.ts`；主进程：`src/main/i18n.ts`。
- 术语按 `docs/i18n/glossary.md`。

## 同步保障
| 检查 | 在哪 | 拦什么 |
|---|---|---|
| 类型检查 | en.ts 的类型 | 英文缺键 |
| `src/shared/i18n/i18n.test.ts` | npm test | 占位符不一致、英文里混中文、英文为空 |
| `scripts/check-i18n.mjs` | npm run check | **已迁移文件**里又写死中文（行尾 `// i18n-allow: 原因` 可豁免） |

迁完一个文件，把它加进 `src/shared/i18n/migrated.json` —— 之后它就不会再退回写死中文。

## 语言怎么决定
主进程里 node --test 能跑的纯逻辑模块（以及 src/shared）用 `src/shared/i18n/current.ts` 的 `tm()`；`main/i18n.ts` 启动和切换时同步它，测试里默认中文。

偏好 `prefs.lang`（主进程，`system` / `zh` / `en`，默认 `system`）+ `app.getLocale()` → `resolveLang()`：
系统语言以 zh 开头用中文，其余英文。主窗口和灵动岛首帧从启动参数 `--eas-lang=` 同步拿，切换时主进程广播 `i18n:changed`，并重建应用菜单和 Dock 菜单。

## 不翻的
- 日志（console / logSession）。
- 发给 AI 的提示词、guidance、MCP 工具描述、hook（用户决定：保持中文）。界面是英文时，三种 harness 的系统提示末尾多一句「Always reply in English」（`shared/agentChat.ts` 的 `replyLanguagePrompt()`，起会话时读一次；中文界面为空串，提示词逐字节不变，见 `adapters/replyLanguage.test.ts`）。
- 测试固定按中文跑，现有中文断言不用改。

## 进度（2026-09-29）
- **P0 框架**：完成。
- **P1 主界面**：完成。AI 对话、画布、画布面板、设置 / 密钥柜 / 首次引导、灵动岛、任务监视器、应用菜单、Dock 菜单、原生对话框、顶栏额度、主题名、快捷键、手机页、语音输入。`migrated.json` 156 个文件。
  验收 `scripts/verify-i18n-p1.mjs`：英文界面逐个截图，并扫描可见文本与 placeholder / tip / title / aria-label 里的中文 —— 以上界面残留 0。
- **未做（P2 / P3）**：词典（创作参考）内容库、主进程其余 IPC 错误提示、插件清单文案、`shared/roleBinding` 能力矩阵、`shared/quota`、`cliInstallFeedback` 等共享层文案、官网、更新日志、DMG 背景图。
- **测试怎么写**：源码里找中文的旧写法改用 `src/shared/i18n/testKeys.ts` 的 `usesZh()`；vm 白名单测试用 `src/shared/i18n/testZh.ts` 的中文替身。
- **第一档（2026-09-29）**：完成。浏览器与收藏栏、终端、代码 / Diff / 图片查看、Git 侧栏与历史、角色能力矩阵（界面部分；进 AI 章程的仍是中文）、主进程插件与核心错误提示（约 560 条，只迁显示在界面上的）、AI 按界面语言回答。`migrated.json` 221 个文件。
  验收 `scripts/verify-i18n-t1.mjs`：代码 / 浏览器 / Git / 图片 / 终端英文下残留 0。渲染层 `i18nStore` 同步 `shared/i18n/current.ts`，共享层的 `tm()` 两个进程都跟着界面语言走。
  刻意保留中文：插件协议错误码、MCP 工具结果、逐字匹配用的子进程原文、安装日志、Git 发给 claude 的提示词、wiki 体检文案（与 wiki_lint 共用）。
- **第二档（2026-09-29）**：完成。代码地图（含主进程里显示在界面上的扫描 / 语言服务器错误）、时间线、知识库（含转录错误）、看板、实时页面、对话导航、设计模块、团队面板、插件面板外壳与成果小票、store 里的默认名称与确认框、手机页错误。约 450 条新词条，`migrated.json` 258 个文件。
  验收 `scripts/verify-i18n-t2.mjs`：代码地图 / 团队 / 插件面板 / 知识库 / 对话导航 / 设计 / 看板 / 时间线英文下残留 0。
  显示层翻译（存档数据不改）：代码地图的领地名（`shared/codeGraph.ts` 的中文 id 在 `CodeGraphView` 里映射到词典）、看板内置三列（`features/board/columnName.ts`：id 为 todo/doing/done 且名字仍是出厂中文时才翻，用户改过的名字原样显示）、wiki 体检（英文界面按 kind 改写，抠不出参数就回退原文）。
  新建时写进存档的默认名（终端、未命名、预览等）按创建时的语言保存，切语言后已有的不变。
  刻意保留中文：发给插件 iframe 的协议错误、团队派活的校验错误（回给 AI）、`openArtifact` 的报错（回给 AI）、`lspProvider` 两条仍在 vm 测试里的提示、`tsSymbols` 在 Worker 里抛的「没有 tsconfig」、写进逐字稿文件的「【转录未完成】」头。
- **第三档（2026-09-29）**：完成。
  - **创作参考内容**（用户决定：连插进对话框的提示词一起翻，是「AI 提示词不翻」的例外，只限创作参考）：455 条词条的解释 / 提示词 / 配图文字、分类表、蓝图、设计选型库的标题与摘要。英文放在 `features/dict/dictionary-bundle.en.json`（按 id 覆盖，**英文界面才按需加载**，单独分包），蓝图在 `blueprints.en.json`，设计选型库在 `design-systems.en.json`（显示层片段映射，不改原数据）。应用逻辑在 `dictEn.ts` / `blueprintEn.ts`；分类、区块的中文值仍是筛选与 dict_add 校验的键，只在显示时换。自建词条是用户数据，不翻。
  - **同步保障**：`scripts/check-dict-en.mjs`（已进 `npm run check`）按中文原文指纹比对，中文词条改了英文没跟上就失败并列出 id。补法：只译报出来的那几条，写成批次文件，`node scripts/dict-en/merge.mjs <批次目录>`。
  - 英文词条列表不撑字距（会把单词拆散），整行对齐改为把余宽摊进气泡内边距（`--pill-extra`）。
  - **官网**：`site/en/` 四页，中英页导航互链 + hreflang，窄屏保留语言切换。`publish-site.sh` 已覆盖 en/ 的传输、逐个大小核对、下载链接回填与线上自检。
  - **更新日志**：英文来源 `CHANGELOG.en.md`（格式与中文一致，版本行一字不差）。`changelog.mjs html` 同时生成 `site/en/changelog.html`；某版本没译时英文页照列并标注未译，`check` 只警告不拦发布。发布时 `latest.json` 多写 `notesEn`，英文界面的应用优先用它，空则退回中文条目。**发版时顺手给 CHANGELOG.en.md 补上这一版。**
  - **DMG 背景**：DMG 只有一份，改为英文主提示 + 中文副提示（源文件 `tools/dmg-bg.svg`，`tools/svgrender.cjs` 渲染）；顺手去掉了过时的「未签名版本：首次打开请右键 App → 打开」。
  验收 `scripts/verify-i18n-t3.mjs`（`LANG_UI=zh` 跑中文对照）：词条列表 / 悬停浮层（含配图文字）/ 蓝图 / 设计选型英文下残留 0。官网截图 `docs/verification/i18n-t3/site-*.png`。
