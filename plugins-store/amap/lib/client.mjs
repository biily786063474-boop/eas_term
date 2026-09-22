const origin='https://restapi.amap.com'
function keys(v,names){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!names.includes(k)))throw Error('参数无效')}
function text(v,max=300){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw Error('文本参数无效');return v}
function coordinate(v){if(typeof v!=='string'||!/^(-?\d{1,3}(?:\.\d{1,6})?),(-?\d{1,2}(?:\.\d{1,6})?)$/.test(v))throw Error('坐标格式无效：经度,纬度，最多6位小数');const [lon,lat]=v.split(',').map(Number);if(Math.abs(lon)>180||Math.abs(lat)>90)throw Error('坐标超出范围');return v}
function integer(v,min,max){if(!Number.isInteger(v)||v<min||v>max)throw Error('数量或范围参数无效');return v}
export function createAmapClient(config,request){
 if(!config||typeof config.key!=='string'||!config.key.trim()||config.key.length>512||/[\x00-\x20\x7f]/.test(config.key))throw Error('请先配置高德Web服务Key')
 const pick=(v,names)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('地图响应结构无效');const out={};for(const n of names){const x=v[n];if(typeof x==='string'&&x.length<=4000)out[n]=x.replaceAll(config.key,'[已隐藏]')}return out}
 const list=(v,max)=>{if(!Array.isArray(v)||v.length>max)throw Error('地图响应列表无效或过大');return v}
 async function query(path,params){
  const url=new URL(path,origin);url.search=new URLSearchParams({...params,key:config.key,output:'JSON'})
  let data;try{data=await request(url.href)}catch{throw Error('地图连接失败，请检查网络和配置（请求信息已隐藏）')}
  if(!data||data.status!=='1')throw Error('地图服务拒绝请求，请检查Key、权限和额度')
  return data
 }
 const result=data=>({source:'高德开放平台',sourceUrl:'https://developer.amap.com/api/webservice/summary',coordinateSystem:'GCJ-02',data,note:'供应商支持地区内的查询结果；路线仅供规划参考，以实际道路和交通规则为准。'})
 return {
  async geocode(args){keys(args,['address','city']);const params={address:text(args.address),batch:'false'};if(args.city!==undefined)params.city=text(args.city,100)
   const raw=await query('/v3/geocode/geo',params)
   return result(list(raw.geocodes,50).map(v=>pick(v,['formatted_address','province','city','district','adcode','citycode','location','level'])))
  },
  async nearby(args){keys(args,['location','keywords','radius','limit','page'])
   const params={location:coordinate(args.location),keywords:text(args.keywords,100),radius:String(integer(args.radius??1000,1,50000)),offset:String(integer(args.limit??10,1,25)),page:String(integer(args.page??1,1,100)),extensions:'base'}
   const raw=await query('/v3/place/around',params)
   return result(list(raw.pois,25).map(v=>pick(v,['id','name','type','typecode','address','location','distance','pname','cityname','adname','adcode'])))
  },
  async route(args){keys(args,['origin','destination','mode']);const mode=args.mode??'walking'
   if(!['walking','driving'].includes(mode))throw Error('路线模式仅支持walking/driving')
   const raw=await query('/v3/direction/'+mode,{origin:coordinate(args.origin),destination:coordinate(args.destination),extensions:'base'})
   const route=pick(raw.route,['origin','destination','taxi_cost'])
   route.paths=list(raw.route.paths,20).map(p=>({...pick(p,['distance','duration','strategy','tolls','toll_distance','traffic_lights']),steps:list(p.steps,2000).map(step=>pick(step,['instruction','orientation','road','distance','duration','action','assistant_action']))}))
   const out=result(route);if(JSON.stringify(out).length>512*1024)throw Error('路线结果过大');return out
  }
 }
}
