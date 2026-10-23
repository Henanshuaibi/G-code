import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {Fault,requireThat,digest,decrypt,redact} from './primitives.mjs';
import {prepare,supports,observe,events,frame,retryableStatuses} from './protocol.mjs';
function checkServiceTier(request,channel,data,observed){
 if(!request.fast||!observed.usageReported)return;const reported=data.response?.service_tier??data.service_tier;if(reported===undefined||reported===null)return;const expected=channel.capabilities.fast_tier,aliases=['priority','fast'];requireThat(reported===expected||(aliases.includes(expected)&&aliases.includes(reported)),502,'service_tier_mismatch','上游返回的服务档与已购 Fast 不符，请核对本次账单');
}
export class Gateway {
 constructor(store,logger=()=>{}){this.store=store;this.logger=logger;this.running=new Map();}
 abortUser(id){for(const item of this.running.values())if(item.userId===id)item.controller.abort();}
 async close(){for(const item of this.running.values())item.controller.abort();await Promise.all([...this.running.values()].map(item=>item.done));}
 async call(req,res,user,body,protocol){
  requireThat(typeof body?.model==='string',400,'invalid_parameter','请指定平台模型');
  const store=this.store,model=store.get('SELECT * FROM models WHERE id=?',body?.model);
  requireThat(model&&model.enabled,503,'model_unavailable','此模型未启用');requireThat(model.sale_price,503,'price_unconfigured','模型销售价格未配置，暂不可用');
  const prepared=prepare(body,protocol,model),routes=store.routes(model.id,protocol).filter(channel=>supports(channel,prepared)).map(channel=>prepared.fast?{...channel,cost_price:channel.fast_cost_price}:channel);
  requireThat(!prepared.fast||model.fast_sale_price,503,'fast_price_unconfigured','此模型 Fast 售价未配置，未发起收费调用');
  requireThat(routes.length,503,'no_compatible_channel','此模型暂无已确认且支持本次功能的渠道');
  const id=req.headers['idempotency-key'],request=store.reserve(user.id,id,model,prepared.output,digest(store.key,protocol+JSON.stringify(body)),protocol,{fast:prepared.fast,effort:prepared.effort});
  res.setHeader('X-GCode-Request-Id',request.id);
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(new Fault(408,'route_timeout','路由总时限已到')),store.config.routeDeadline);deadline.unref();
  let release;const done=new Promise(resolve=>release=resolve);this.running.set(request.id,{controller,userId:user.id,done});
  const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
  let emitted=false,attempt=null,channel=null,usage=null,code='no_available_channel',terminal=false,headers=false;
  const send=async value=>{controller.signal.throwIfAborted();if(!headers){res.writeHead(200,{'Content-Type':prepared.stream?'text/event-stream; charset=utf-8':'application/json; charset=utf-8','X-Accel-Buffering':'no'});headers=true;}if(!res.write(value)){await once(res,'drain',{signal:controller.signal});}};
  try{
   const available=routes.filter(item=>item.cooldown_until<=store.now());let attempts=0;
   for(const candidate of available){
    if(attempts>=store.config.maxAttempts||controller.signal.aborted)break;
    channel=candidate;usage=null;terminal=false;
    try{attempt=store.reserveAttempt(request,channel);}catch(error){if(error.code==='daily_cost_limit'){code=error.code;break;}if(error.code==='channel_busy'){code=error.code;continue;}throw error;}
    attempts++;const key=decrypt(store.key,channel.key_ciphertext,'channel:'+channel.id),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(channel.timeout_ms)]);
    const payload={...prepared.body,model:channel.upstream_model,...(prepared.fast?{service_tier:channel.capabilities.fast_tier}:channel.capabilities.fast_tier&&channel.capabilities.params.includes('service_tier')?{service_tier:'default'}:{})};
    if(channel.capabilities.output_parameter){delete payload.max_tokens;delete payload.max_completion_tokens;delete payload.max_output_tokens;payload[channel.capabilities.output_parameter]=prepared.output;}

