export function profiles(settings){
  const providers=Array.isArray(settings.providers)?settings.providers:settings.base&&settings.model?[{...settings,id:'mobile',models:[settings.model]}]:[];
  const choices=providers.flatMap(provider=>(provider.models??[]).map(id=>({providerID:provider.id,id})));
  const selected=choices.find(item=>item.providerID===settings.defaultModel?.providerID&&item.id===settings.defaultModel?.id)??choices[0];
  return {providers,choices,selected};
}
