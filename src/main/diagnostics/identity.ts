import { app } from 'electron'
export function isDiagnosticBuild(): boolean {
  return ['eas-term-diagnostic', 'Eas-Term Diagnostic'].includes(app.getName()) && /^0\.4\.85-diag\.\d+$/.test(app.getVersion())
}
