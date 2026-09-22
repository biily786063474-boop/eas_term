# 天气（高德 Web 服务）

两个只读工具：weather_current 实况、weather_forecast 预报。
city 是6位高德行政区adcode。保留供应商 reporttime 与来源，
不以调用时间冒充数据采样时间。覆盖高德支持的中国行政区，不承诺全球天气。

安装后在插件设置填写自己申请的高德「Web服务」Key，通过宿主密钥柜加密保存，
不写到CLI配置，不由工具参数接收密钥。Key只发送固定
https://restapi.amap.com/v3/weather/weatherInfo ，不跟随跳转、
拒绝私网/混合DNS、固定解析IP并保留TLS SNI、15秒/1MB限制。
不记录请求URL，不返回原始网络异常/供应商错误或任意供应商字段。
连接测试只列工具，不消耗天气查询额度；真实查询按账号权限/额度和商业授权使用。
密钥柜锁定、断开清配置沿用宿主失效机制。

不需运行时npm下载，无第三方运行依赖。地址策略由
node scripts/build-weather-plugin.mjs 从宿主 canonical endpointPolicy.ts 生成。
系统PAC/fake-IP网络支持未完成，公开地址检查不会为绕过代理而放宽。
官方协议、API与额度以供应商为准，未内嵌/借用任何账号或密钥。

来源：https://developer.amap.com/api/webservice/guide/api/weatherinfo
验证：自有天气响应fixture经过真实市场安装/安全存储/三shim业务。
真实高德账号、供应商TLS与返回数据、真实模型CLI及Windows未验，
不得把fixture当作生产上游验收。
