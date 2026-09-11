# 密钥柜UI回归 · 2026-09-10

## 字段与调用
- 分组：SecretMeta.id/name/note/autoInject，列表数量取vars.length；不添加服务账户/额度/过期时间等后端没有的字段。
- 保存：SecretSaveInput.id/name/note/autoInject/vars；每行varName/value/from。留空值沿用旧密文，重命名靠from关联。后端依旧校验变量名、重名、系统加密及解锁状态。
- 文件导入：pickEnvFile→commitImport(name,varNames,autoInject:true)；密钥文件：pickKeyFile→commitKeyFile(groupName,varName)。没有改成把文件内容传到渲染层。
- 查看：原reveal接口，屏幕继续mask，仅复制按钮获取完整值。搜索只读取元数据。备注说明AI可读。
- 锁定/初始化/解锁/换码/删除确认保留原调用，主进程、preload、shared接口均未修改。

## 隔离实测
应用由scripts/verify-app.mjs --port 9462启动，独立临时userData，未seed用户文件。仅创建DEMO_开头的虚构值，不触碰真实密钥柜。
fixture-ui-test.mjs为该隔离实例的回归脚本，硬编码9462；只允许在已准备的虚构测试柜运行，会清除并重建测试分组。不可连接正式实例。
ui-results.json记录：搜索/无结果、UI新增、编辑变量重命名但保留值、note/autoInject持久化、打码查看、真实锁定解锁、后端重复变量错误回显。manage/new/locked.png来自构建后真实应用截图，已逐张检查。

## 验证边界
原生文件选择→实际.env/私钥文件导入、换码、15分钟超时和Windows未做本轮端到端操作；旧处理函数及后端未改动不等于这些路径已实测。未发版。
首轮测试脚本在读取锁定状态时因Runtime.evaluate表达式含顶层await报SyntaxError（非产品失败），改为Promise表达式后重跑通过；不得忽略这次失败记录。

最终验证：npm run check通过，2869项中2856通过、13跳过、0失败；build通过（保留现有混合import分包警告）。最终构建后fixture-ui-test重跑通过。
