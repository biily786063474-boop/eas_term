/** Shared by dictionary preload and composer search: raw user IDs never occupy builtin IDs. */
export function userTermIdentity(term: { id: string; zh: string; en: string }): { id: string; zh: string } {
  return { id: 'user:' + term.id, zh: term.zh || term.en }
}
