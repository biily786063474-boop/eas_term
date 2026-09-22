const endpoint='https://restapi.amap.com/v3/weather/weatherInfo'
const common=['adcode','province','city','reporttime']
const live=[...common,'weather','temperature','winddirection','windpower','humidity']
const cast=['date','week','dayweather','nightweather','daytemp','nighttemp','daywind','nightwind','daypower','nightpower']
export function createWeatherClient(config,request){
 if(!config||typeof config.key!=='string'||!config.key.trim()||config.key.length>512||/[\x00-\x20\x7f]/.test(config.key))throw Error('请先配置高德Web服务Key')
 const pick=(record,fields)=>{const out={};for(const name of fields){const v=record[name];if(typeof v==='string'&&v.length<=200)out[name]=v.replaceAll(config.key,'[已隐藏]')}return out}
 async function query(args,forecast){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>k!=='city')||typeof args.city!=='string'||!/^\d{6}$/.test(args.city))throw Error('city必须为6位高德行政区编码')
  const url=new URL(endpoint);url.search=new URLSearchParams({key:config.key,city:args.city,extensions:forecast?'all':'base',output:'JSON'})
  let raw;try{raw=await request(url.href)}catch{throw Error('天气连接失败，请检查网络与配置（请求信息已隐藏）')}
  if(!raw||raw.status!=='1')throw Error('天气服务拒绝请求，请检查Key、授权范围与额度')
  const rows=raw[forecast?'forecasts':'lives']
  if(!Array.isArray(rows)||!rows.length||rows.length>10||rows.some(row=>!row||row.adcode!==args.city))throw Error('天气数据为空或地区不匹配')
  const data=rows.map(row=>{
   const item=pick(row,forecast?common:live)
   if(forecast){if(!Array.isArray(row.casts)||!row.casts.length||row.casts.length>16||row.casts.some(c=>!c||typeof c!=='object'))throw Error('天气预报数据无效');item.casts=row.casts.map(c=>pick(c,cast))}
   return item
  })
  return {source:'高德开放平台天气服务',sourceUrl:'https://developer.amap.com/api/webservice/guide/api/weatherinfo',kind:forecast?'forecast':'current',data,note:'时间以reporttime为准；供应商支持区域内的数据，不是设备实测，也不保证预报必然发生。'}
 }
 return {current:args=>query(args,false),forecast:args=>query(args,true)}
}
