// Parent-side control for explicitly owned Windows Codex launcher children only.
// Weak identity follows the ChildProcess object, never a PID/name/process-tree scan.
const owned = new WeakSet()
export function ownCodexLauncher(proc) { owned.add(proc) }
export function stopAgentProcess(proc, signal = 'SIGTERM') {
  if (!proc) return
  if (!owned.has(proc)) { proc.kill(signal); return }
  if (proc.exitCode !== null || proc.signalCode !== null) return
  const disconnect = () => {
    // Channel loss is a cancellation request to the still-live owner, not evidence
    // that either process has exited. Never hard-kill the outer Node process.
    if (proc.connected) { try { proc.disconnect() } catch { /* already disconnected */ } }
  }
  if (!proc.connected) return
  try { proc.send({ type: 'eas:codex:cancel', signal: signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM' }, error => { if (error) disconnect() }) }
  catch { disconnect() }
}
