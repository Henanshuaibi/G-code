import {Fault,requireThat,integer,readUsage,redact} from './primitives.mjs';
export const retryableStatuses=new Set([408,429,500,502,503,504]);
const permanentErrorCodes=new Set(['invalid_request_error','invalid_request','invalid_prompt','invalid_parameter','context_length_exceeded','unsupported_parameter','authentication_error','invalid_api_key','permission_denied']);
const transientErrorCodes=new Set(['rate_limit_exceeded','rate_limit_error','rate_limit','server_error','internal_server_error','overloaded_error','service_unavailable']);
const common=['model','stream','tools','tool_choice','temperature','top_p','store','service_tier'];
const fields={chat:new Set([...common,'messages','stream_options','max_tokens','max_completion_tokens','parallel_tool_calls','frequency_penalty','presence_penalty','seed','stop','reasoning_effort','prompt_cache_key']),responses:new Set([...common,'input','instructions','prompt_cache_key','max_output_tokens','parallel_tool_calls','reasoning','text','include','truncation'])};
const optional=new Set(['temperature','top_p','parallel_tool_calls','frequency_penalty','presence_penalty','seed','stop','reasoning_effort','reasoning','prompt_cache_key','text','include','truncation','service_tier']);
export function prepare(body,protocol,model){
 requireThat(body&&typeof body==='object'&&!Array.isArray(body),400,'invalid_parameter','请求体须为 JSON 对象');
 for(const key of Object.keys(body))requireThat(fields[protocol].has(key),400,'unsupported_parameter',`平台未验证参数：${key}`);
 requireThat(body.model===model.id,400,'model_not_found','模型标识不正确');
 requireThat(body.stream===undefined||typeof body.stream==='boolean',400,'invalid_parameter','stream 必须为布尔值');
 requireThat(!body.store,400,'unsupported_parameter','平台禁止开启上游对话存储');
 requireThat(protocol===model.protocol,400,'protocol_mismatch','此模型使用另一接口类型，请刷新模型列表');
 if(protocol==='chat')requireThat(Array.isArray(body.messages)&&body.messages.length>0&&body.messages.length<=500,400,'invalid_parameter','messages 必须包含 1～500 条消息');
 if(protocol==='responses')requireThat(typeof body.input==='string'||Array.isArray(body.input),400,'invalid_parameter','Responses input 格式不正确');
 if(body.instructions!==undefined)requireThat(typeof body.instructions==='string',400,'invalid_parameter','instructions 须为文字');
 for(const field of ['temperature','top_p','frequency_penalty','presence_penalty'])if(body[field]!==undefined){const min=field.includes('penalty')?-2:0,max=field==='top_p'?1:2;requireThat(typeof body[field]==='number'&&Number.isFinite(body[field])&&body[field]>=min&&body[field]<=max,400,'invalid_parameter',field+' 超出合法范围');}
 if(body.parallel_tool_calls!==undefined)requireThat(typeof body.parallel_tool_calls==='boolean',400,'invalid_parameter','parallel_tool_calls 须为布尔值');
 if(body.seed!==undefined)integer(body.seed,'seed',-2147483648,2147483647);
 const tools=body.tools??[];requireThat(Array.isArray(tools)&&tools.length<=200,400,'invalid_tools','tools 须为最多 200 项的列表');
 requireThat(tools.every(tool=>tool?.type==='function'&&(protocol==='chat'?typeof tool.function?.name==='string':typeof tool.name==='string')),400,'unsupported_tools','平台目前只支持本机 function 工具，尚未验证上游托管工具');
 // Inline image bytes only: never fetch a user-specified remote URL or silently reduce images to text.
 let images=0,imageBytes=0;
 const scan=value=>{
  if(!value||typeof value!=='object')return value;
  if(['image_url','input_image'].includes(value.type)){
   requireThat(Object.keys(value).every(key=>['type','image_url','detail'].includes(key)),400,'unsupported_input','图片内容包含未支持的字段');
   if(value.type==='image_url')requireThat(value.image_url&&typeof value.image_url==='object'&&Object.keys(value.image_url).every(key=>['url','detail'].includes(key)),400,'unsupported_input','图片内容格式不正确');
   const url=value.type==='image_url'?value.image_url?.url:value.image_url;
   requireThat(typeof url==='string'&&/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(url),400,'unsupported_input','识图只接受内嵌 PNG/JPEG/WebP/GIF 图片，不接受远程地址');
   const comma=url.indexOf(','),mime=url.slice(5,url.indexOf(';')),bytes=Buffer.from(url.slice(comma+1),'base64');
   const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/gif'?/^GIF8[79]a/.test(bytes.subarray(0,6).toString()):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
   requireThat(valid&&bytes.length<=10*1048576,400,'unsupported_input','图片格式或大小不正确');images++;imageBytes+=bytes.length;requireThat(images<=16&&imageBytes<=20*1048576,400,'input_limit','每次最多 16 张画面，图片合计最多 20 MB');
   const detail=value.detail??value.image_url?.detail;requireThat(detail===undefined||['auto','low','high'].includes(detail),400,'invalid_parameter','图片清晰度参数不正确');
   return {type:value.type,image:'[image bytes reserved by full input cap]'};
  }
  if(['input_file','file','image','audio','input_audio'].includes(value.type))throw new Fault(400,'unsupported_input','平台目前支持文字、已确认的识图与函数工具；PDF/音频尚未开放');
  return Array.isArray(value)?value.map(scan):Object.fromEntries(Object.entries(value).map(([key,item])=>{if(['image_url','file_data','image','file_url'].includes(key))throw new Fault(400,'unsupported_input','图片必须使用协议规定的图像内容格式');return [key,scan(item)];}));
 };
 const textInput=scan(body.messages??body.input);
 const outputKey=protocol==='responses'?'max_output_tokens':body.max_completion_tokens!==undefined?'max_completion_tokens':'max_tokens';
 requireThat(!(body.max_tokens!==undefined&&body.max_completion_tokens!==undefined),400,'invalid_parameter','不能同时指定两种输出上限');
 const output=body[outputKey]??model.output_limit;integer(output,'最大输出 token',1,model.output_limit);
 // Full configured input cap is reserved; UTF-8 bytes plus protocol framing conservatively bound text payloads.
 const inputBytes=Buffer.byteLength(JSON.stringify(textInput))+Buffer.byteLength(JSON.stringify(tools))+Buffer.byteLength(body.instructions??'');
 const overhead=4096+(body.messages?.length??(Array.isArray(body.input)?body.input.length:1))*32+tools.length*128;
 requireThat(inputBytes+overhead<=model.input_limit,400,'input_limit','输入超出平台保守输入上限，请缩短上下文或联系管理员调整已验证的限制');
 requireThat(body.service_tier===undefined||['default','priority'].includes(body.service_tier),400,'unsupported_parameter','平台速度档只支持标准或 Fast；实际服务档由后台映射');
 const required=Object.keys(body).filter(key=>optional.has(key));
 const effort=body.reasoning_effort??body.reasoning?.effort;
 if(effort!==undefined)requireThat(typeof effort==='string',400,'invalid_parameter','思考强度格式不正确');
 if(body.reasoning)requireThat(typeof body.reasoning==='object'&&Object.keys(body.reasoning).every(key=>['effort','summary'].includes(key)),400,'unsupported_parameter','尚未验证该 reasoning 参数');
 if(body.stream_options)requireThat(body.stream===true&&Object.keys(body.stream_options).every(key=>key==='include_usage')&&body.stream_options.include_usage===true,400,'unsupported_parameter','只支持 include_usage: true 的流选项');
 return {body:{...body,store:false,[outputKey]:output,...(body.stream&&protocol==='chat'?{stream_options:{include_usage:true}}:{})},output,required,effort,stream:body.stream===true,tools:tools.length>0,images:images>0,fast:body.service_tier==='priority'};
}
export function supports(channel,request){const caps=channel.capabilities;return (!request.fast||(!!channel.fast_cost_price&&!!caps.fast_tier))&&(!request.images||caps.input.includes('image'))&&(!request.stream||caps.stream)&&(!request.tools||caps.tools)&&request.required.every(key=>caps.params.includes(key))&&(!request.effort||caps.reasoning_efforts.includes(request.effort));}
export function observe(data,protocol,schema){
 requireThat(data&&typeof data==='object'&&!Array.isArray(data),502,'invalid_response','上游响应结构不正确');
 if(data.error||data.response?.error||data.type==='error'||data.type==='response.failed'){
  const detail=data.error??data.response?.error??data,status=Number(detail?.status??data.status_code??data.status),code=detail?.code??detail?.type??data.code;
  if(permanentErrorCodes.has(code)||(status>=400&&status<500&&!retryableStatuses.has(status)))throw new Fault(400,'upstream_rejected','上游拒绝本次参数或配置');
  if(retryableStatuses.has(status)||transientErrorCodes.has(code))throw new Fault(502,'upstream_retryable','渠道暂时不可用');
  throw new Fault(502,'upstream_failure','上游错误未满足安全重试条件');
 }
 if(protocol==='chat')requireThat(Array.isArray(data.choices),502,'invalid_response','上游没有返回 Chat choices');
 if(protocol==='chat'){
  const usageReported=data.choices.length===0||data.choices.some(choice=>choice.finish_reason!=null)&&data.usage!=null;
  return {emitted:data.choices.some(choice=>{const delta=choice.delta??choice.message??{};return !!(delta.content||delta.refusal||delta.reasoning_content||delta.reasoning||delta.tool_calls?.length);}),usageReported,usage:usageReported?readUsage(data.usage,schema):null,terminal:false};
 }
 const terminal=['response.completed','response.incomplete'].includes(data.type);
 const emitted=!!(data.type?.includes('.delta')&&data.delta)||data.type==='response.output_item.added'&&data.item?.type==='function_call'||!!data.output?.length||!!data.response?.output?.length;
 const usageReported=terminal||['completed','incomplete'].includes(data.status);
 return {emitted,terminal,usageReported,usage:usageReported?readUsage(data.response?.usage??data.usage,schema):null};
}
export async function* events(stream,signal){
 const reader=stream.getReader(),decoder=new TextDecoder();let buffer='',bytes=0;
 try{while(true){signal.throwIfAborted();const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;requireThat(bytes<=32*1024*1024,502,'upstream_limit','上游响应超过限制');buffer=(buffer+decoder.decode(next.value,{stream:true})).replace(/\r\n/g,'\n');requireThat(buffer.length<=2*1024*1024,502,'upstream_limit','上游流事件超过限制');let at;while((at=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,at);buffer=buffer.slice(at+2);const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data)yield data;}}buffer+=decoder.decode();requireThat(!buffer.trim(),502,'stream_truncated','上游流中途断开');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function frame(data,protocol,secrets){if(data==='[DONE]')return 'data: [DONE]\n\n';const json=redact(data,secrets),type=protocol==='responses'?JSON.parse(json).type:undefined;return (type?'event: '+String(type).replace(/[^a-zA-Z0-9_.-]/g,'')+'\n':'')+'data: '+json+'\n\n';}
