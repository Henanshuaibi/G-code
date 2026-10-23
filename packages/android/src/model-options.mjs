export const efforts=['none','minimal','low','medium','high','xhigh','max'];
export const fastTiers=['priority','fast','ultrafast'];
export function variants(protocol,definition={}){
 const result=[];for(const effort of ['',...(definition.reasoningEfforts??[])])for(const fast of [false,...(definition.fastTier?[true]:[])]){
  if(!effort&&!fast)continue;
  result.push({id:'gcode-'+(effort||'default')+(fast?'-fast':''),effort,tier:fast?'fast':'',body:{...(effort?(protocol==='responses'?{reasoning:{effort}}:{reasoning_effort:effort}):{}),...(fast?{service_tier:definition.fastTier}:{})}});
 }return result;
}
export function publicVariants(items){return items.map(item=>({id:item.id,effort:item.effort??item.body?.reasoning_effort??item.body?.reasoning?.effort??item.settings?.reasoningEffort??'',tier:item.tier??(fastTiers.includes(item.body?.service_tier??item.settings?.serviceTier)?'fast':'')}));}
