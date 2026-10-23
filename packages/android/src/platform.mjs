import path from 'node:path';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {jsonBody} from './http-body.mjs';
export const platformModels=[{id:'gcode-sol',name:'GPT 6.1 Sol'},{id:'gcode-flash',name:'DeepSeek V4.1 Flash'}];
export const isPlatform=id=>id==='gcode_platform_chat'||id==='gcode_platform_responses';
function baseURL(value){let url;try{url=new URL(value);}catch{throw new Error('请填写平台 HTTPS 服务地址');}if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(url.hostname))))throw new Error('平台地址必须是 HTTPS；HTTP 只允许本机模拟服务');return url.href.replace(/\/+$/,'');}
export class PlatformAccount {
 static async create(root,deployment={}){
  const account=new PlatformAccount();account.file=path.join(root,'platform-session.json');account.session={};account.models=[];account.localTest=deployment.local_test===true;account.serviceBase=deployment.base_url?baseURL(deployment.base_url):'';account.key=randomBytes(32).toString('base64url');account.running=new Set();
  try{account.session=JSON.parse(await readFile(account.file,'utf8'));if(account.session.base)account.session.base=baseURL(account.session.base);}catch{account.session={};}
  if(account.serviceBase&&account.session.base!==account.serviceBase){account.session={base:account.serviceBase};await account.persist();}
  account.broker=createServer((req,res)=>void account.forward(req,res));await new Promise(resolve=>account.broker.listen(0,'127.0.0.1',resolve));account.base='http://127.0.0.1:'+account.broker.address().port;
  if(account.session.token)await account.refresh().catch(()=>{});return account;
 }
 async persist(session=this.session){const temporary=this.file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify(session),{mode:0o600});await rename(temporary,this.file);}finally{await rm(temporary,{force:true}).catch(()=>{});}}
 async api(route,input,authenticated=true,session=this.session){
  if(!session.base)throw new Error('请先填写平台服务地址并登录');if(authenticated&&!session.token)throw new Error('请先登录平台余额账号');
  let response;try{response=await fetch(session.base+'/api/'+route,{method:input?'POST':'GET',headers:{'Content-Type':'application/json','X-GCode-Client':'android',...(authenticated?{Authorization:'Bearer '+session.token}:{})},...(input?{body:JSON.stringify(input)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw new Error('平台服务连接失败，请检查地址和网络');}
  let data;try{data=await response.json();}catch{throw new Error('平台返回格式不正确');}if(!response.ok)throw Object.assign(new Error(data.error?.message??'平台请求失败'),{status:response.status});return data;
 }
 async refresh(){const [account,catalog]=await Promise.all([this.api('me'),this.api('catalog',undefined,false)]);this.user=account.user;this.models=catalog.models;this.disclosure=catalog.disclosure;return this.status();}
 status(){return {localTest:this.localTest,serviceConfigured:!!(this.serviceBase||this.session.base),managed:!!this.serviceBase,connected:!!this.session.token,base:this.session.base??'',user:this.user??null,models:this.models,disclosure:this.disclosure??'平台请求经过第三方服务商；默认不保存完整提示词、代码和回答。'};}
 providers(){if(!this.session.token)return [];return ['chat','responses'].map(protocol=>({id:'gcode_platform_'+protocol,name:'平台余额',billingMode:'platform',models:this.models.filter(model=>model.protocol===protocol&&model.available).map(model=>model.id),modelLabels:Object.fromEntries(this.models.map(model=>[model.id,model.name])),protocol})).filter(provider=>provider.models.length);}
 async action(action,input){
  if(this.accountBusy)throw new Error('正在处理账号操作，请稍候');
  const changing=['login','register','logout'].includes(action);
  if(changing&&this.running.size)throw new Error('请先停止正在运行的平台调用，再变更账号');
  this.accountBusy=true;this.changing=changing;
  try{return await this.perform(action,input);}finally{this.accountBusy=false;this.changing=false;}
 }
 async perform(action,input){
  if(action==='status'){if(!this.session.token)return this.status();try{return await this.refresh();}catch(error){if(error.status===401||error.status===403){this.session={base:this.session.base};this.user=null;this.models=[];await this.persist();return {...this.status(),disclosure:error.message};}throw error;}}
  if(action==='login'||action==='register'){
   if(input.accepted_terms!==true)throw new Error('请先确认第三方模型服务商说明');
   if(this.serviceBase&&input.base&&baseURL(input.base)!==this.serviceBase)throw new Error('此版本已连接运营方统一服务，无需更改地址');
   if(!this.serviceBase&&!input.base&&!this.session.base)throw new Error('运营者尚未配置 G Code 服务，暂未开放注册和充值');
   const next={base:this.serviceBase||baseURL(input.base||this.session.base)};
   try{
    let proof;
    if(action==='register'){const challenge=await this.api('register-challenge',undefined,false,next);if(challenge.difficulty!==14)throw new Error('注册校验格式不正确');for(let counter=0;counter<=8000000;counter++){if(Date.now()>=challenge.expires_at)throw new Error('注册校验已过期，请重试');const hash=createHash('sha256').update(challenge.nonce+':'+counter).digest();if(hash[0]===0&&(hash[1]&252)===0){proof={id:challenge.id,counter};break;}if(counter%1024===0)await new Promise(setImmediate);}if(!proof)throw new Error('注册校验未完成，请稍后重试');}
    const info=await this.api(action,{username:input.username,password:input.password,accepted_terms:true,registration_proof:proof},false,next);
    if(typeof info.token!=='string'||!info.token)throw new Error('平台未返回 Android 登录凭据');next.token=info.token;
    const [account,catalog]=await Promise.all([this.api('me',undefined,true,next),this.api('catalog',undefined,false,next)]);
    if(!account.user?.id||!Array.isArray(catalog.models))throw new Error('平台账号或模型列表格式不正确');
    // Publish the new identity only after every remote read and the atomic disk write succeed.
    await this.persist(next);this.session=next;this.user=account.user;this.models=catalog.models;this.disclosure=catalog.disclosure;
    return this.status();
   }catch(error){if(next.token)await this.api('logout',{},true,next).catch(()=>{});throw error;}
  }
  if(action==='logout'){try{if(this.session.token)await this.api('logout',{});}finally{for(const controller of this.running)controller.abort();this.session={base:this.session.base};this.user=null;this.models=[];await this.persist();}return this.status();}
  if(action==='redeem'){await this.api('redeem',{code:input.code});return this.refresh();}
  if(action==='history'){const offset=input.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new Error('账单页码不正确');const data=await this.api('history?offset='+offset);if(data.user)this.user=data.user;return data;}
  throw new Error('不支持的平台账号操作');
 }
 async forward(req,res){
  const controller=new AbortController();this.running.add(controller);res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
   const auth=req.headers.authorization??'',expected='Bearer '+this.key;if(auth.length!==expected.length||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected)))throw new Error('本机模型连接未授权');
   if(!['/chat/v1/chat/completions','/responses/v1/responses'].includes(req.url)||req.method!=='POST')throw new Error('平台接口不支持');
   if(this.changing)throw new Error('账号正在变更，请稍候再发起平台调用');
   if(!this.session.token)throw new Error('请先登录平台余额账号');
   const input=await jsonBody(req,32*1024*1024),protocol=req.url.startsWith('/responses/')?'responses':'chat';
   const model=this.models.find(item=>item.id===input.model&&item.protocol===protocol&&item.available);if(!model)throw new Error('平台模型不可用，请刷新账号状态');
   if(protocol==='chat'){
    for(const field of ['max_tokens','max_completion_tokens'])if(input[field]>model.output_limit)input[field]=model.output_limit;
   }else if(input.max_output_tokens>model.output_limit)input.max_output_tokens=model.output_limit;
   const response=await fetch(this.session.base+(protocol==='chat'?'/v1/chat/completions':'/v1/responses'),{method:'POST',headers:{Authorization:'Bearer '+this.session.token,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(input),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(135000)]),redirect:'error'});
   // Non-2xx platform errors are terminal to Core: routing retries belong to the backend.
   if(!response.ok){let data;try{data=await response.json();}catch{}throw new Error(data?.error?.message??'平台调用失败，请检查余额和调用记录');}
   res.writeHead(200,{'Content-Type':response.headers.get('content-type')??'application/json','Cache-Control':'no-store'});
   const reader=response.body.getReader();try{while(true){const next=await reader.read();if(next.done)break;if(!res.write(next.value))await new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(new Error('已取消'));},drain=()=>{cleanup();resolve();},cleanup=()=>{res.off('drain',drain);controller.signal.removeEventListener('abort',abort);};res.once('drain',drain);controller.signal.addEventListener('abort',abort,{once:true});});}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}res.end();
  }catch(error){if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});if(!res.writableEnded&&!res.destroyed)res.end(JSON.stringify({error:{message:controller.signal.aborted?'调用已取消，请在平台账单核对结算状态':error.message,type:'invalid_request_error'}}));}
  finally{this.running.delete(controller);}
 }
 async close(){for(const controller of this.running)controller.abort();this.broker.closeAllConnections();await new Promise(resolve=>this.broker.close(resolve));}
}
export function platformPlugin(){return {id:'g-code-platform-billing',setup:async context=>{
 const retry=await context.session.hook('retry',event=>{if(isPlatform(event.model.providerID))event.decision={retry:false};});
 // Automatic titles should not create an additional paid request behind the user's back.
 const title=await context.session.hook('title',event=>{if(isPlatform(event.model.providerID))event.result='新会话';});
 return async()=>{await Promise.all([retry.dispose(),title.dispose()]);};
}};}
