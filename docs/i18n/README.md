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
偏好 `prefs.lang`（主进程，`system` / `zh` / `en`，默认 `system`）+ `app.getLocale()` → `resolveLang()`：
系统语言以 zh 开头用中文，其余英文。主窗口和灵动岛首帧从启动参数 `--eas-lang=` 同步拿，切换时主进程广播 `i18n:changed`，并重建应用菜单和 Dock 菜单。

## 不翻的
- 日志（console / logSession）。
- 发给 AI 的提示词、guidance、MCP 工具描述、hook（用户决定：保持中文，AI 按用户提问语言回答；P1 之后再议）。
- 测试固定按中文跑，现有中文断言不用改。
