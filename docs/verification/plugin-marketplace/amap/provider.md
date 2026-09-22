# 高德地图连接器 · 2026-09-21
按原Demo“路线规划、周边搜索、地理编码”接线。
官方来源：
https://developer.amap.com/api/webservice/guide/api/georegeo
https://developer.amap.com/api/webservice/guide/api-advanced/search
https://developer.amap.com/api/webservice/guide/api/direction
使用固定HTTPS restapi.amap.com：
/v3/geocode/geo（address，可选city）
/v3/place/around（location、keywords、radius、offset、page）
/v3/direction/walking、/v3/direction/driving（origin、destination）
全部GET key/output=JSON。坐标经度在前，输入使用高德坐标系，不隐式把WGS84当作GCJ-02。
默认小结果集，输出保留路径步进、距离与时长；不做导航驾驶承诺。
用户Web服务Key统一密文配置；商业许可、POI高级API/路线调用额度依个人账号权限。
真实高德账号/供应商TLS/公网数据未验证；开发验收只使用自有fixture，不能算上游已验。

验收：先新模块缺失红，4专项通过，覆盖目标/参数、坐标与分页边界、密钥不回显、
实际解包stdio、重定向/私网/超过1MB响应拒绝。
96333构建及实际隔离应用21项通过：真实市场下载确认/hash/安装、safeStorage密文Key、
三shim各做地理编码/周边/步行/驾车共12次业务、清配置阻止旧连接。
只有临时包的DNS/HTTPS拨号接自有响应服务器，生产包不含适配器；原生确认返回值受控。
截图已亲眼检查。未使用个人Key或付费真实调用，供应商数据/TLS、模型CLI/Windows未验。
默认本地v2第8包，未发布。70095全量+目录构建待终态。

70095退出0：全量3444项/3426通过/18skip/0fail，双目录构建v1=2/v2=8。
截图已进本Frame cnode150（仅关闭自身PPT旧图），所有本轮进程已结束，未发布。
