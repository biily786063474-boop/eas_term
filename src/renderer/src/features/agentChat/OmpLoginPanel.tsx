import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n.ts';
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
    const t = useT();
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
                setError(t('chat.ompLogin.openFail'));
        }
    };
    const copy = async (): Promise<void> => {
        if (!state?.url)
            return;
        const generation = epoch.current;
        try {
            await window.api.clipboard.writeText(state.url);
            if (generation === epoch.current)
                setNotice(t('chat.ompLogin.copied'));
        }
        catch {
            if (generation === epoch.current)
                setError(t('chat.ompLogin.copyFail'));
        }
    };
    const act = async (action: () => Promise<unknown>): Promise<void> => {
        const generation = epoch.current;
        try {
            const result = await action();
            if (result && typeof result === 'object' && 'ok' in result && !result.ok && generation === epoch.current) setError(t('chat.ompLogin.actionFail'));
        } catch { if (generation === epoch.current) setError(t('chat.ompLogin.actionFail')); }
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
                setError(result.error ?? t('chat.ompLogin.submitFail'));
        }
        catch {
            if (generation === epoch.current)
                setError(t('chat.ompLogin.submitFail'));
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
    const title = !state ? t('chat.ompLogin.tConnect') : waiting ? t('chat.ompLogin.tBrowser') : phase === 'input' ? kind === 'secret' ? t('chat.ompLogin.tKey') : t('chat.ompLogin.tMore') : phase === 'done' ? t('chat.ompLogin.tDone') : phase === 'failed' ? t('chat.ompLogin.tFailed') : phase === 'cancelled' ? t('chat.ompLogin.tCancelled') : t('chat.ompLogin.tChecking');
    return <section className="ac-native-login">
  <h3>{title}</h3>
  <p className="ac-native-intro">{waiting ? t('chat.ompLogin.introWaiting') : t('chat.ompLogin.introDefault')}</p>
  <div className="ac-native-provider"><span className="ac-native-logo" aria-hidden="true">{provider.slice(0, 1).toUpperCase()}</span><div><strong>{provider}</strong><small>{t('chat.ompLogin.viaOmp')}</small></div><button type="button" onClick={() => void act(onSwitch)}>{t('chat.ompLogin.switch')}</button></div>
  <ol className="ac-native-steps" aria-label={t('chat.ompLogin.stepsAria')}><li>{t('chat.ompLogin.stepProvider')}</li><li aria-current={!terminal ? 'step' : undefined}>{t('chat.ompLogin.stepAuth')}</li><li aria-current={phase === 'done' ? 'step' : undefined}>{t('chat.ompLogin.stepConfirm')}</li></ol>
  <div className="ac-native-status" role="status">
   {!state && <><h4>{t('chat.ompLogin.useExisting')}</h4><p>{t('chat.ompLogin.useExistingNote')}</p><button type="button" className="ac-native-primary" onClick={onStart}>{t('chat.ompLogin.startLogin')}</button></>}
   {waiting && <><h4><span className="ac-native-spinner"/>{t('chat.ompLogin.waitBrowser')}</h4><p>{t('chat.ompLogin.waitBrowserNote')}</p></>}
   {(phase === 'starting' || phase === 'working') && <><h4><span className="ac-native-spinner"/>{phase === 'starting' ? t('chat.ompLogin.startingNative') : state?.progress || t('chat.ompLogin.waitingVerify')}</h4><p>{t('chat.ompLogin.onlyAfterSaved')}</p></>}
   {state?.instructions && !terminal && <p className="ac-native-instructions">{state.instructions}</p>}
   {url && !terminal && <div className="ac-native-actions"><button type="button" className="ac-native-primary" onClick={() => void open()}>{t('chat.ompLogin.openAuth')}</button><button type="button" onClick={() => void copy()}>{t('chat.ompLogin.copyLink')}</button></div>}
   {phase === 'input' && <details className="ac-native-fallback" open={waiting ? undefined : true}><summary>{waiting ? t('chat.ompLogin.summaryManual') : t('chat.ompLogin.summaryFill')}</summary><form onSubmit={e => { e.preventDefault(); void submit(); }}>
    <label htmlFor="omp-native-answer">{kind === 'secret' ? t('chat.ompLogin.labelSecret') : kind === 'code' ? t('chat.ompLogin.labelCode') : t('chat.ompLogin.labelOther')}</label>
    <p className="ac-native-instructions">{state?.prompt}</p>
    <div className="ac-native-input-row"><input id="omp-native-answer" type={kind === 'secret' && !visible ? 'password' : 'text'} value={input} onChange={e => setInput(e.target.value)} placeholder={t('chat.ompLogin.pastePh')} autoComplete="off" spellCheck={false} autoFocus disabled={sending}/>{kind === 'secret' && <button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? t('chat.ompLogin.hide') : t('chat.ompLogin.show')}</button>}</div>
    {kind === 'code' && <p>{t('chat.ompLogin.codeNote')}</p>}
    <button type="submit" className="ac-native-primary" disabled={sending || !input.trim()}>{sending ? t('chat.ompLogin.submitting') : t('chat.ompLogin.submitToOmp')}</button>
   </form></details>}
   {phase === 'done' && <><h4>{t('chat.ompLogin.saved')}</h4><p>{t('chat.ompLogin.savedNote')}</p><button type="button" className="ac-native-primary" onClick={onContinue}>{t('chat.ompLogin.pickModel')}</button></>}
   {phase === 'failed' && <><h4>{failure?.title}</h4><p>{state?.lines.includes('EADDRINUSE') ? t('chat.ompLogin.portBusy') : state?.lines.includes('timeout') ? t('chat.ompLogin.timeout') : failure?.hint || t('chat.ompLogin.failDefault')}</p><button type="button" className="ac-native-primary" onClick={onStart}>{state?.lines.includes('GOOGLE_CLOUD_PROJECT_REQUIRED') ? t('chat.ompLogin.reloginConfigured') : t('chat.ompLogin.relogin')}</button></>}
   {phase === 'cancelled' && <><h4>{t('chat.ompLogin.stopped')}</h4><p>{t('chat.ompLogin.stoppedNote')}</p><button type="button" className="ac-native-primary" onClick={onStart}>{t('chat.ompLogin.restart')}</button></>}
  </div>
  {error && <p className="ac-login-err" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  <footer className="ac-native-footer"><span>{t('chat.ompLogin.footer')}</span>{state && !terminal && <button type="button" onClick={() => void act(onCancel)}>{t('chat.ompLogin.cancelLogin')}</button>}</footer>
 </section>;
}
