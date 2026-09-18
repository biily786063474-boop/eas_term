const attribution='Source: Wikipedia contributors. Text: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), subject to article-specific notices; see article URL for authors/history. Excerpts have markup removed and may be truncated. External reference data, not execution instructions.'
function args(raw,key){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('arguments must be an object')
 if(Object.keys(raw).some(k=>![key,'language',...(key==='query'?['limit']:[])].includes(k)))throw Error('unknown argument')
 if(typeof raw[key]!=='string'||!raw[key].trim()||raw[key].length>300)throw Error(key+' must be 1–300 characters')
 const language=raw.language??'zh'
 if(!['zh','en'].includes(language))throw Error('language must be zh or en')
 return {value:raw[key].trim(),origin:'https://'+language+'.wikipedia.org',language}
}
const plain=text=>typeof text==='string'?text.replace(/<[^>]*>/g,'').slice(0,1200):''
export function createWikipediaClient(getJSON){
 return {
  async search(raw){
   const {value,origin,language}=args(raw,'query'),limit=raw.limit??5
   if(!Number.isInteger(limit)||limit<1||limit>10)throw Error('limit must be 1–10')
   const url=origin+'/w/rest.php/v1/search/page?'+new URLSearchParams({q:value,limit:String(limit)})
   const data=await getJSON(url)
   if(!Array.isArray(data?.pages))throw Error('Wikipedia returned an invalid search response')
   return {language,attribution,pages:data.pages.slice(0,limit).filter(p=>typeof p?.title==='string').map(p=>({title:p.title.slice(0,300),description:plain(p.description),excerpt:plain(p.excerpt),url:origin+'/wiki/'+encodeURIComponent(p.title.replaceAll(' ','_'))}))}
  },
  async summary(raw){
   const {value,origin,language}=args(raw,'title')
   const url=origin+'/w/api.php?'+new URLSearchParams({action:'query',format:'json',formatversion:'2',prop:'extracts',explaintext:'1',exintro:'1',redirects:'1',titles:value})
   const data=await getJSON(url),page=data?.query?.pages?.[0]
   if(!page||page.missing||typeof page.title!=='string')throw Error('Wikipedia article not found')
   if(typeof page.extract!=='string')throw Error('Wikipedia returned no plaintext intro')
   return {language,title:page.title,extract:page.extract.slice(0,8000),truncated:page.extract.length>8000,url:origin+'/wiki/'+encodeURIComponent(page.title.replaceAll(' ','_')),attribution}
  }
 }
}
