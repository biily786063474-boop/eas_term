import type { SVGProps } from 'react'

export type SemanticIconKind = 'terminal' | 'search' | 'read' | 'edit' | 'integration' | 'compact' | 'folder' | 'folderopen' | 'worktree' | 'branch' | 'merge' | 'warning' | 'generic' | 'typescript' | 'javascript' | 'markdown' | 'json' | 'git' | 'image' | 'vector' | 'config' | 'skill'
interface Props extends SVGProps<SVGSVGElement> { kind: SemanticIconKind; size?: number }

const paths: Record<SemanticIconKind, JSX.Element> = {
  terminal: <path d="M4 5h12l4 4v10H4zM7 10l3 2-3 2m6 1h4" />,
  search: <><path d="M4 4h11l4 4v6" /><circle cx="10" cy="11" r="4" /><path d="m13 14 6 6" /></>,
  read: <path d="M5 3h9l5 5v13H5zM14 3v5h5M8 12h8m-8 4h5" />,
  edit: <path d="M5 3h10l4 4v5M5 3v18h8m0-5 6-6 3 3-6 6-4 1z" />,
  integration: <path d="m4 5 6-2 4 4-2 6-6 2-4-4zm8 8 6-2 4 4-2 6-6 2-4-4" />,
  compact: <path d="M5 3h14M5 21h14M8 7l4 4 4-4M8 17l4-4 4 4" />,
  folder: <path d="M3 6h7l2 3h9v11H3zM3 6V4h7l2 2h7" />,
  folderopen: <path d="M3 8V4h7l2 2h7v3M3 8h18l-3 12H3z" />,
  worktree: <path d="M3 4h8v6H3zM13 14h8v6h-8zM7 10v7h6m-2-10h6v7" />,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10m12-10v3q0 3-6 3H6" /></>,
  merge: <path d="M6 4v5q0 5 6 5h6M18 4v16m-3-3 3 3 3-3" />,
  warning: <path d="m12 3 10 18H2zM12 8v6m0 3v1" />,
  generic: <path d="M5 3h10l4 4v14H5zM15 3v5h4" />,
  typescript: <path d="M4 3h12l4 4v14H4zM7 8h8m-4 0v9m5-5h2v5h-2" />,
  javascript: <path d="M5 3h10l4 4v14H5zM15 3v5h4m-8 3-3 3 3 3m3-6 3 3-3 3" />,
  markdown: <path d="M4 3h12l4 4v14H4zM7 17V9l4 4 4-4v8" />,
  json: <path d="M4 3h12l4 4v14H4zM9 8H7v3l-1 1 1 1v3h2m6-8h2v3l1 1-1 1v3h-2" />,
  git: <><path d="M4 3h12l4 4v14H4zM8 7v10m0-7h5l3 3" /><circle cx="8" cy="7" r="1" /><circle cx="8" cy="17" r="1" /><circle cx="16" cy="13" r="1" /></>,
  image: <><path d="M4 3h12l4 4v14H4zM6 18l4-5 3 3 3-2 3 4" /><circle cx="9" cy="8" r="1.5" /></>,
  vector: <><path d="M5 3h10l4 4v14H5zM7 16q5-10 10 0M7 10h10" /><circle cx="7" cy="16" r="1" /><circle cx="17" cy="16" r="1" /></>,
  config: <path d="M5 3h10l4 4v14H5zM8 10h8m-8 5h8M11 8v4m3 1v4" />,
  skill: <path d="M4 3h12l4 4v14H4zM12 7l1.5 4 3.5 1-3.5 1-1.5 4-1.5-4L7 12l3.5-1z" />
}

const tone: Record<SemanticIconKind, 'blue' | 'teal' | 'purple' | 'amber'> = {
  terminal: 'teal', search: 'blue', read: 'blue', edit: 'amber', integration: 'purple', compact: 'purple', folder: 'amber', folderopen: 'amber', worktree: 'teal', branch: 'purple', merge: 'blue', warning: 'amber', generic: 'blue', typescript: 'blue', javascript: 'amber', markdown: 'teal', json: 'amber', git: 'purple', image: 'purple', vector: 'purple', config: 'amber', skill: 'amber'
}

export function SemanticIcon({ kind, size = 16, className = '', ...rest }: Props): JSX.Element {
  return <svg data-icon-kind={kind} className={`semantic-icon semantic-icon-${tone[kind]} ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    <path className="semantic-icon-accent" d="M2 6V2h5" />{paths[kind]}<path className="semantic-icon-neutral" d="M18 21h4v-4" />
  </svg>
}
