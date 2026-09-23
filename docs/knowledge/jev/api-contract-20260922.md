# TypeSafe API 核对
2026-09-22 读取 https://docs.typesafe.ai/api 成功；此前 .md 入口失败。
实现依据：POST https://api.typesafe.ai/v1/systemone，Bearer 凭证；state/model/questions；
问题类型 noul/choice/score；回答须按 ID 和类型匹配，含 model/answers/usage。
当前本地限制：32 问、128KB 请求、256KB 响应、15 秒截止、拒绝重定向。
限制为产品侧保守值，不代表官方上限。客户端只做协议处理，授权/预算/撤销在 runtime/宿主。
在线调用尚未验证；Score/Choice 完整代表性夹具仍待补。

再次核对官方 API（2026-09-22）：Choice criteria 可为 null；Score 的等级索引从 0 开始，legend 与 probabilities 的键一致，score 为概率加权值。已增加两类完整响应夹具和缺项拒绝测试；响应按字段重建，不向上层传递未知 debug 字段。在线请求依旧未验证。
