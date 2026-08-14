# skillLibrary —— 改这里之前先看这张表

Skill 管理面板的主进程侧。设计文档：`docs/superpowers/specs/2026-08-14-skill管理面板-design.md`。

## ⚠️ 分类口子是**四处一起维护**的

给 agent 开的分类工具（`skill_list` / `skill_categorize`）的定义、执行、落盘、以及教 agent
怎么用它的那份 skill，分散在四个文件里。**改任何一处，其余三处都要跟着改**，
否则 agent 会照着一份过期的说明去调一个已经变了的工具，而且不会有任何测试报错。

| 这个东西 | 在哪 |
|---|---|
| 工具名 / 描述 / 输入 schema | `mcp/eas-mcp.mjs`（`skill_list`、`skill_categorize` 两条） |
| 执行（转发 + 把结果讲成 agent 能照着改的话） | `src/renderer/src/mcpHandler.ts` |
| 校验与落盘 | 本目录 `index.ts`（IPC）+ `category.ts`（`validateCategoryBatch`，有单测） |
| **教 agent 怎么用的那份 skill** | `<项目>/.claude/skills/skill-organizer/SKILL.md` |

典型的会脱节的改动：改了分类名长度上限（`CATEGORY_NAME_MAX`）、改了「整批拒绝」的规则、
加了一个新字段、把 `assignments` 改名。这几种改动**必须**同步更新那份 skill 的「硬规矩」一节。

## 数据落在哪

`<userData>/skills.json` 一份文件，三个字段：

| 字段 | 是什么 | 谁写 |
|---|---|---|
| `customDirs` | 用户自己加的 skill 目录 | 面板的「添加自定义目录…」 |
| `categories` | `Record<skill 绝对路径, 分类名>`，**扁平一层、单分类** | `skill_categorize`（MCP） |
| `disabled` | 被临时禁用的 skill 绝对路径数组 | 面板右键「禁用」 |

`saveConfig` 是 **patch 语义**（只覆盖传入的字段）。三个字段共用一份文件，
改其中一个绝不能把另外两个冲掉。

**skill 的唯一 id 就是它的目录绝对路径**，没有别的 id 字段。

## 碰用户硬盘的边界

细节和论证在 `index.ts` 与 `write.ts` 的文件头，这里只给结论：

- **读**（列目录 / 读 SKILL.md）：不过 fsGuard，理由在 `index.ts` 文件头。
- **写用户的 skill 目录**（`copySkill` / `writeFile`）：走本模块自己的、**比 fsGuard 更窄**的
  边界——只能写「已登记的 skill 目录」和「已注册项目的 `<项目>/.claude/skills`」，
  且落点必须在那些根之内的 skill 子目录里。**不改 fsGuard，也不绕过它。**
- **只写 app 自己配置**（目录列表 / 分类 / 禁用）：全部落在 `<userData>/skills.json`，
  一个字节都不碰用户的 skill 文件。禁用与分类刻意走这条路，是用户拍板的决定
  （design 文档 §六 第 1 条 / §四）。

## 用户已拍板、不要重新讨论的几条

1. 禁用只写清单，不动文件。代价（CLI 仍会加载它）已知并接受，但**面板上要写出来**。
2. 复制遇到重名 → **拒绝**并说明，不覆盖、不自动改名。
3. 分类扁平一层，不可嵌套。
4. agent 报了一个不存在的 skill → **拒绝整批**，不是静默丢弃那一条。
