/** 通知级别用形状和小面积颜色表达，避免给整块正文染色。 */
export function ChatStatusIcon({ fatal = false }: { fatal?: boolean }): JSX.Element {
  return <svg className="ac-status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {fatal ? <><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6m0-6-6 6" /></>
      : <><path d="M10.3 4.2 2.8 17.3A1.8 1.8 0 0 0 4.4 20h15.2a1.8 1.8 0 0 0 1.6-2.7L13.7 4.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 3h.01" /></>}
  </svg>
}
