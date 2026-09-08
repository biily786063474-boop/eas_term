// Native OMP owns callbacks, token exchange, persistence and refresh.
import { spawn, type ChildProcess } from 'node:child_process';
import type { HostPaths } from '../../../shared/agentChat.ts';
import type { OmpLoginState } from '../../../shared/ompLogin.ts';
import { ompBaseEnv, ompBinPathOrNull } from './paths.ts';
import { createOmpLoginParser, type OmpLoginEvent } from './loginParse.ts';
export type { OmpLoginState } from '../../../shared/ompLogin.ts';
type Listener = (s: OmpLoginState) => void;
type SpawnLogin = (bin: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcess;
export function createOmpLoginController(spawnLogin: SpawnLogin = spawn) {
    type Run = {
        proc: ChildProcess;
        owner: number;
        state: OmpLoginState;
        listener: Listener;
        parser: ReturnType<typeof createOmpLoginParser>;
        saved: boolean;
    };
    let current: Run | null = null;
    function emit(r: Run, patch: Partial<OmpLoginState>): void {
        if (current !== r)
            return;
        r.state = { ...r.state, ...patch };
        r.listener(r.state);
    }
    function finish(r: Run, phase: 'done' | 'failed' | 'cancelled', error?: string): void {
        if (current !== r)
            return;
        current = null; // listener may start another run synchronously
        r.state = { ...r.state, phase, error, url: undefined, launchUrl: undefined, prompt: undefined, progress: undefined, instructions: undefined };
        r.listener(r.state);
    }
    function stop(r: Run): void { try {
        r.proc.kill();
    }
    catch { /* already gone */ } }
    function events(r: Run, list: OmpLoginEvent[]): void {
        for (const e of list) {
            if (current !== r)
                return;
            if (e.k === 'url')
                emit(r, { phase: r.state.phase === 'input' ? 'input' : 'browser', url: e.url, launchUrl: e.launchUrl });
            else if (e.k === 'prompt')
                emit(r, { phase: 'input', prompt: e.message });
            else if (e.k === 'done')
                r.saved = true;
            else if (e.k === 'instructions')
                emit(r, { instructions: ((r.state.instructions ? r.state.instructions + '\n' : '') + e.text).slice(-4000) });
            else if (e.k === 'progress') {
                // Keep diagnostic categories, never arbitrary raw codes / URLs / keys.
                const category = /EADDRINUSE|address already in use/i.test(e.text) ? 'EADDRINUSE' : /timed? ?out|timeout/i.test(e.text) ? 'timeout' : /401|unauthorized/i.test(e.text) ? 'HTTP 401' : /403|forbidden|access_denied/i.test(e.text) ? 'HTTP 403' : /ENOTFOUND|ECONNRESET|ECONNREFUSED|fetch failed/i.test(e.text) ? 'network error' : undefined;
                if (category)
                    emit(r, { lines: [...r.state.lines, category].slice(-10) });
            }
        }
    }
    return {
        start(host: HostPaths, provider: string, listener: Listener, owner = 0): {
            ok: boolean;
            error?: string;
        } {
            if (current)
                return { ok: false, error: '已经有一个登录在进行中，先完成或取消它' };
            if (!/^[a-z0-9.-]{1,64}$/.test(provider))
                return { ok: false, error: '不认识这个服务商' };
            const bin = ompBinPathOrNull(host);
            if (!bin)
                return { ok: false, error: '安装包没有随附 OMP 可执行文件' };
            let proc: ChildProcess;
            try {
                proc = spawnLogin(bin, ['auth-broker', 'login', provider], { env: ompBaseEnv(host), stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch {
                return { ok: false, error: '无法启动 OMP 登录程序' };
            }
            const r: Run = { proc, owner, state: { provider, phase: 'starting', lines: [] }, listener, parser: createOmpLoginParser(), saved: false };
            current = r;
            const stderr = createOmpLoginParser(); // independent partial-line buffers
            proc.stdout?.setEncoding('utf8');
            proc.stdout?.on('data', (chunk: string) => { if (current === r)
                events(r, r.parser.push(chunk)); });
            proc.stderr?.setEncoding('utf8');
            proc.stderr?.on('data', (chunk: string) => { if (current === r)
                events(r, stderr.push(chunk)); });
            const fail = (): void => { if (current === r) {
                finish(r, 'failed', '登录程序连接中断，请重新登录');
                stop(r);
            } };
            proc.on('error', fail);
            proc.stdin?.on('error', fail);
            proc.on('close', (code) => {
                if (current !== r)
                    return;
                events(r, r.parser.end());
                events(r, stderr.end());
                if (code === 0 && r.saved)
                    finish(r, 'done');
                else
                    finish(r, 'failed', '登录没有完成（退出码 ' + String(code) + '）');
            });
            const answered = r.parser.answered.bind(r.parser);
            r.parser.answered = () => { answered(); stderr.answered(); };
            listener(r.state);
            return { ok: true };
        },
        submit(text: string, owner = 0): {
            ok: boolean;
            error?: string;
        } {
            const r = current;
            if (!r || r.owner !== owner || !r.proc.stdin || r.state.phase !== 'input')
                return { ok: false, error: '当前没有等待你输入的登录请求' };
            if (!text.trim() || text.length > 32768 || /[\r\n\0]/.test(text))
                return { ok: false, error: '请粘贴单行授权内容，不要包含换行' };
            if (r.proc.stdin.destroyed || !r.proc.stdin.writable)
                return { ok: false, error: '登录程序已关闭，请重新登录' };
            r.parser.answered();
            emit(r, { phase: 'working', prompt: undefined });
            try {
                r.proc.stdin.write(text.trim() + '\n', (error) => { if (error && current === r) {
                    finish(r, 'failed', '授权内容未能交给 OMP，请重新登录');
                    stop(r);
                } });
                return { ok: true };
            }
            catch {
                finish(r, 'failed', '授权内容未能交给 OMP，请重新登录');
                stop(r);
                return { ok: false, error: '提交失败，请重新登录' };
            }
        },
        cancel(owner = 0): {
            ok: boolean;
        } { const r = current; if (!r)
            return { ok: true }; if (r.owner !== owner)
            return { ok: false }; finish(r, 'cancelled', '登录已取消'); stop(r); return { ok: true }; },
        inFlight(owner = 0): OmpLoginState | null { return current?.owner === owner ? current.state : null; }
    };
}
const c = createOmpLoginController();
export const startOmpLogin = c.start;
export const submitOmpLogin = c.submit;
export const cancelOmpLogin = c.cancel;
export const ompLoginInFlight = c.inFlight;
