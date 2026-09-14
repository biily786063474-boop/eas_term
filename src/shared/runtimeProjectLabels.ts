/** Display only. IDs remain the sole ownership/stop authority. */
export function runtimeProjectLabels(ids:readonly string[],projects:readonly {id:string;name:string}[]):string[]{
 return ids.map(id=>{const project=projects.find(p=>p?.id===id);return (project?((typeof project.name==='string'&&project.name.trim())||'未命名项目'):'未找到项目')+'（'+id+'）'})
}
