// src/tunnel/main.ts
import fs from "node:fs";

// src/tunnel/hub.ts
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

// src/tunnel/protocol.ts
var MAX_LINE = 128;
var TUNNEL_ID_RE = /^[0-9a-f]{32}$/;
var TUNNEL_HOST_SUFFIX = ".eas-term.local";
function takeLine(buf) {
  const i = buf.indexOf(10);
  if (i < 0) {
    return buf.length > MAX_LINE ? { ok: false, reason: "too-long" } : { ok: false, reason: "need-more" };
  }
  if (i > MAX_LINE) return { ok: false, reason: "too-long" };
  const end = i > 0 && buf[i - 1] === 13 ? i - 1 : i;
  return { ok: true, line: buf.subarray(0, end).toString("latin1"), rest: buf.subarray(i + 1) };
}
function parseHello(line) {
  const p = line.split(" ");
  if (p[0] !== "EAS-TUNNEL/1") return { kind: "bad", reason: "\u4E0D\u662F\u8FD9\u4E2A\u534F\u8BAE" };
  if (p[1] === "agent") {
    if (!TUNNEL_ID_RE.test(p[2] ?? "")) return { kind: "bad", reason: "\u95E8\u724C\u53F7\u683C\u5F0F\u4E0D\u5BF9" };
    if (!/^[A-Za-z0-9_-]{43}$/.test(p[3] ?? "")) return { kind: "bad", reason: "\u7F3A\u5C11\u6216\u683C\u5F0F\u4E0D\u5BF9\u7684\u51ED\u8BC1" };
    return { kind: "agent", tunnelId: p[2], proof: p[3] };
  }
  if (p[1] === "data") {
    if (!TUNNEL_ID_RE.test(p[2] ?? "")) return { kind: "bad", reason: "\u95E8\u724C\u53F7\u683C\u5F0F\u4E0D\u5BF9" };
    if (!/^[0-9a-f]{32}$/.test(p[3] ?? "")) return { kind: "bad", reason: "\u6D41\u6C34\u53F7\u683C\u5F0F\u4E0D\u5BF9" };
    return { kind: "data", tunnelId: p[2], streamId: p[3] };
  }
  return { kind: "bad", reason: "\u4E0D\u8BA4\u8BC6\u7684\u89D2\u8272" };
}
function parseConnect(buf) {
  const crlf = buf.indexOf("\r\n\r\n");
  const lf = buf.indexOf("\n\n");
  const ends = [crlf >= 0 ? crlf + 4 : -1, lf >= 0 ? lf + 2 : -1].filter((v) => v >= 0);
  const hdrEnd = ends.length ? Math.min(...ends) : -1;
  if (hdrEnd < 0) {
    return buf.length > 8192 ? { ok: false, reason: "bad-request" } : { ok: false, reason: "need-more" };
  }
  const first = buf.subarray(0, hdrEnd).toString("latin1").split(/\r?\n/)[0];
  const m = /^CONNECT ([^ ]+) HTTP\/1\.[01]$/.exec(first);
  if (!m) return { ok: false, reason: "bad-request" };
  const target = m[1];
  if (!target.endsWith(":443")) return { ok: false, reason: "not-a-tunnel" };
  const host = target.slice(0, -4);
  if (!host.endsWith(TUNNEL_HOST_SUFFIX)) return { ok: false, reason: "not-a-tunnel" };
  const id = host.slice(0, -TUNNEL_HOST_SUFFIX.length);
  if (!TUNNEL_ID_RE.test(id)) return { ok: false, reason: "not-a-tunnel" };
  return { ok: true, tunnelId: id, rest: buf.subarray(hdrEnd) };
}

