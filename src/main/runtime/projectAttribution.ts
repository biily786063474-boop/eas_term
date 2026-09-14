import path from 'node:path'
/** Display attribution only, NEVER an authorization or filesystem guard. */
export function projectAttribution(cwd:string,projects:readonly {id:string;path:string}[]):string|null{
 if(!cwd||!path.isAbsolute(cwd))return null
 const target=path.resolve(cwd)
 return projects.filter(p=>typeof p.path==='string'&&path.isAbsolute(p.path)).filter(p=>{const relative=path.relative(path.resolve(p.path),target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))}).sort((a,b)=>b.path.length-a.path.length)[0]?.id??null
}
