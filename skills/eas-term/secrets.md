# 密钥获取

这份文件是拿密钥的具体步骤 —— 三个工具按什么顺序调、`purpose` 字段的红线、
包装命令怎么写引号、密钥无效了怎么办。SKILL.md 判断出撞到缺 key 或鉴权失败后来读这份。

---

## 密钥怎么拿

密钥一旦贴进对话，就永久留在会话记录里、也跟着上行到模型那边 ——
这个软件专门要消灭的就是这件事。所以有三个工具，按这个顺序用：

**① 开跑前先查** —— `secret_check({ vars: ["OPENAI_API_KEY"] })`

别去 `echo $VAR` 或翻 `.env` 找。返回里的 `next` 会直接告诉你下一步该干嘛，照着做就行。

**② 没有就要** —— `request_secret`

```
request_secret({
  name: "AWS 生产账号",
  vars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],   // 成对的一次写全
  purpose: "需要调用 S3 把构建产物传上去",                  // 会原样显示给用户
  docs_url: "https://console.aws.amazon.com/iam"
})
```

`purpose` 一字不改地显示给用户。**编理由骗用户填东西是这里唯一的红线**——
用户被弹窗骗过一次，这功能就废了。

**③ 用它跑命令** —— `eas-secret run --vars VAR1,VAR2 -- <你的命令>`

```
eas-secret run --vars AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY -- aws s3 cp dist/ s3://bucket/ --recursive
```

为什么不能直接 `$AWS_ACCESS_KEY_ID`：**进程的环境变量在启动那一刻就定死了**，
用户刚存的东西，你这个终端读不到。包装命令会现取现用，值直接进子命令的环境，
不经过终端输出、也不进 shell history（命令行里只有变量名）。

> ⚠️ **命令里要引用 `$变量` 时，必须让子进程自己展开**——这是最容易踩的坑：
>
> ```sh
> # 对：单引号，$API_KEY 留给子进程的 sh
> eas-secret run --vars API_KEY -- sh -c 'curl -H "Authorization: Bearer $API_KEY" https://api.x.com'
>
> # 错：双引号，外层 shell 先把 $API_KEY 吃成空 → 服务返 401
> eas-secret run --vars API_KEY -- sh -c "curl -H \"Bearer $API_KEY\" https://api.x.com"
> ```
>
> 踩了这个坑会得到 401，然后你会以为是用户的 key 无效去调 `report_secret_invalid`，
> 让用户白白重填一个完全正确的密钥。**401 之前先检查自己是不是写成双引号了。**
>
> 命令自己读环境变量的（`aws`/`gh`/`docker`/`terraform` 这类）直接写就行，不用管这条。

只有 `secret_check` 返回 `ready: true` 时才可以直接写 `$VAR`。
`ready:false` 但 `needsWrapper` 里有它 → 走上面的包装命令。

**④ 用了但服务说无效** —— `report_secret_invalid({ vars, detail })`

把服务返回的原话放进 `detail`，弹窗让用户自己改。
**别向用户要明文来「帮他核对」**——那等于绕过前面所有努力。

### 三条不要越的线

1. **值永远不会回给你**，所有返回里只有变量名。别追问用户「你填的是什么」。
2. **别 echo / cat / env 去看这些变量**。技术上你看得见，但打印出来它就进对话记录了。
3. 限流：每分钟一次；同一终端被连续拒绝 2 次后本轮就不能再调。被拒了换个思路，别反复试。
