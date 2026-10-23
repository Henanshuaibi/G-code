import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {Store} from './store.mjs';
import {Gateway} from './gateway.mjs';
import {Fault,requireThat,hashPassword,verifyPassword,integer,string,decrypt,secret} from './primitives.mjs';

async function jsonBody(req,limit=2*1024*1024){requireThat(Number(req.headers['content-length']??0)<=limit,413,'body_limit','请求体超过接口允许的大小');let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;requireThat(bytes<=limit,413,'body_limit','请求体超过接口允许的大小');chunks.push(chunk);}try{const data=JSON.parse(Buffer.concat(chunks).toString());requireThat(data&&typeof data==='object'&&!Array.isArray(data),400,'invalid_json','请求体须为 JSON 对象');return data;}catch{throw new Fault(400,'invalid_json','请求体不是有效 JSON');}}
export async function createPlatform(config,logger=()=>{}){
 const store=new Store(config),owner=randomUUID();store.lock(owner);store.workerOwner=owner;store.recover(true);
 const gateway=new Gateway(store,logger),dummyHash=await hashPassword(secret());let authInFlight=0,largeModelInFlight=0;
 const maintenance=setInterval(()=>{try{store.lock(owner);store.recover();store.run('DELETE FROM sessions WHERE expires_at<?',store.now());store.run('DELETE FROM auth_limits WHERE window_at<?',store.now()-3600000);}catch{void gateway.close();server.close();}},10000);maintenance.unref();
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,'http://localhost'),route=url.pathname,write=!['GET','HEAD'].includes(req.method);
   if(req.headers.origin)requireThat(req.headers.origin===config.origin,403,'origin_rejected','请求来源不受信任');
   if(route==='/health'&&req.method==='GET'){send({ok:true});return;}
   const files={'/':'index.html','/app.js':'app.js','/registration.js':'registration.js','/prices.js':'prices.js','/style.css':'style.css'};
   if(req.method==='GET'&&Object.hasOwn(files,route)){res.writeHead(200,{'Content-Type':route.endsWith('.js')?'text/javascript; charset=utf-8':route.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(await readFile(new URL('../web/'+files[route],import.meta.url)));return;}
   if(route==='/api/register-challenge'&&req.method==='GET'){requireThat(config.registration,403,'registration_closed','目前暂不开放注册');send(store.issueRegistration(req.socket.remoteAddress));return;}
   if(route==='/api/catalog'&&req.method==='GET'){send({models:store.catalogue(),currency:'CNY',unit:'1 CNY = 1000000 micros; prices per 1000000 tokens',disclosure:config.disclosure??'请求将经过运营者配置的第三方模型服务商。平台默认不保存提示词、代码和模型回答；服务商有各自的数据政策。'});return;}
   if(['/api/register','/api/login'].includes(route)&&req.method==='POST'){
    store.throttle('auth-global',120);store.throttle('auth-ip:'+req.socket.remoteAddress,30);
    const socket=req.socket,stop=()=>req.destroy();socket.setTimeout(10000);socket.once('timeout',stop);let input;try{input=await jsonBody(req,8192);}finally{socket.setTimeout(0);socket.off('timeout',stop);}
    const username=typeof input.username==='string'?input.username.trim().toLowerCase():'';store.throttle('auth-user:'+username,12);
    requireThat(authInFlight<(config.authConcurrency??2),429,'auth_busy','登录注册请求较多，请稍后重试');authInFlight++;
    let user;
    try{
     if(route==='/api/register'){
      requireThat(config.registration,403,'registration_closed','目前暂不开放注册');requireThat(input.accepted_terms===true,400,'consent_required','请确认请求经过第三方服务商的说明');requireThat(!input.website,400,'registration_challenge','注册校验无效');store.throttle('register-ip:'+req.socket.remoteAddress,5);store.throttle('register-global',30);store.consumeRegistration(req.socket.remoteAddress,input.registration_proof);
      user=store.createUser(username,await hashPassword(input.password));
     }else{
      const found=store.get('SELECT * FROM users WHERE username=?',username);requireThat(await verifyPassword(input.password,found?.password_hash??dummyHash)&&found,401,'login_failed','账号或密码不正确');user=store.user(found.id);
     }
    }finally{authInFlight--;}
    const session=store.createSession(user.id);res.setHeader('Set-Cookie',`gcode_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${config.production?'; Secure':''}`);
    send({user:store.publicUser(user),csrf:session.csrf,...(req.headers['x-gcode-client']==='android'?{token:session.token}:{})});return;
   }
   const bearer=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1],cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('gcode_session='))?.slice(14);
   const session=store.authenticate(bearer??cookie),user=session.user;
   if(write&&!bearer){const csrf=req.headers['x-csrf-token'];requireThat(typeof csrf==='string'&&csrf.length===session.csrf.length&&timingSafeEqual(Buffer.from(csrf),Buffer.from(session.csrf)),403,'csrf_rejected','页面会话校验失败，请刷新后重试');}
   if(route==='/api/me'&&req.method==='GET'){send({user:store.publicUser(user),csrf:session.csrf});return;}
   if(route==='/api/logout'&&req.method==='POST'){store.run('DELETE FROM sessions WHERE digest=?',session.digest);res.setHeader('Set-Cookie',`gcode_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.production?'; Secure':''}`);send({ok:true});return;}
   if(route==='/api/redeem'&&req.method==='POST'){store.throttle('redeem:'+user.id,15);const input=await jsonBody(req);send({user:store.redeem(user.id,input.code)});return;}
   if(route==='/api/history'&&req.method==='GET'){send(store.history(user.id,Number(url.searchParams.get('offset')??0)));return;}
   if(['/v1/chat/completions','/v1/responses'].includes(route)&&req.method==='POST'){const large=Number(req.headers['content-length']??Infinity)>2*1024*1024;requireThat(!large||largeModelInFlight<1,429,'large_request_busy','已有较大的图片请求正在处理，请稍后再发送');if(large)largeModelInFlight++;try{const socket=req.socket,stop=()=>req.destroy();socket.setTimeout(15000);socket.once('timeout',stop);let input;try{input=await jsonBody(req,32*1024*1024);}finally{socket.setTimeout(0);socket.off('timeout',stop);}await gateway.call(req,res,user,input,route.endsWith('/responses')?'responses':'chat');}finally{if(large)largeModelInFlight--;}return;}
   requireThat(route.startsWith('/api/admin/'),404,'not_found','接口不存在');requireThat(user.role==='admin',403,'admin_required','此操作需要管理员权限');
   if(route==='/api/admin/roles'&&req.method==='POST'){const input=await jsonBody(req,8192);send({user:store.setRole(user.id,string(input.id,'用户 ID'),input.role,input.reason)});return;}
   if(route==='/api/admin/users'&&req.method==='GET'){send({users:store.all('SELECT * FROM users ORDER BY created_at DESC LIMIT 1000').map(row=>store.publicUser(row))});return;}
   if(route==='/api/admin/users'&&req.method==='POST'){const input=await jsonBody(req);send({user:store.setUser(user.id,string(input.id,'用户 ID'),input)});if(input.disabled)gateway.abortUser(input.id);return;}
   if(route==='/api/admin/adjust'&&req.method==='POST'){const input=await jsonBody(req);send({user:store.adjust(user.id,string(input.user_id,'用户 ID'),input.amount_micros,input.reason)});return;}
   if(route==='/api/admin/cards'&&req.method==='GET'){send({cards:store.cards()});return;}
   if(route==='/api/admin/cards'&&req.method==='POST'){const input=await jsonBody(req);send({cards:store.createCards(user.id,input.amount_micros,input.count)},201);return;}
   if(route==='/api/admin/cards/export'&&req.method==='POST'){const input=await jsonBody(req);send({cards:store.exportCards(user.id,input.ids)});return;}
   if(route==='/api/admin/cards/revoke'&&req.method==='POST'){const input=await jsonBody(req);store.revokeCard(user.id,string(input.id,'卡 ID'));send({ok:true});return;}
   if(route==='/api/admin/models'&&req.method==='GET'){send({models:store.all('SELECT * FROM models').map(row=>({...row,sale_price:row.sale_price?JSON.parse(row.sale_price):null,fast_sale_price:row.fast_sale_price?JSON.parse(row.fast_sale_price):null}))});return;}
   if(route==='/api/admin/models'&&req.method==='POST'){const input=await jsonBody(req);store.setModel(user.id,string(input.id,'模型标识'),input);send({ok:true});return;}
   if(route==='/api/admin/channels'&&req.method==='GET'){send({channels:store.channels()});return;}
   if(route==='/api/admin/channels'&&req.method==='POST'){const input=await jsonBody(req);send({id:store.setChannel(user.id,input,input.id??randomUUID())});return;}
   if(route==='/api/admin/mappings'&&req.method==='POST'){const input=await jsonBody(req);store.setMapping(user.id,string(input.channel_id,'渠道 ID'),string(input.model_id,'模型 ID'),input);send({ok:true});return;}
   if(route==='/api/admin/discover'&&req.method==='POST'){
    const input=await jsonBody(req),channel=store.get('SELECT * FROM channels WHERE id=?',string(input.id,'渠道 ID'));requireThat(channel,404,'not_found','渠道不存在');
    // Explicit metadata query only. No inference or capability probe is performed here.
    const key=decrypt(store.key,channel.key_ciphertext,'channel:'+channel.id);
    let ids;try{const response=await fetch(channel.base_url+'/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000),redirect:'error'});requireThat(response.ok,502,'discovery_failed','上游模型列表不可读取，请按服务商文档手工确认');const body=await response.text();requireThat(body.length<1048576,502,'discovery_failed','上游模型列表过大');const data=JSON.parse(body);ids=data.data?.map(model=>model.id).filter(id=>typeof id==='string'&&id.length<=200&&!id.includes(key));requireThat(Array.isArray(ids),502,'discovery_failed','上游未提供标准模型列表');}catch{throw new Fault(502,'discovery_failed','模型列表查询失败；未进行推理调用，请核对接口或服务商文档');}
    store.run('UPDATE channels SET discovered_models=? WHERE id=?',JSON.stringify(ids),channel.id);store.audit(user.id,'channel_discovery',channel.id,'主动读取模型列表元数据，未验证推理能力');send({ids,notice:'模型列表仅确认 ID；流式、工具、用量和可选参数仍需服务商文档或另行授权测试确认。'});return;
   }
   if(route==='/api/admin/report'&&req.method==='GET'){send(store.report());return;}
   if(route==='/api/admin/resolve'&&req.method==='POST'){const input=await jsonBody(req);send({request:store.resolve(user.id,string(input.id,'请求 ID'),input)});return;}
   if(route==='/api/admin/reconcile-attempt'&&req.method==='POST'){const input=await jsonBody(req);send({attempt:store.reconcileAttempt(user.id,string(input.id,'采购记录 ID'),input)});return;}
   if(route==='/api/admin/settings'&&req.method==='GET'){send(store.get('SELECT * FROM settings WHERE id=1'));return;}
   if(route==='/api/admin/settings'&&req.method==='POST'){const input=await jsonBody(req);integer(input.daily_cost_limit_micros,'每日采购成本预算',1);store.tx(()=>{store.run('UPDATE settings SET daily_cost_limit_micros=? WHERE id=1',input.daily_cost_limit_micros);store.audit(user.id,'budget_update','1','调整每日成本上限');});send({ok:true});return;}
   if(route==='/api/admin/audit'&&req.method==='GET'){send({audit:store.all('SELECT * FROM audit ORDER BY created_at DESC LIMIT 200')});return;}
   throw new Fault(404,'not_found','接口不存在');
  }catch(error){
   const known=error instanceof Fault,status=known?error.status:500,code=known?error.code:'internal_error',message=known?error.message:'服务暂时异常，请凭请求编号联系管理员';
   // Deliberately omit exception strings, request bodies, headers, secrets, and vendor error bodies.
   logger({event:'api_error',code,status});if(!res.headersSent)send({error:{code,message}},status);else if(!res.writableEnded)res.end();
  }
 });
 server.maxConnections=100;server.maxRequestsPerSocket=50;server.requestTimeout=150000;server.headersTimeout=15000;server.maxHeadersCount=50;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});
 return {server,store,gateway,url:`http://${config.host}:${server.address().port}`,async close(){clearInterval(maintenance);await gateway.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.run('DELETE FROM worker WHERE owner=?',owner);store.close();}};
}
