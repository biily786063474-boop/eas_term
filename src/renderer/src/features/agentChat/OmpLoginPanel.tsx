import { useEffect, useRef, useState } from 'react';
import { ompLoginUrl, ompPromptKind, type OmpLoginState } from '../../../../shared/ompLogin';
import { explainOmpFailure } from '../../../../shared/ompSetup';
interface Props {
    state: OmpLoginState | null;
    provider: string;
    onStart(): void;
    onCancel(): Promise<unknown>;
    onSwitch(): Promise<void>;
    onContinue(): void;
}
/** Presentation only: native broker controls which actions exist. No provider-specific OAuth logic. */
export function OmpLoginPanel({ state, provider, onStart, onCancel, onSwitch, onContinue }: Props) {
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [visible, setVisible] = useState(false);
    const [sending, setSending] = useState(false);
    const locked = useRef(false);
    const epoch = useRef(0);
    useEffect(() => { epoch.current++; setInput(''); setVisible(false); setError(''); setNotice(''); setSending(false); locked.current = false; }, [state?.phase, state?.prompt, state?.provider]);
    useEffect(() => () => { epoch.current++; }, []);
    const phase = state?.phase;
    const terminal = phase === 'done' || phase === 'failed' || phase === 'cancelled';
    const kind = ompPromptKind(state?.prompt);
    const url = ompLoginUrl(state?.launchUrl ?? state?.url ?? '');
    const open = async (): Promise<void> => {
        if (!url)
            return;
        const generation = epoch.current;
        try {
            await window.api.shell.openExternal(url);
        }
        catch {
            if (generation === epoch.current)
                setError('浏览器未能打开，请复制登录链接后手动打开');
        }
    };
    const copy = async (): Promise<void> => {
        if (!state?.url)
            return;
        const generation = epoch.current;
        try {
            await window.api.clipboard.writeText(state.url);
            if (generation === epoch.current)
                setNotice('登录链接已复制，请勿分享');
        }
        catch {
            if (generation === epoch.current)
                setError('复制失败，请重试');
        }
    };
    const act = async (action: () => Promise<unknown>): Promise<void> => {
        const generation = epoch.current;
        try {
            const result = await action();
            if (result && typeof result === 'object' && 'ok' in result && !result.ok && generation === epoch.current) setError('操作未能完成，请重试');
        } catch { if (generation === epoch.current) setError('操作未能完成，请重试'); }
    };
    const submit = async (): Promise<void> => {
        if (locked.current || !input.trim() || phase !== 'input')
            return;
        locked.current = true;
        setSending(true);
        setError('');
        const generation = epoch.current;
        try {
            const result = await window.api.omp.submitLogin(input);
            if (generation !== epoch.current)
                return;
            if (result.ok)
                setInput('');
            else
                setError(result.error ?? '提交未送达，请重试');
        }
        catch {
            if (generation === epoch.current)
                setError('提交未送达，请重试');
        }
        finally {
            if (generation === epoch.current) {
                locked.current = false;
                setSending(false);
            }
        }
    };
    const failure = phase === 'failed' ? explainOmpFailure({ ctx: 'login', lines: state?.lines ?? [], error: state?.error }) : null;
    const waiting = phase === 'browser' || (phase === 'input' && kind === 'code' && !!url);
    const title = !state ? '连接你的 AI 账号' : waiting ? '在浏览器中完成授权' : phase === 'input' ? kind === 'secret' ? '使用密钥连接' : '还需要补充一步' : phase === 'done' ? '账号已连接' : phase === 'failed' ? '这次登录没有完成' : phase === 'cancelled' ? '登录已取消' : '正在确认连接';
    return <section className="ac-native-login">
  <h3>{title}</h3>
  <p className="ac-native-intro">{waiting ? '由 OMP 接收原生回调，完成授权后这里自动继续。' : '跟随 OMP 原生登录流程，凭证由它在本机保存并续期。'}</p>
  <div className="ac-native-provider"><span className="ac-native-logo" aria-hidden="true">{provider.slice(0, 1).toUpperCase()}</span><div><strong>{provider}</strong><small>通过 OMP 连接</small></div><button type="button" onClick={() => void act(onSwitch)}>更换</button></div>
  <ol className="ac-native-steps" aria-label="登录进度"><li>✓ 选择供应商</li><li aria-current={!terminal ? 'step' : undefined}>授权账号</li><li aria-current={phase === 'done' ? 'step' : undefined}>确认连接</li></ol>
  <div className="ac-native-status" role="status">
   {!state && <><h4>使用现有账号或订阅</h4><p>OMP 会提供该供应商支持的登录方式，无需提前准备不需要的 API 密钥。</p><button type="button" className="ac-native-primary" onClick={onStart}>开始登录</button></>}
   {waiting && <><h4><span className="ac-native-spinner"/>等待浏览器授权结果</h4><p>在浏览器中选择账号并按页面提示授权。无需把回调地址发到对话。</p></>}
   {(phase === 'starting' || phase === 'working') && <><h4><span className="ac-native-spinner"/>{phase === 'starting' ? '正在启动原生登录…' : state?.progress || '正在等待 OMP 完成验证…'}</h4><p>只有 OMP 确认凭证保存成功，才会显示已连接。</p></>}
   {state?.instructions && !terminal && <p className="ac-native-instructions">{state.instructions}</p>}
   {url && !terminal && <div className="ac-native-actions"><button type="button" className="ac-native-primary" onClick={() => void open()}>打开授权页面 ↗</button><button type="button" onClick={() => void copy()}>复制登录链接</button></div>}
   {phase === 'input' && <details className="ac-native-fallback" open={waiting ? undefined : true}><summary>{waiting ? '未自动返回？手动补充' : '填写 OMP 请求的内容'}</summary><form onSubmit={e => { e.preventDefault(); void submit(); }}>
    <label htmlFor="omp-native-answer">{kind === 'secret' ? 'API 密钥或访问凭证' : kind === 'code' ? '授权码或完整回调内容' : 'OMP 要求的内容'}</label>
    <p className="ac-native-instructions">{state?.prompt}</p>
    <div className="ac-native-input-row"><input id="omp-native-answer" type={kind === 'secret' && !visible ? 'password' : 'text'} value={input} onChange={e => setInput(e.target.value)} placeholder="仅在这里粘贴，不要发到对话里" autoComplete="off" spellCheck={false} autoFocus disabled={sending}/>{kind === 'secret' && <button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? '隐藏' : '显示'}</button>}</div>
    {kind === 'code' && <p>内容原样交给当前 OMP 请求，不要求它是能打开的标准网址。</p>}
    <button type="submit" className="ac-native-primary" disabled={sending || !input.trim()}>{sending ? '正在提交…' : '交给 OMP 验证'}</button>
   </form></details>}
   {phase === 'done' && <><h4>✓ 凭证已保存</h4><p>接下来从账号实际可用的模型中选择。账号已连接不代表所有模型都可用。</p><button type="button" className="ac-native-primary" onClick={onContinue}>选择模型 →</button></>}
   {phase === 'failed' && <><h4>{failure?.title}</h4><p>{state?.lines.includes('EADDRINUSE') ? '本机授权端口被占用，请先结束另一笔登录再重试。' : state?.lines.includes('timeout') ? '未在有效期内收到授权结果，请重新登录。' : failure?.hint || 'OMP 未能完成本次登录，请检查网络或供应商授权页面后重试。'}</p><button type="button" className="ac-native-primary" onClick={onStart}>{state?.lines.includes('GOOGLE_CLOUD_PROJECT_REQUIRED') ? '已配置项目，重新登录' : '重新登录'}</button></>}
   {phase === 'cancelled' && <><h4>本次授权已停止</h4><p>旧页面返回的结果不会覆盖新的登录。已有账号配置不受影响。</p><button type="button" className="ac-native-primary" onClick={onStart}>重新开始</button></>}
  </div>
  {error && <p className="ac-login-err" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  <footer className="ac-native-footer"><span>授权信息不进入聊天</span>{state && !terminal && <button type="button" onClick={() => void act(onCancel)}>取消登录</button>}</footer>
 </section>;
}