// src/tunnel/hub.ts
var MAX_STREAMS_PER_AGENT = 32;
var MAX_AGENTS = 2e3;
var STREAM_WAIT_MS = 1e4;
var AGENT_IDLE_MS = 9e4;
var tunnelIdOf = (agentKey) => crypto.createHash("sha256").update(agentKey).digest("hex").slice(0, 32);
function refuse(sock, code, text) {
  try {
    sock.end(`HTTP/1.1 ${code} ${text}\r
Connection: close\r
Content-Length: 0\r
\r
`);
  } catch {
  }
}
function createHub({ key, cert, log = () => {
} } = {}) {
  let tlsKey = key;
  let tlsCert = cert;
  const agents = /* @__PURE__ */ new Map();
  function dropAgent(id, why) {
    const a = agents.get(id);
    if (!a) return;
    agents.delete(id);
    for (const s of a.streams.values()) {
      clearTimeout(s.timer);
      refuse(s.phone, 502, "Computer Gone");
    }
    try {
      a.control.destroy();
    } catch {
    }
    log(`agent ${id.slice(0, 8)} \u4E0B\u7EBF\uFF1A${why}\uFF08\u5728\u7EBF ${agents.size}\uFF09`);
  }
  function handleAgentSide(sock) {
    let buf = Buffer.alloc(0);
    let role = null;
    sock.setTimeout(AGENT_IDLE_MS);
    sock.on("timeout", () => sock.destroy());
    sock.on("data", (chunk) => {
      if (role === "data") return;
      buf = Buffer.concat([buf, chunk]);
      for (; ; ) {
        const r = takeLine(buf);
        if (!r.ok) {
          if (r.reason === "too-long") sock.destroy();
          return;
        }
        buf = Buffer.from(r.rest);
        if (role === "agent") {
          if (r.line !== "ping") return sock.destroy();
          continue;
        }
        const h = parseHello(r.line);
        if (h.kind === "bad") {
          sock.end(`EAS-TUNNEL/1 error ${h.reason}
`);
          return;
        }
        if (h.kind === "agent") {
          if (tunnelIdOf(h.proof) !== h.tunnelId) {
            sock.end("EAS-TUNNEL/1 error \u51ED\u8BC1\u8DDF\u95E8\u724C\u53F7\u5BF9\u4E0D\u4E0A\n");
            return;
          }
          if (agents.size >= MAX_AGENTS && !agents.has(h.tunnelId)) {
            sock.end("EAS-TUNNEL/1 error \u670D\u52A1\u5668\u6EE1\u4E86\n");
            return;
          }
          if (agents.has(h.tunnelId)) dropAgent(h.tunnelId, "\u88AB\u65B0\u8FDE\u63A5\u9876\u66FF");
          role = "agent";
          const entry = { control: sock, streams: /* @__PURE__ */ new Map() };
          agents.set(h.tunnelId, entry);
          sock.write("EAS-TUNNEL/1 ok\n");
          log(`agent ${h.tunnelId.slice(0, 8)} \u4E0A\u7EBF\uFF08\u5728\u7EBF ${agents.size}\uFF09`);
          sock.on("close", () => {
            if (agents.get(h.tunnelId) === entry) dropAgent(h.tunnelId, "\u8FDE\u63A5\u5173\u95ED");
          });
          continue;
        }
        const a = agents.get(h.tunnelId);
        const st = a?.streams.get(h.streamId);
        if (!a || !st) {
          sock.end("EAS-TUNNEL/1 error \u6CA1\u6709\u8FD9\u6761\u6D41\n");
          return;
        }
        a.streams.delete(h.streamId);
        clearTimeout(st.timer);
        st.unstash?.();
        role = "data";
        sock.write("EAS-TUNNEL/1 ok\n");
        st.phone.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (buf.length) st.phone.write(buf);
        if (st.buffered.length) sock.write(st.buffered);
        sock.setTimeout(0);
        pipeBoth(sock, st.phone);
        return;
      }
    });
    sock.on("error", () => sock.destroy());
  }
  function handlePhoneSide(sock, firstChunk) {
    let buf = firstChunk;
    let done = false;
    const onData = (chunk) => {
      if (done) return;
      buf = Buffer.concat([buf, chunk]);
      step();
    };
    const step = () => {
      const r = parseConnect(buf);
      if (!r.ok) {
        if (r.reason === "need-more") return;
        done = true;
        sock.off("data", onData);
        return refuse(sock, r.reason === "not-a-tunnel" ? 403 : 400, "Forbidden");
      }
      done = true;
      sock.off("data", onData);
      const a = agents.get(r.tunnelId);
      if (!a) return refuse(sock, 502, "Computer Offline");
      if (a.streams.size >= MAX_STREAMS_PER_AGENT) return refuse(sock, 429, "Too Many Streams");
      const streamId = crypto.randomBytes(16).toString("hex");
      const st = {
        phone: sock,
        // CONNECT 头后面粘着的字节就是 TLS 的第一段，**必须留着**
        buffered: r.rest,
        timer: setTimeout(() => {
          a.streams.delete(streamId);
          refuse(sock, 504, "Computer Not Responding");
        }, STREAM_WAIT_MS)
      };
      a.streams.set(streamId, st);
      sock.on("close", () => {
        if (a.streams.get(streamId) === st) {
          clearTimeout(st.timer);
          a.streams.delete(streamId);
        }
      });
      const stash = (c) => {
        st.buffered = Buffer.concat([st.buffered, c]);
      };
      st.unstash = () => sock.off("data", stash);
      sock.on("data", stash);
      try {
        a.control.write(`open ${streamId}
`);
      } catch {
        clearTimeout(st.timer);
        a.streams.delete(streamId);
        refuse(sock, 502, "Computer Gone");
      }
    };
    sock.on("data", onData);
    sock.on("error", () => sock.destroy());
    step();
  }
  function pipeBoth(a, b) {
    a.pipe(b);
    b.pipe(a);
    const kill = () => {
      a.destroy();
      b.destroy();
    };
    a.on("error", kill);
    b.on("error", kill);
    a.on("close", kill);
    b.on("close", kill);
  }
  const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    sock.once("readable", () => {
      const head = sock.read(1);
      if (!head) return sock.destroy();
      sock.unshift(head);
      if (head[0] === 22) {
        if (!tlsKey || !tlsCert) return sock.destroy();
        const t = new tls.TLSSocket(sock, { isServer: true, key: tlsKey, cert: tlsCert });
        t.on("error", () => t.destroy());
        handleAgentSide(t);
      } else if (head[0] === 67) {
        handlePhoneSide(sock, Buffer.alloc(0));
      } else {
        sock.destroy();
      }
    });
    sock.on("error", () => sock.destroy());
  });
  return {
    server,
    setCert: (k, c) => {
      tlsKey = k;
      tlsCert = c;
      log("\u8BC1\u4E66\u5DF2\u6362\u65B0");
    },
    /** 运维指标。**只有数量，没有内容** —— 你不该有能力回答
     *  「某某用户昨天在干什么」，而这不靠自律，是手里没有那些数据 */
    stats: () => ({ agents: agents.size, streams: [...agents.values()].reduce((n, a) => n + a.streams.size, 0) }),
    _agents: agents
  };
}

