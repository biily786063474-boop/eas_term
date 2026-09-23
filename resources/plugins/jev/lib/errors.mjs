const messages=new Map([
 ['Jev authentication failed','TypeSafe 密钥无效或已失效，请在安全连接设置中更新密钥。'],
 ['Jev access denied','TypeSafe 账户没有此模型权限，请检查服务商账户授权。'],
 ['Jev rate limited','TypeSafe 请求过于频繁，请稍后再试；不会自动重复调用。'],
 ['Jev network request failed','无法连接 TypeSafe，请检查网络后重试。'],
 ['Jev request cancelled or timed out','请求已取消或超时；服务商可能已处理，请先查看用量再重试。'],
 ['Capability disabled','此能力已关闭。请由用户在 Jev 面板连接并开启，AI 不能自行授权。'],
 ['No verified connection','尚未验证连接，请先打开安全连接设置并验证服务。'],
 ['Jev 今日调用次数已达上限','今日 Jev 调用次数已达上限，UTC 次日恢复；请勿反复重试。'],
 ['Jev runtime limit reached','并发或当前进程调用次数已达上限，请等待现有请求结束并查看用量。'],
 ['Jev request revoked','请求授权已撤销，结果已丢弃。'],
 ['Invalid Jev response','服务响应格式不符合协议，未使用该结果；请稍后再试。']
])
export function publicError(error){return messages.get(error?.message)??'Jev 请求未完成。请检查连接、开关、授权范围和调用限额。'}
