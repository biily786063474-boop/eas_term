/** Navigation uses metadata only; selecting/searching never reveals values. */
export function secretNavigation<T extends {id:string;name:string;note?:string;vars:{varName:string}[]}>(items:T[],query:string,selectedId:string|null):{filtered:T[];selected:T|undefined} {
 const q=query.trim().toLocaleLowerCase()
 const filtered=items.filter(it=>[it.name,it.note??'',...it.vars.map(v=>v.varName)].join(' ').toLocaleLowerCase().includes(q))
 return {filtered,selected:filtered.find(it=>it.id===selectedId)??filtered[0]}
}