    const suffix=protocol==='chat'?'/chat/completions':'/responses';
    try{
     store.assertWorker();
     const upstream=await fetch(channel.base_url+suffix,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','X-Request-Id':request.id+'-'+attempt.id},body:JSON.stringify(payload),signal,redirect:'error'});
     store.assertWorker();
     if(!upstream.ok){await upstream.body?.cancel();throw new Fault(retryableStatuses.has(upstream.status)?502:400,retryableStatuses.has(upstream.status)?'upstream_retryable':'upstream_rejected',retryableStatuses.has(upstream.status)?'渠道暂时不可用':'上游拒绝本次参数或配置，请联系管理员核对');}
     if(prepared.stream){
      requireThat((upstream.headers.get('content-type')??'').includes('text/event-stream'),502,'invalid_stream','上游未返回已验证的 SSE 格式');
      const pending=[];let pendingSize=0,invalidUsage=false;const tail=[];
      for await(const text of events(upstream.body,signal)){
       store.assertWorker();store.user(user.id);signal.throwIfAborted();
       if(text==='[DONE]'){requireThat(protocol==='chat',502,'invalid_stream','Responses 流缺少标准结束事件');terminal=true;tail.push(frame(text,protocol,[key]));break;}
       requireThat(!terminal,502,'invalid_stream','结束事件之后仍返回内容');
       let data;try{data=JSON.parse(text);}catch{throw new Fault(502,'invalid_stream','上游 SSE 数据不是 JSON');}
       const observed=observe(data,protocol,channel.usage_schema);checkServiceTier(prepared,channel,data,observed);
       if(observed.usageReported){
        // Malformed/conflicting final reports cannot fall back to an earlier counter.
        if(!observed.usage||(usage&&JSON.stringify(usage)!==JSON.stringify(observed.usage)))invalidUsage=true;
        usage=invalidUsage?null:observed.usage;
       }
       const encoded=frame(data,protocol,[key]);
       if(observed.emitted&&!observed.terminal&&!emitted){store.emitted(request.id,channel.id);emitted=true;for(const saved of pending)await send(saved);pending.length=0;}
       if(observed.terminal){terminal=true;tail.push(encoded);break;}
       else if(emitted)await send(encoded);
       else{pendingSize+=encoded.length;requireThat(pendingSize<=262144,502,'upstream_limit','上游未输出有效内容');pending.push(encoded);}
      }
      requireThat(terminal,502,'stream_truncated','上游流中途断开');
      const finished=store.finishAttempt(attempt.id,usage,usage?'completed':'usage_missing');attempt=null;
      const settled=store.finish(request.id,usage,usage?'completed':'usage_missing',channel.id);code=settled.code;
      requireThat(settled.status==='settled',502,'usage_pending','上游没有可靠的完整用量，本次预留待管理员核对；请勿重复提交任务');
      store.channelResult(channel.id,true);
      for(const saved of pending)await send(saved);for(const saved of tail)await send(saved);res.end();
      this.log(request,channel,finished.cost_kind==='actual'?'settled':'no_usage');return;
     }
     const bytes=Buffer.from(await upstream.arrayBuffer());requireThat(bytes.length<=32*1024*1024,502,'upstream_limit','上游响应超过限制');
     let data;try{data=JSON.parse(bytes.toString());}catch{throw new Fault(502,'invalid_response','上游没有返回 JSON');}
     const observed=observe(data,protocol,channel.usage_schema);checkServiceTier(prepared,channel,data,observed);usage=observed.usage;terminal=true;
     store.finishAttempt(attempt.id,usage,usage?'completed':'usage_missing');attempt=null;
     const settled=store.finish(request.id,usage,usage?'completed':'usage_missing',channel.id);
     requireThat(settled.status==='settled',502,'usage_pending','上游未提供可靠用量，本次预留待管理员核对');
     store.channelResult(channel.id,true);await send(redact(data,[key]));res.end();this.log(request,channel,'settled');return;
    }catch(error){
     code=controller.signal.aborted?(controller.signal.reason?.code??'cancelled'):error instanceof Fault?error.code:signal.aborted?'upstream_timeout':'upstream_connection';
     if(attempt){store.finishAttempt(attempt.id,null,code);attempt=null;}
     const mayRetry=!emitted&&!controller.signal.aborted&&['upstream_retryable','upstream_connection','upstream_timeout','invalid_stream','stream_truncated','invalid_response'].includes(code);
     if(mayRetry)store.channelResult(channel.id,false);
     this.log(request,channel,code);
     if(!mayRetry)break;
    }
   }
   const settled=store.finish(request.id,null,code,channel?.id??null);
   const message=settled.status==='needs_review'?(code==='service_tier_mismatch'?'输出已开始但上游服务档与所购 Fast 不符，预留待管理员核对；不会自动重跑。':'输出已开始但完整用量缺失，预留余额待管理员核对；不会自动重跑。'):code==='usage_pending'?'上游未提供可靠用量，本次未交付回答，预留已释放，请联系管理员核对渠道。':code==='service_tier_mismatch'?'上游未提供所选 Fast 档，本次未交付回答，预留已释放，请联系管理员核对。':code==='upstream_failure'?'上游返回无法安全重试的错误，本次预留已释放，请联系管理员。':code==='daily_cost_limit'?'平台当日成本预算已满，本次预留已释放。':code==='upstream_rejected'?'上游拒绝本次参数或配置，本次预留已释放，请联系管理员。':code==='route_timeout'?'调用超过总时限，未使用的预留已释放。':code==='cancelled'?'调用已取消，未使用的预留已释放。':'此模型的可用渠道暂时均不可用，本次预留已释放。';
   if(!res.destroyed&&!res.writableEnded){if(headers)res.end('event: error\ndata: '+JSON.stringify({error:{message,code,request_id:request.id}})+'\n\n');else{res.writeHead(code==='upstream_rejected'?400:['usage_pending','upstream_failure','service_tier_mismatch'].includes(code)?502:code==='route_timeout'?504:code==='cancelled'?499:503,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:{message,code,request_id:request.id}}));}}
  }catch(error){
   if(attempt)store.finishAttempt(attempt.id,null,'gateway_interrupted');store.finish(request.id,null,'gateway_interrupted',channel?.id??null);
   if(!res.destroyed&&!res.writableEnded){const message='请求处理异常，请凭请求编号核对账单后再试';if(headers)res.end('event: error\ndata: '+JSON.stringify({error:{message,code:'gateway_interrupted',request_id:request.id}})+'\n\n');else{res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:{message,code:'gateway_interrupted',request_id:request.id}}));}}
   this.log(request,channel,'gateway_interrupted');
  }finally{clearTimeout(deadline);res.off('close',disconnect);this.running.delete(request.id);release();}
 }
 log(request,channel,code){this.logger({event:'model_request',request_id:request.id,user_id:request.user_id,model_id:request.model_id,channel_id:channel?.id??null,code});}
}
