# OMP 显式扩展与配置覆盖核验

日期：2026-09-08。随包 mac-arm64 OMP 18.1.2。只读配置 probe，没有发送模型 prompt、没有改用户配置。

二进制 SHA-256：`5f2512cce2a154ad2406a4792421c42f022b1335f83dcbde4236f76e50ab35b4`。

## 结论

优先追加原生 `-e <trustedBuiltinRoot>`，无需改写用户 extensions 或启动额外 config probe。实际随包内嵌源码把 explicit roots 同时传给 MCP discovery；标准插件目录的 plugin.json/mcp.json 由 agent-plugins provider 读取。`--no-extensions` 对 explicit roots 使用 explicit-only 模式，保留显式 -e；用户关闭 Eas 模块时宿主应不注入对应内置服务。

以下为随包二进制内嵌 JS 的直接源码片段（非外网版本）。`Zp`/`Dtl` 为会话装配，`nQ` 属于 discovery/omp-extension-roots.ts；`fhr`/`lru`/`aru` 属于 discovery/agent-plugins.ts。

### async function Zp(e = {})

```js
async function Zp(e = {}) {
  const t = e.extensionRoots?.();
  const s = t?.explicit ?? e.additionalExtensionPaths ?? [];
  const n = t?.mode ?? (e.disableExtensionDiscovery ? "explicit-only" : "merge");
  return await z_s(s, n, () => Dtl(e));
}
```

### async function nQ(e)

```js
async function nQ(e) {
  const t = PUs.getStore();
  const s = e.extensionRoots ? e.extensionRoots.explicit.map((u) => ({ path: IUs(u, e), level: "user" })) : t ? t.paths.map((u) => ({ path: IUs(u, e), level: "user" })) : YCe.map((u) => u.relativePath ? { ...u, path: Yg.resolve(e.cwd, u.relativePath) } : u);
  const n = e.extensionRoots?.mode ?? t?.mode ?? FUs;
  let o = s;
  if (n === "merge") {
    const u = await nru(e);
    const c = e.extensionRoots?.configured ?? t?.configuredExtensions;
    const p = c !== undefined ? {
      entries: [...c],
      level: e.extensionRoots?.configuredLevel ?? t?.configuredLevel ?? "user"
    } : await tru(e);
    o = [
      ...o,
      ...p?.entries.map((d) => ({
        path: IUs(d, e),
        level: p.level
      })) ?? [],
      ...u
    ];
  }
  const r = new Set;
  const i = [];
  for (const u of o) {
    if (r.has(u.path))
      continue;
    r.add(u.path);
    i.push(u);
  }
  const a = await Promise.all(i.map((u) => sru(u.path)));
  const l = [];
  for (let u = 0;u < i.length; u++) {
    if (!a[u])
      continue;
    const { path: c, level: p } = i[u];
    l.push({ path: c, level: p, name: Yg.basename(c) });
  }
  return l;
}
```

### async function fhr(e)

```js
async function fhr(e) {
  const [t, s] = await Promise.all([
    IO(e.home, e.cwd),
    nQ(e)
  ]);
  const n = new Set;
  const o = [];
  for (const r of t.roots) {
    if (n.has(r.path))
      continue;
    n.add(r.path);
    o.push({
      path: r.path,
      level: r.scope,
      instanceKey: r.marketplace === "__local__" ? `dir:${r.path}` : `${r.id}#${r.scope}`
    });
  }
  for (const r of s) {
    if (n.has(r.path))
      continue;
    n.add(r.path);
    o.push({ path: r.path, level: r.level, instanceKey: `ext:${r.path}` });
  }
  return o;
}
```

### async function lru(e)

```js
async function lru(e) {
  const t = await fhr(e);
  const s = await Promise.all(t.map(async (n) => {
    const o = await EMe(n.path);
    if (o.kind !== "standard")
      return { items: [] };
    const r = await aru(o.realRoot, o.manifest, n, e.home);
    return {
      items: r.items,
      warnings: (r.warnings ?? []).map((i) => `[agent-plugins] ${o.manifest.name}: ${i}`)
    };
  }));
  return {
    items: s.flatMap((n) => n.items),
    warnings: s.flatMap((n) => n.warnings ?? [])
  };
}
```

### async function aru(e, t, s, n)

```js
async function aru(e, t, s, n) {
  const o = [];
  const r = [];
  const i = await _O(e, a6e.join(e, "mcp.json"));
  if (i.status === "missing")
    return { items: o, warnings: r };
  if (i.status === "outside") {
    r.push(`mcp.json resolves outside the plugin root`);
    return { items: o, warnings: r };
  }
  const a = i.realPath;
  let l;
  try {
    l = await rse.stat(a);
  } catch (d) {
    if (!ge(d))
      r.push(`Failed to read mcp.json: ${String(d)}`);
    return { items: o, warnings: r };
  }
  if (!l.isFile()) {
    r.push(`mcp.json does not resolve to a regular file`);
    return { items: o, warnings: r };
  }
  const u = await Gt(a);
  if (u === null) {
    r.push(`Failed to read mcp.json`);
    return { items: o, warnings: r };
  }
  const c = oru(n, t.name, s.instanceKey);
  const p = await mKt(u, { pluginRoot: e, pluginData: c });
  if (p.status === "disabled") {
    r.push(`MCP disabled: ${p.reason}`);
    return { items: o, warnings: r };
  }
  r.push(...p.warnings);
  if (p.servers.some((d) => d.transport === "stdio")) {
    await rse.mkdir(c, { recursive: true });
  }
  for (const d of p.servers) {
    o.push({
      name: `${t.name}:${d.name}`,
      transport: d.transport,
      ...d.command !== undefined && { command: d.command },
      ...d.args !== undefined && { args: d.args },
      ...d.env !== undefined && { env: d.env },
      ...d.command !== undefined && { envPolicy: "literal" },
      ...d.cwd !== undefined && { cwd: d.cwd },
      ...d.url !== undefined && { url: d.url },
      ...d.headers !== undefined && { headers: d.headers },
      ...d.url !== undefined && { headerPolicy: "origin-locked" },
      _source: Jt(j_t, a, s.level)
    });
  }
  return { items: o, warnings: r };
}
```

### MCP 接线参数

```js
const mIt = e.extensionRoots ?? (() => ({
      explicit: e.additionalExtensionPaths ?? [],
      mode: e.disableExtensionDiscovery ? "explicit-only" : "merge",
      configured: r.get("extensions") ?? [],
      configuredLevel: r.extensionsSourceLevel()
    }));
    const h3s = {
      onStatus: cse,
      enableProjectConfig: r.get("mcp.enableProjectConfig") ?? true,
      filterExa: true,
      filterBrowser: r.get("browser.enabled") ?? false,
      extensionRoots: mIt()
    };

