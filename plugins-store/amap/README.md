# 高德地图

三个只读工具：
- amap_geocode：结构化地址转坐标，并返回adcode，可供天气查询使用。
- amap_nearby：按给定坐标与关键词查周边POI，支持半径、分页；每页最多25条。
- amap_route：按起终点查询步行或驾车路线、距离、时长及文字步骤。

安装后在统一设置填写高德Web服务Key；权限、调用额度及商业许可由用户账号决定。
地址与坐标会发送给高德；不自动获取设备位置，不读取其他插件的Key。
输入/输出使用高德GCJ-02坐标，经度在前、纬度在后，最多6位小数，
不能直接把GPS WGS84坐标当成高德坐标。地域以供应商API支持范围为准。

Key仅由宿主密文配置注入，不通过工具参数或CLI配置传入。
网络限制固定HTTPS restapi.amap.com的四条API路径；
每次公开DNS检查并固定IP/TLS SNI，不跟随跳转，15秒/1MB限额。
错误不回显Key/URL或供应商原始诊断。返回白名单字段，条数与体积有界。
连接测试仅列工具，不消耗接口查询额度。路线只作规划参考，不是实时导航。

无第三方运行依赖，无运行时npm下载。地址策略用
node scripts/build-amap-plugin.mjs 从canonical endpointPolicy.ts生成，不手改。
更新此包不要求软件随包更新；仍须兼容宿主mcp.stdio/config.fields。

实际市场/密文配置/三CLI shim已用自有响应fixture验收，
不代表真实高德账号、供应商TLS/公网数据、模型CLI或Windows已验。
系统代理/PAC/fake-IP兼容尚未解决，不放宽私网规则绕过。

官方来源：
https://developer.amap.com/api/webservice/guide/api/georegeo
https://developer.amap.com/api/webservice/guide/api-advanced/search
https://developer.amap.com/api/webservice/guide/api/direction