// src/tunnel/main.ts
var arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : process.env[`EAS_TUNNEL_${name.toUpperCase()}`] ?? dflt;
};
var port = Number(arg("port", "8443"));
var certPath = arg("cert");
var keyPath = arg("key");
if (!certPath || !keyPath) {
  console.error("\u8981 --cert \u548C --key\uFF08\u7535\u8111\u90A3\u6761\u51FA\u7AD9\u8FDE\u63A5\u8D70 TLS\uFF0C\u89C1\u6587\u4EF6\u5934\uFF09");
  process.exit(1);
}
var hub = createHub({
  cert: fs.readFileSync(certPath, "utf8"),
  key: fs.readFileSync(keyPath, "utf8"),
  log: (m) => console.log((/* @__PURE__ */ new Date()).toISOString(), m)
});
var certMtime = fs.statSync(certPath).mtimeMs;
setInterval(
  () => {
    try {
      const m = fs.statSync(certPath).mtimeMs;
      if (m === certMtime) return;
      certMtime = m;
      hub.setCert(fs.readFileSync(keyPath, "utf8"), fs.readFileSync(certPath, "utf8"));
    } catch (e) {
      console.error("\u91CD\u8BFB\u8BC1\u4E66\u5931\u8D25\uFF0C\u7EE7\u7EED\u7528\u624B\u91CC\u90A3\u5F20", e);
    }
  },
  60 * 60 * 1e3
).unref();
hub.server.listen(port, "0.0.0.0", () => {
  console.log(`\u96A7\u9053\u670D\u52A1\u5668\u8D77\u5728 :${port}`);
});
setInterval(() => {
  const s = hub.stats();
  if (s.agents || s.streams) console.log(`\u5728\u7EBF ${s.agents} \u53F0\uFF0C\u6D3B\u52A8\u6D41 ${s.streams} \u6761`);
}, 6e4).unref();
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    hub.server.close(() => process.exit(0));
  });