```

## 无模型配置实测

| 输入 | config get extensions --json 结果 |
|---|---|
| 无覆盖 | `[]` |
| 子命令后 `--config file` | exit 1，unknown option |
| 子命令前 `--config file` | exit 0，但没有应用该覆盖 |
| `PI_CONFIG_FILES=file` | 正确读取该文件 extensions |
| `PI_CONFIG_FILES=file1:file2`（mac） | 正确使用 file2 的数组，数组替换而非合并 |
| PI_CONFIG_FILES 为 JSON 数组、逗号或换行列表 | exit 1，当作不存在的文件路径 |
| 前置 `--no-extensions` + PI_CONFIG_FILES | 配置值不变，config 查询不能证明运行时 extension 是否加载 |

临时 JSON overlay roundtrip：原数组 `["/tmp/user-plugin.ts"]` + trusted root `/tmp/trusted-builtin`，写入临时 snapshot，真实 native config get 返回 `["/tmp/user-plugin.ts","/tmp/trusted-builtin"]`。路径含中文与空格可读。全部临时目录已清理。

## 真实 -e MCP 握手（2026-09-08）

使用 `createOmpCapabilityPlugin` 生成独立临时标准插件根，runner 指向仅返回协议数据的本地 fake stdio MCP。启动同一随包二进制：

```text
omp --mode rpc --no-session --no-title --no-lsp --no-pty --no-skills --no-rules --no-extensions -e <generated-root>
```

`PI_CODING_AGENT_DIR` 指向临时目录；临时 `PI_CONFIG_FILES` 只设模型目录中的本地标识（未发送 prompt）、关闭 project MCP 与 workspace tree。实际 fake server 日志：

```json
[
  {"method":"initialize","module":"workbench"},
  {"method":"notifications/initialized","module":"workbench"},
  {"method":"tools/list","module":"workbench"}
]
```

OMP stderr 为空。未发送模型 prompt 或 tools/call，没有费用调用。只终止本探针创建的独立进程组，已清理临时目录。此证据证明实际 `-e` + `--no-extensions` 仍发现并握手标准 MCP 插件；不等于正式宿主端到端授权或 Windows 验收。

## 生成器接口和 schema 约束

`createOmpCapabilityPlugin({appOwnedRoot,runner,enabled:{workbench,bizone},version,platform?})`；两模块都关返回 null，否则返回内容寻址 immutable root、`['-e', root]` 与宿主须识别的实际 serverNames。标准 OMP provider 添加插件名前缀，名称为 `eas-capabilities:eas-term` / `eas-capabilities:bizone-canvas`。

`plugin.json` 最小有效字段是精确 `$schema` 加合法 `name`；版本为可选字符串，生成器显式写包版本。`mcp.json` 必须精确 `$schema` + `mcpServers`，stdio entry 为 `type:'stdio'` + `command`，可选 args/env/cwd。绝对 command 被正式解析器拒绝；生成器使用 `./runner` / `./runner.cmd`，POSIX shell 精确引号调用宿主 nodeRunner 的绝对 binary+shim。Windows cmd 已生成并单测结构，未在 Windows 实机执行。

MCP env 只保存模块名和可选 `ELECTRON_RUN_AS_NODE=1`；不保存租约、token。schema 默认 cwd 是插件目录，真实项目/Frame 身份必须由网关主租约确定，不能从进程 cwd 推断。生成器不更改用户 extensions，不修改第三方插件。


### 随包 schema 解析器：function ATn(e)

```js
function ATn(e) {
  let t;
  try {
    t = JSON.parse(e);
  } catch {
    return { status: "none" };
  }
  if (!oe(t))
    return { status: "none" };
  const s = t.$schema;
  if (typeof s !== "string" || !s.startsWith(Bgi))
    return { status: "none" };
  if (s !== MTn) {
    return { status: "invalid", reason: `unsupported Agent Plugins version ($schema: ${s})` };
  }
  const n = [];
  for (const u in t) {
    if (!jgi[u])
      n.push(`Ignoring unknown plugin.json field "${u}"`);
  }
  const o = t.name;
  if (typeof o !== "string" || !Qgi(o)) {
    return { status: "invalid", reason: `invalid plugin name ${JSON.stringify(o)}` };
  }
  const r = { name: o };
  for (const u of ["version", "description", "homepage", "repository", "license"]) {
    const c = t[u];
    if (c === undefined)
      continue;
    if (typeof c !== "string")
      return { status: "invalid", reason: `"${u}" must be a string` };
    r[u] = c;
  }
  const i = t.keywords;
  if (i !== undefined) {
    if (!Array.isArray(i) || i.some((u) => typeof u !== "string")) {
      return { status: "invalid", reason: `"keywords" must be an array of strings` };
    }
    r.keywords = i;
  }
  const a = t.author;
  if (a !== undefined) {
    if (!oe(a))
      return { status: "invalid", reason: `"author" must be an object` };
    for (const u in a) {
      if (!Ygi[u])
        return { status: "invalid", reason: `unknown "author" field "${u}"` };
      if (typeof a[u] !== "string")
        return { status: "invalid", reason: `"author.${u}" must be a string` };
    }
    r.author = a;
  }
  const l = t.extensions;
  if (l !== undefined) {
    if (!oe(l)) {
      n.push(`Ignoring non-object "extensions" field`);
    } else {
      r.extensions = l;
    }
  }
  return { status: "valid", manifest: r, warnings: n };
}
```

### 随包 schema 解析器：async function rhi(e, t, { pluginRoot: s, pluginData: n })

```js
async function rhi(e, t, { pluginRoot: s, pluginData: n }) {
  for (const d in t) {
    if (!Vgi[d])
      return { error: `unknown field "${d}"` };
  }
  const o = t.command;
  if (typeof o !== "string" || o.length === 0)
    return { error: `"command" must be a non-empty string` };
  let r;
  if (o.startsWith("./")) {
    r = vMe.resolve(s, o);
    if (!await SZe(s, r)) {
      return { error: `"command" resolves outside the plugin root` };
    }
  } else if (o.includes("/") || o.includes("\\")) {
    return { error: `"command" must be a bare executable name or a plugin-relative ./ path` };
  } else {
    r = o;
  }
  const i = t.args;
  if (i !== undefined && (!Array.isArray(i) || i.some((d) => typeof d !== "string"))) {
    return { error: `"args" must be an array of strings` };
  }
  const a = i?.map((d) => pKt(d, s, n));
  const l = t.env;
  const u = {};
  if (l !== undefined) {
    if (!oe(l))
      return { error: `"env" must be an object of strings` };
    for (const d in l) {
      const f = l[d];
      if (typeof f !== "string")
        return { error: `"env.${d}" must be a string` };
      if ($gi[d])
        return { error: `"env" must not set reserved variable ${d}` };
      u[d] = pKt(f, s, n);
    }
  }
  u.PLUGIN_ROOT = s;
  u.PLUGIN_DATA = n;
  let c = s;
  const p = t.cwd;
  if (p !== undefined) {
    if (typeof p !== "string")
      return { error: `"cwd" must be a string` };
    const d = p === cKt || p.startsWith(`${cKt}/`);
    const f = p === uKt || p.startsWith(`${uKt}/`);
    if (!d && !f && !p.startsWith("./")) {
      return { error: `"cwd" must be plugin-relative or rooted at ${uKt} or ${cKt}` };
    }
    const m = pKt(p, s, n);
    c = vMe.resolve(s, m);
    const g = d ? n : s;
    if (!await SZe(g, c)) {
      return { error: `"cwd" resolves outside ${d ? "the plugin data directory" : "the plugin root"}` };
    }
  }
  return {
    server: {
      name: e,
      transport: "stdio",
      command: r,
      ...a !== undefined && { args: a },
      env: u,
      cwd: c
    }
  };
}
```
