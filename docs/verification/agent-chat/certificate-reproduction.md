# 证书生成失败复现

2026-09-07 的全量回归结果：2455 项，2453 通过，1 失败，1 跳过。
失败发生在 `src/main/phone/identity.test.ts:50`，`createIdentity()` → `pinOfCert()` → X509Certificate，错误 `ERR_OSSL_ASN1_ILLEGAL_PADDING`。

`src/main/phone/identity.ts:108` 无条件在随机序列号前加 00。当前工作树与 HEAD 在此文件无差异；本轮未修改此模块。随机字节首位为 00 时可确定复现，首位 01、80 时均成功。下列命令只在独立 Node 进程内替换随机函数，不写用户证书、密钥或产品代码。

在仓库根执行：

```sh
node --input-type=module - <<'JS'
import crypto from 'node:crypto'
import {createIdentity} from './src/main/phone/identity.ts'
const original = crypto.randomBytes
for (const first of [0x01, 0x80, 0x00]) {
  crypto.randomBytes = size => {
    if (size !== 16) return original(size)
    const bytes = Buffer.alloc(16, 0x12)
    bytes[0] = first
    return bytes
  }
  try {
    createIdentity('e2e-cert-probe', 1756000000000)
    console.log({serialFirstByte: first, result: 'PASS'})
  } catch (error) {
    console.log({serialFirstByte: first, result: 'FAIL', code: error.code})
  }
}
crypto.randomBytes = original
JS
```

实际输出：01 PASS；80 PASS；00 FAIL / ERR_OSSL_ASN1_ILLEGAL_PADDING。
命令用于展示复现结果，捕获异常后退出 0，不是通过判据。此缺陷尚未修复，不能通过重复运行全量测试把失败记录抹掉。

## 0.4.83 修复验证

已移除无条件补零，改为最短正数编码。新增 5 组固定随机值回归：全零、多前导零、7f、80、ff，修复前前两组确定失败，修复后全部可被 OpenSSL 解析并创建 TLS context，既有真实 TLS 握手测试也通过。未改写用户已有证书。
