const count=value=>Number.isFinite(value)&&value>=0?value:0;
export function tokenUsage(tokens){
  if(!tokens)return null;
  const input=count(tokens.input),output=count(tokens.output),reasoning=count(tokens.reasoning),read=count(tokens.cache?.read),write=count(tokens.cache?.write);
  return {input,output,reasoning,read,write,total:input+output+reasoning+read+write};
}
export function usageLabel(tokens){const usage=tokenUsage(tokens);return usage?usage.total.toLocaleString('zh-CN')+' tokens':'用量未返回';}
export async function deleteSelected(ids,remove,onDeleted=()=>{}){
  const deleted=[],failed=[];
  for(const id of [...new Set(ids)]){
    try{await remove(id);}catch(error){failed.push({id,message:error.message});continue;}
    deleted.push(id);await onDeleted(id);
  }
  return {deleted,failed};
}
