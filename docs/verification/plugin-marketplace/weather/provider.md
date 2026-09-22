# 天气连接器来源与边界 · 2026-09-21
原 Demo：实时天气与未来预报。使用高德官方 Web 服务天气查询，
https://developer.amap.com/api/webservice/guide/api/weatherinfo
GET https://restapi.amap.com/v3/weather/weatherInfo
参数 key（Web服务Key）、city（6位adcode）、extensions（base实况/all预报）、output=JSON。
返回 status/infocode，lives或forecasts，保留reporttime不虚称实时采样。
地域范围为供应商支持的中国行政区，不宣称全球天气。
用户安装后通过统一配置输入自己申请的Key，额度/商业授权依供应商账号协议。
高德key必须在请求查询参数中发送，仅发送固定主机路径；不得记录URL或上游原始错误。
本次不会查询/索要开发者私人Key，也不发任何付费真实请求。
比较来源：https://open-meteo.com/en/docs 、https://open-meteo.com/en/pricing
Open-Meteo商业使用需customer endpoint/APIKey，不把免费非商业服务直接作为默认商用后端。

实际app首验90002失败：连接测试超时，宿主记录“配置插件握手失败（原始诊断已隐藏）”。
根因是验收脚本把网络适配import插到带shebang的server.mjs第一行之前，导致shebang不再首行。
生产包本身未改；仅修复临时验收包prepend逻辑先移除shebang，未放宽宿主错误隐藏或安全限制。
此前脚手架提取地址策略片段时ValueError（搜索不存在的const policy）亦未隐藏：
文件已写入，后改为独立build-weather-plugin从canonical endpointPolicy生成，非手抄策略。

65990修正fixture后退出0：实际隔离应用市场安装、密文Key保存/不回显、连接测试不消费
天气额度、三CLI shim各查实况和预报、清配置停止旧连接，共15项通过，截图已眼验。
3项专项包含真实解包stdio、固定目标+IP/SNI、重定向/私网/超大响应拒绝和密钥错误隐藏。
真实供应商账号与公网返回、真正模型CLI、Windows未验，不把自有fixture当真实天气。
默认本地v2加入天气第7包，未发布。5160全量回归和目录构建运行中，须取实际终态。

5160退出0：全量3440项/3422通过/18skip/0fail；双目录本地构建v1=2/v2=7。
最终截图在所属Frame cnode149，替换自身Excel旧图，不碰用户其他任务内容。
未发布，所有本轮子进程已结束。
