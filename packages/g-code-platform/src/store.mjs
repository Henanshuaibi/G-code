import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,chmodSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Fault,requireThat,integer,string,secret,digest,encrypt,decrypt,price,upperBound,charge,toCny,usageSchema,upstreamURL} from './primitives.mjs';

export class Store {
 constructor(config){
  this.config=config;this.key=config.key;this.now=config.now??Date.now;
  if(config.db!==':memory:')mkdirSync(path.dirname(config.db),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(config.db);this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(item=>item.endsWith('.sql')).sort())if(!this.get('SELECT version FROM schema_migrations WHERE version=?',file))this.tx(()=>{this.db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));this.run('INSERT INTO schema_migrations VALUES(?,?)',file,this.now());});
  this.run('INSERT OR IGNORE INTO settings VALUES(1,?)',config.dailyCostLimit);
  if(config.db!==':memory:')chmodSync(config.db,0o600);
 }
 get(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 run(sql,...args){return this.db.prepare(sql).run(...args);}
 tx(action){if(this.transactionActive)return action();this.db.exec('BEGIN IMMEDIATE');this.transactionActive=true;try{const value=action();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}finally{this.transactionActive=false;}}
 close(){this.db.close();}
 assertWorker(){if(!this.workerOwner)return;const worker=this.get('SELECT * FROM worker WHERE id=1');requireThat(worker&&worker.owner===this.workerOwner&&worker.expires_at>this.now(),503,'worker_lost','服务进程租约已失效，请稍后核对本次账单');}
 user(id){const user=this.get('SELECT * FROM users WHERE id=?',id);requireThat(user,401,'unauthorized','请先登录');requireThat(!user.disabled,403,'account_disabled','账号已禁用');return user;}
 publicUser(user){return {id:user.id,username:user.username,role:user.role,is_owner:!!user.is_owner,disabled:!!user.disabled,balance_micros:user.balance_micros,available_micros:user.balance_micros-user.reserved_micros,reserved_micros:user.reserved_micros,currency:'CNY',rpm:user.rpm,concurrency:user.concurrency};}
 createUser(username,passwordHash,role='user'){
  const name=string(username,'账号',64).toLowerCase();requireThat(/^[a-z0-9_.@-]{3,64}$/.test(name),400,'invalid_username','账号使用 3～64 个字母、数字或 _.@-');
  return this.tx(()=>{requireThat(!this.get('SELECT id FROM users WHERE username=?',name),409,'username_taken','账号已存在');const id=randomUUID();this.run('INSERT INTO users(id,username,password_hash,role,rpm,concurrency,created_at) VALUES(?,?,?,?,?,?,?)',id,name,passwordHash,role,this.config.userRpm,this.config.userConcurrency,this.now());if(role==='admin'&&!this.get('SELECT id FROM users WHERE is_owner=1'))this.run('UPDATE users SET is_owner=1 WHERE id=?',id);return this.user(id);});
 }
 issueRegistration(ip){
  this.throttle('challenge-global',100);this.throttle('challenge-ip:'+ip,10);const id=secret(),nonce=secret(),expires=this.now()+120000;this.run('DELETE FROM registration_challenges WHERE expires_at<?',this.now());this.run('INSERT INTO registration_challenges VALUES(?,?,?,?,NULL)',id,nonce,digest(this.key,ip),expires);return {id,nonce,difficulty:14,expires_at:expires};
 }
 consumeRegistration(ip,proof){return this.tx(()=>{
  const row=this.get('SELECT * FROM registration_challenges WHERE id=?',typeof proof?.id==='string'?proof.id:'');requireThat(row&&row.expires_at>this.now()&&!row.consumed_at&&row.ip_digest===digest(this.key,ip),400,'registration_challenge','注册校验已过期或已使用，请重新提交');
  integer(proof.counter,'注册校验',0,8000000);const hash=createHash('sha256').update(row.nonce+':'+proof.counter).digest();requireThat(hash[0]===0&&(hash[1]&252)===0,400,'registration_challenge','注册校验无效，请重新提交');this.run('UPDATE registration_challenges SET consumed_at=? WHERE id=?',this.now(),row.id);
 });}
 setRole(actor,id,role,reason){return this.tx(()=>{
  requireThat(this.user(actor).is_owner,403,'owner_required','只有最高管理员可以分配权限');const target=this.get('SELECT * FROM users WHERE id=?',id);requireThat(target,404,'not_found','用户不存在');requireThat(!target.is_owner,403,'owner_protected','最高管理员权限不能通过此接口修改');requireThat(['user','admin'].includes(role),400,'invalid_role','请选择普通用户或管理员');string(reason,'权限调整原因',500);this.run('UPDATE users SET role=? WHERE id=?',role,id);this.run('DELETE FROM sessions WHERE user_id=?',id);this.audit(actor,'role_update',id,reason);return this.publicUser(this.get('SELECT * FROM users WHERE id=?',id));
 });}
 createSession(userId){const token=secret(),csrf=secret();this.run('INSERT INTO sessions VALUES(?,?,?,?)',digest(this.key,token),userId,csrf,this.now()+7*86400_000);return {token,csrf};}
 authenticate(token){requireThat(typeof token==='string'&&token.length<=200,401,'unauthorized','请先登录');const session=this.get('SELECT * FROM sessions WHERE digest=? AND expires_at>?',digest(this.key,token),this.now());requireThat(session,401,'session_expired','登录已过期，请重新登录');return {...session,user:this.user(session.user_id)};}
 throttle(key,limit=20){return this.tx(()=>{const id=digest(this.key,key),row=this.get('SELECT * FROM auth_limits WHERE key=?',id);if(!row||row.window_at<=this.now()-60000){this.run('INSERT INTO auth_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_at=excluded.window_at,count=1',id,this.now());return;}requireThat(row.count<limit,429,'rate_limit','操作过于频繁，请稍后重试');this.run('UPDATE auth_limits SET count=count+1 WHERE key=?',id);});}
 audit(actor,action,target,reason){this.run('INSERT INTO audit VALUES(?,?,?,?,?,?)',randomUUID(),actor,action,target,string(reason,'操作原因',500),this.now());}
 credit(userId,amount,kind,actor,reason,cardId=null){
  integer(amount,'金额',-1_000_000_000_000);const user=this.get('SELECT * FROM users WHERE id=?',userId);requireThat(user,404,'not_found','用户不存在');
  requireThat(user.balance_micros+amount>=user.reserved_micros&&user.balance_micros+amount<=1_000_000_000_000,409,'balance_conflict','调整后余额不足以覆盖预留，或超过余额上限');
  this.run('UPDATE users SET balance_micros=balance_micros+? WHERE id=?',amount,userId);
  this.run('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),userId,kind,amount,user.balance_micros+amount,null,cardId,actor,reason,this.now());
 }
 adjust(actor,userId,amount,reason){return this.tx(()=>{string(reason,'操作原因',500);requireThat(!this.get('SELECT is_owner FROM users WHERE id=?',userId)?.is_owner||this.user(actor).is_owner,403,'owner_protected','只有最高管理员能调整其本人余额');this.credit(userId,integer(amount,'调整金额',-1_000_000_000_000),'adjustment',actor,reason);this.audit(actor,'balance_adjustment',userId,reason);return this.publicUser(this.get('SELECT * FROM users WHERE id=?',userId));});}
 setUser(actor,id,input){return this.tx(()=>{requireThat(this.get('SELECT id FROM users WHERE id=?',id),404,'not_found','用户不存在');requireThat(!this.get('SELECT is_owner FROM users WHERE id=?',id).is_owner||this.user(actor).is_owner,403,'owner_protected','最高管理员账号受保护');requireThat(id!==actor||!input.disabled,400,'invalid_parameter','不能禁用当前管理员');const reason=string(input.reason,'操作原因',500);integer(input.rpm,'每分钟请求限制',1,600);integer(input.concurrency,'用户并发上限',1,20);requireThat(typeof input.disabled==='boolean',400,'invalid_parameter','disabled 必须为布尔值');this.run('UPDATE users SET disabled=?,rpm=?,concurrency=? WHERE id=?',Number(input.disabled),input.rpm,input.concurrency,id);if(input.disabled)this.run('DELETE FROM sessions WHERE user_id=?',id);this.audit(actor,'user_update',id,reason);return this.publicUser(this.get('SELECT * FROM users WHERE id=?',id));});}
 createCards(actor,amount,count){integer(amount,'卡密面额（微 CNY）',1);integer(count,'卡密数量',1,1000);return this.tx(()=>Array.from({length:count},()=>{const code='GC-'+secret(),id=randomUUID(),hint=code.slice(0,6)+'…'+code.slice(-4);this.run('INSERT INTO cards(id,digest,hint,ciphertext,amount_micros,created_by,created_at) VALUES(?,?,?,?,?,?,?)',id,digest(this.key,code),hint,encrypt(this.key,code,'card:'+id),amount,actor,this.now());return {id,code,amount_micros:amount};}));}
 redeem(userId,code){requireThat(typeof code==='string'&&code.length<=100,400,'invalid_card','卡密格式不正确');return this.tx(()=>{this.user(userId);const card=this.get('SELECT * FROM cards WHERE digest=?',digest(this.key,code.trim()));requireThat(card&&!card.revoked_at&&!card.redeemed_by,409,'card_unavailable','卡密不存在、已使用或已作废');this.run('UPDATE cards SET redeemed_by=?,redeemed_at=?,ciphertext=NULL WHERE id=? AND redeemed_by IS NULL AND revoked_at IS NULL',userId,this.now(),card.id);this.credit(userId,card.amount_micros,'card_redeem',userId,'兑换充值卡',card.id);return this.publicUser(this.user(userId));});}
 cards(){return this.all('SELECT id,hint,amount_micros,created_by,created_at,redeemed_by,redeemed_at,revoked_at FROM cards ORDER BY created_at DESC LIMIT 1000');}
 exportCards(actor,ids){requireThat(Array.isArray(ids)&&ids.length>0&&ids.length<=1000,400,'invalid_parameter','请选择 1～1000 张卡');return this.tx(()=>{const cards=ids.map(id=>{const card=this.get('SELECT * FROM cards WHERE id=?',string(id,'卡 ID'));requireThat(card&&!card.redeemed_by&&!card.revoked_at,409,'card_unavailable','只能导出未使用且未作废的卡');return {id:card.id,code:decrypt(this.key,card.ciphertext,'card:'+card.id),amount_micros:card.amount_micros};});this.audit(actor,'cards_export',ids.join(',').slice(0,200),'导出未使用卡密');return cards;});}
 revokeCard(actor,id){return this.tx(()=>{const card=this.get('SELECT * FROM cards WHERE id=?',id);requireThat(card&&!card.redeemed_by,409,'card_unavailable','只能作废未使用卡密');this.run('UPDATE cards SET revoked_at=?,ciphertext=NULL WHERE id=?',this.now(),id);this.audit(actor,'card_revoke',id,'作废未使用卡密');});}
 setModel(actor,id,input){
  requireThat(this.get('SELECT id FROM models WHERE id=?',id),404,'model_not_found','只支持当前两个产品模型');
  requireThat(['chat','responses'].includes(input.protocol)&&typeof input.enabled==='boolean',400,'invalid_parameter','模型协议或启用状态不正确');
  const previous=this.get('SELECT fast_sale_price FROM models WHERE id=?',id),sale=input.sale_price===null?null:price(input.sale_price,true),fast=input.fast_sale_price===undefined?(previous.fast_sale_price?JSON.parse(previous.fast_sale_price):null):input.fast_sale_price===null?null:price(input.fast_sale_price,true);integer(input.input_limit,'最大总输入 token',1024,262144);integer(input.output_limit,'最大总输出 token',1,32768);
  this.tx(()=>{this.run('UPDATE models SET protocol=?,enabled=?,input_limit=?,output_limit=?,sale_price=?,fast_sale_price=?,price_version=price_version+1 WHERE id=?',input.protocol,Number(input.enabled),input.input_limit,input.output_limit,sale?JSON.stringify(sale):null,fast?JSON.stringify(fast):null,id);this.audit(actor,'model_update',id,'修改销售价格或模型限制');});return this.get('SELECT * FROM models WHERE id=?',id);
 }
 setChannel(actor,input,id=randomUUID()){
  const old=this.get('SELECT * FROM channels WHERE id=?',id),name=string(input.name,'渠道名称',80),base=upstreamURL(input.base_url,this.config.allowLoopback);
  requireThat(['chat','responses'].includes(input.protocol)&&typeof input.enabled==='boolean',400,'invalid_parameter','渠道协议或启用状态不正确');
  integer(input.priority,'优先级',0,100000);integer(input.timeout_ms,'渠道超时',100,120000);integer(input.concurrency,'渠道并发上限',1,1000);
  const caps=input.capabilities;requireThat(caps&&typeof caps.stream==='boolean'&&typeof caps.tools==='boolean'&&Array.isArray(caps.params)&&caps.params.every(x=>typeof x==='string')&&Array.isArray(caps.reasoning_efforts)&&caps.reasoning_efforts.every(x=>typeof x==='string'),400,'invalid_capabilities','须明确确认流式、工具和可选参数能力');
  requireThat(caps.output_parameter===undefined||(input.protocol==='chat'?['max_tokens','max_completion_tokens']:['max_output_tokens']).includes(caps.output_parameter),400,'invalid_capabilities','输出上限字段须与已确认的渠道协议对应');
  requireThat(Array.isArray(caps.input)&&caps.input.includes('text')&&caps.input.every(value=>['text','image'].includes(value))&&new Set(caps.input).size===caps.input.length,400,'unsupported_input','只支持文字及已确认的图片输入；PDF、音频及远程托管工具尚未开放');
  requireThat(caps.fast_tier===undefined||caps.fast_tier===''||['priority','fast','ultrafast'].includes(caps.fast_tier),400,'invalid_capabilities','Fast 须选择已确认的上游服务档');
  const schema=usageSchema(input.usage_schema),evidence=string(input.evidence?.trim()||'未填写来源说明','能力与用量口径确认依据',1000);
  const key=input.api_key?string(input.api_key,'API Key',8192):old?decrypt(this.key,old.key_ciphertext,'channel:'+id):null;requireThat(key,400,'missing_key','请在管理界面填写上游 Key');
  const changed=old&&(old.base_url!==base||old.protocol!==input.protocol||input.api_key||old.capabilities!==JSON.stringify(caps)||old.usage_schema!==JSON.stringify(schema));
  this.tx(()=>{this.run(`INSERT INTO channels(id,name,base_url,key_ciphertext,protocol,priority,enabled,timeout_ms,concurrency,capabilities,usage_schema,evidence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,key_ciphertext=excluded.key_ciphertext,protocol=excluded.protocol,priority=excluded.priority,enabled=excluded.enabled,timeout_ms=excluded.timeout_ms,concurrency=excluded.concurrency,capabilities=excluded.capabilities,usage_schema=excluded.usage_schema,evidence=excluded.evidence`,id,name,base,encrypt(this.key,key,'channel:'+id),input.protocol,input.priority,Number(input.enabled),input.timeout_ms,input.concurrency,JSON.stringify(caps),JSON.stringify(schema),evidence);if(changed){this.run('UPDATE mappings SET verified=0 WHERE channel_id=?',id);this.run("UPDATE channels SET discovered_models='[]' WHERE id=?",id);}this.audit(actor,'channel_update',id,'配置上游；敏感内容不进入操作日志');});return id;
 }
 setMapping(actor,channelId,modelId,input){
  requireThat(this.get('SELECT id FROM channels WHERE id=?',channelId)&&this.get('SELECT id FROM models WHERE id=?',modelId),404,'not_found','渠道或模型不存在');
  const actual=string(input.upstream_model,'上游实际 model ID',200),evidence=string(input.evidence?.trim()||'未填写来源说明','model ID 与能力确认依据',1000),cost=input.cost_price===null?null:price(input.cost_price),old=this.get('SELECT fast_cost_price FROM mappings WHERE channel_id=? AND model_id=?',channelId,modelId),fast=input.fast_cost_price===undefined?(old?.fast_cost_price?JSON.parse(old.fast_cost_price):null):input.fast_cost_price===null?null:price(input.fast_cost_price);
  requireThat(typeof input.verified==='boolean'&&typeof input.enabled==='boolean',400,'invalid_parameter','须明确确认映射验证及启用状态');
  this.tx(()=>{this.run(`INSERT INTO mappings(channel_id,model_id,upstream_model,enabled,verified,evidence,cost_price,fast_cost_price) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(channel_id,model_id) DO UPDATE SET upstream_model=excluded.upstream_model,enabled=excluded.enabled,verified=excluded.verified,evidence=excluded.evidence,cost_price=excluded.cost_price,fast_cost_price=excluded.fast_cost_price,version=version+1`,channelId,modelId,actual,Number(input.enabled),Number(input.verified),evidence,cost?JSON.stringify(cost):null,fast?JSON.stringify(fast):null);this.audit(actor,'mapping_update',channelId+':'+modelId,'修改已确认的模型映射或采购价');});
 }
 channels(){return this.all('SELECT id,name,base_url,protocol,priority,enabled,timeout_ms,concurrency,capabilities,usage_schema,evidence,discovered_models,failures,cooldown_until FROM channels ORDER BY priority,id').map(row=>({...row,api_key:'[已加密保存]',capabilities:JSON.parse(row.capabilities),usage_schema:JSON.parse(row.usage_schema),discovered_models:JSON.parse(row.discovered_models),mappings:this.all('SELECT model_id,upstream_model,enabled,verified,evidence,cost_price,fast_cost_price,version FROM mappings WHERE channel_id=?',row.id).map(item=>({...item,cost_price:item.cost_price?JSON.parse(item.cost_price):null,fast_cost_price:item.fast_cost_price?JSON.parse(item.fast_cost_price):null}))}));}
 routes(modelId,protocol){return this.all(`SELECT c.*,m.upstream_model,m.cost_price,m.fast_cost_price,m.version AS cost_version FROM channels c JOIN mappings m ON m.channel_id=c.id WHERE m.model_id=? AND m.enabled=1 AND m.verified=1 AND m.cost_price IS NOT NULL AND c.enabled=1 AND c.protocol=? ORDER BY c.priority,c.id`,modelId,protocol).map(row=>({...row,capabilities:JSON.parse(row.capabilities),usage_schema:JSON.parse(row.usage_schema),cost_price:JSON.parse(row.cost_price),fast_cost_price:row.fast_cost_price?JSON.parse(row.fast_cost_price):null}));}
 catalogue(){return this.all('SELECT * FROM models ORDER BY id DESC').map(model=>{
  const routes=this.routes(model.id,model.protocol).filter(row=>row.capabilities.stream&&row.capabilities.tools),ready=routes.some(row=>row.cooldown_until<=this.now()),fast=model.fast_sale_price?JSON.parse(model.fast_sale_price):null,fastRoutes=routes.filter(row=>row.fast_cost_price&&row.capabilities.fast_tier&&row.capabilities.params.includes('service_tier'));
  const levels=row=>(row.capabilities.params.includes(model.protocol==='chat'?'reasoning_effort':'reasoning')?row.capabilities.reasoning_efforts:[]);
  return {id:model.id,name:model.name,protocol:model.protocol,input_limit:model.input_limit,output_limit:model.output_limit,price_version:model.price_version,sale_price:model.sale_price?JSON.parse(model.sale_price):null,fast_sale_price:fast,fast_available:!!model.enabled&&!!model.sale_price&&!!fast&&fastRoutes.some(row=>row.cooldown_until<=this.now()),enabled:!!model.enabled,available:!!model.enabled&&!!model.sale_price&&ready,state:!model.sale_price?'price_unconfigured':!model.enabled?'disabled':!routes.length?'no_verified_channel':!ready?'cooldown':'available',option_matrix:[{fast:false,efforts:[...new Set(routes.flatMap(levels))]},...(fast&&fastRoutes.length?[{fast:true,efforts:[...new Set(fastRoutes.flatMap(levels))]}]:[])],capabilities:{stream:routes.some(x=>x.capabilities.stream),tools:routes.some(x=>x.capabilities.tools),input:['text',...(routes.some(x=>x.capabilities.input.includes('image'))?['image']:[])],reasoning_efforts:[...new Set(routes.flatMap(levels))]}};});}

 reserve(userId,id,model,outputLimit,fingerprint,protocol,options={}){
  requireThat(typeof id==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(id),400,'invalid_request_id','请求须提供 16～100 字符的唯一 Idempotency-Key');
  return this.tx(()=>{
   this.assertWorker();
   const old=this.get('SELECT * FROM requests WHERE id=?',id);if(old){requireThat(old.user_id===userId&&old.fingerprint===fingerprint,409,'idempotency_conflict','请求标识已使用，不能改变请求内容');throw new Fault(409,'request_already_recorded',`请求已记录（${old.status}），请查看账单；不会重复提交或扣费`);}
   const user=this.user(userId);requireThat(user.reserved_micros>=0,500,'ledger_invariant','余额状态异常');
   requireThat(this.get("SELECT COUNT(*) AS n FROM requests WHERE user_id=? AND status='active'",userId).n<user.concurrency,429,'concurrency_limit','已达到账号并发上限');
   requireThat(this.get('SELECT COUNT(*) AS n FROM requests WHERE user_id=? AND created_at>?',userId,this.now()-60000).n<user.rpm,429,'rate_limit','已达到账号每分钟调用上限');
   const sale=JSON.parse(options.fast?model.fast_sale_price:model.sale_price),reserved=upperBound(sale,model.input_limit,outputLimit);
   requireThat(user.balance_micros-user.reserved_micros>=reserved,402,'insufficient_balance','可用余额不足以预留本次调用上限，请充值或减小输出上限');
   const snapshot={...sale,service_tier:options.fast?'priority':'default',reasoning_effort:options.effort??null,version:model.price_version,input_limit:model.input_limit,output_limit:outputLimit};
   this.run('UPDATE users SET reserved_micros=reserved_micros+? WHERE id=?',reserved,userId);
   this.run('INSERT INTO requests(id,user_id,model_id,fingerprint,protocol,status,reserved_micros,price_snapshot,created_at,deadline_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,userId,model.id,fingerprint,protocol,'active',reserved,JSON.stringify(snapshot),this.now(),this.now()+this.config.routeDeadline+15000);
   return this.get('SELECT * FROM requests WHERE id=?',id);
  });
 }
 reserveAttempt(request,channel){return this.tx(()=>{
  this.assertWorker();requireThat(this.get('SELECT status FROM requests WHERE id=?',request.id)?.status==='active',409,'request_inactive','请求已结束，不得再次发送上游');
  requireThat(this.get("SELECT COUNT(*) AS n FROM attempts WHERE channel_id=? AND status='active'",channel.id).n<channel.concurrency,503,'channel_busy','渠道并发已满');
  const snapshot=JSON.parse(request.price_snapshot),cost={...channel.cost_price,service_tier:snapshot.service_tier==='priority'?channel.capabilities.fast_tier:'default',version:channel.cost_version},bound=toCny(upperBound(cost,snapshot.input_limit,snapshot.output_limit),cost),day=new Date(this.now()).toISOString().slice(0,10);
  integer(bound,'单次采购预算',0,10_000_000_000_000);this.run('INSERT OR IGNORE INTO cost_days(day) VALUES(?)',day);
  const budget=this.get('SELECT * FROM cost_days WHERE day=?',day),limit=this.get('SELECT daily_cost_limit_micros FROM settings WHERE id=1').daily_cost_limit_micros;
  requireThat(budget.spent_micros+budget.reserved_micros+bound<=limit,503,'daily_cost_limit','平台当日成本预算已用完，未发起上游请求');
  const id=randomUUID();this.run('UPDATE cost_days SET reserved_micros=reserved_micros+? WHERE day=?',bound,day);
  this.run('INSERT INTO attempts(id,request_id,channel_id,model_id,cost_snapshot,usage_schema,budget_day,reserved_cny_micros,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,request.id,channel.id,request.model_id,JSON.stringify(cost),JSON.stringify(channel.usage_schema),day,bound,this.now());return this.get('SELECT * FROM attempts WHERE id=?',id);
 });}
 emitted(id,channelId){this.assertWorker();requireThat(this.run("UPDATE requests SET emitted=1,channel_id=? WHERE id=? AND status='active'",channelId,id).changes===1,409,'request_inactive','请求已结束，不能重新输出');}
 finishAttempt(id,usage,code,definitelyUnused=false){return this.tx(()=>{this.assertWorker();
  const attempt=this.get('SELECT * FROM attempts WHERE id=?',id);if(attempt.status!=='active')return attempt;
  const rates=JSON.parse(attempt.cost_snapshot),request=this.get('SELECT * FROM requests WHERE id=?',attempt.request_id),limits=JSON.parse(request.price_snapshot);
  const valid=usage&&usage.input+usage.cache_read+usage.cache_write<=limits.input_limit&&usage.output<=limits.output_limit;
  const raw=valid?charge(rates,usage):definitelyUnused?0:upperBound(rates,limits.input_limit,limits.output_limit),cost=toCny(raw,rates);
  this.run('UPDATE cost_days SET reserved_micros=reserved_micros-?,spent_micros=spent_micros+? WHERE day=?',attempt.reserved_cny_micros,cost,attempt.budget_day);
  this.run("UPDATE attempts SET status='finished',cost_micros=?,cost_cny_micros=?,cost_kind=?,usage=?,code=?,finished_at=? WHERE id=?",raw,cost,valid?'actual':definitelyUnused?'not_sent':'upper_bound',valid?JSON.stringify(usage):null,code,this.now(),id);
  return this.get('SELECT * FROM attempts WHERE id=?',id);
 });}
 finish(id,usage,code,channelId=null){return this.tx(()=>{this.assertWorker();
  const request=this.get('SELECT * FROM requests WHERE id=?',id);requireThat(request,404,'not_found','请求不存在');if(request.status!=='active'&&request.status!=='needs_review')return request;
  const sale=JSON.parse(request.price_snapshot),valid=usage&&usage.input+usage.cache_read+usage.cache_write<=sale.input_limit&&usage.output<=sale.output_limit;
  const amount=valid?charge(sale,usage):0;
  if((!valid&&request.emitted&&code!=='admin_refund')||amount>request.reserved_micros){this.run("UPDATE requests SET status='needs_review',code=?,finished_at=?,channel_id=COALESCE(?,channel_id) WHERE id=?",usage?'usage_out_of_bounds':code,this.now(),channelId,id);return this.get('SELECT * FROM requests WHERE id=?',id);}
  const user=this.get('SELECT * FROM users WHERE id=?',request.user_id);
  this.run('UPDATE users SET balance_micros=balance_micros-?,reserved_micros=reserved_micros-? WHERE id=?',amount,request.reserved_micros,request.user_id);
  this.run("UPDATE requests SET status=?,charged_micros=?,usage=?,code=?,finished_at=?,channel_id=COALESCE(?,channel_id) WHERE id=?",valid?'settled':'failed',amount,valid?JSON.stringify(usage):null,code,this.now(),channelId,id);
  this.run('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),request.user_id,'usage',-amount,user.balance_micros-amount,id,null,null,valid?'模型实际用量结算':'无有效输出，释放预留',this.now());return this.get('SELECT * FROM requests WHERE id=?',id);
 });}
 resolve(actor,id,input){return this.tx(()=>{
  const request=this.get('SELECT * FROM requests WHERE id=?',id);requireThat(request,404,'not_found','请求不存在');if(request.status==='settled'||request.status==='failed')return request;requireThat(request.status==='needs_review',409,'request_active','正在运行的请求不能人工结算');
  const reason=string(input.reason,'核对依据或退款原因',500);
  if(input.action==='refund'){const row=this.finish(id,null,'admin_refund');this.audit(actor,'request_refund',id,reason);return row;}
  requireThat(input.action==='usage',400,'invalid_parameter','请选择 usage 或 refund');const usage={};for(const key of ['input','output','cache_read','cache_write'])usage[key]=integer(input.usage?.[key],key,0,100_000_000);
  const sale=JSON.parse(request.price_snapshot);requireThat(usage.input+usage.cache_read+usage.cache_write<=sale.input_limit&&usage.output<=sale.output_limit&&charge(sale,usage)<=request.reserved_micros,400,'usage_out_of_bounds','核对用量超过已预留上限，不能向用户追加扣款');
  const row=this.finish(id,usage,'admin_verified_usage');this.audit(actor,'request_usage',id,reason);return row;
 });}
 reconcileAttempt(actor,id,input){return this.tx(()=>{
  const attempt=this.get('SELECT * FROM attempts WHERE id=?',id);requireThat(attempt&&attempt.status==='finished',409,'attempt_unavailable','只能核对已结束的采购记录');const reason=string(input.reason,'供应商用量凭据或未扣款依据',500);
  const usage={};for(const key of ['input','output','cache_read','cache_write'])usage[key]=integer(input.usage?.[key],key,0,100_000_000);
  const rates=JSON.parse(attempt.cost_snapshot),raw=charge(rates,usage),cny=toCny(raw,rates);
  this.run('UPDATE cost_days SET spent_micros=spent_micros+? WHERE day=?',cny-attempt.cost_cny_micros,attempt.budget_day);
  this.run("UPDATE attempts SET cost_micros=?,cost_cny_micros=?,cost_kind='actual',usage=? WHERE id=?",raw,cny,JSON.stringify(usage),id);this.audit(actor,'attempt_usage',id,reason);return this.get('SELECT * FROM attempts WHERE id=?',id);
 });}
 channelResult(id,success){if(success)this.run('UPDATE channels SET failures=0,cooldown_until=0 WHERE id=?',id);else this.run('UPDATE channels SET failures=failures+1,cooldown_until=CASE WHEN failures+1>=3 THEN ? ELSE cooldown_until END WHERE id=?',this.now()+30000,id);}
 recover(force=false){
  const requests=this.all("SELECT * FROM requests WHERE status='active' AND (? OR deadline_at<?)",Number(force),this.now());
  for(const request of requests){for(const attempt of this.all("SELECT id FROM attempts WHERE request_id=? AND status='active'",request.id))this.finishAttempt(attempt.id,null,'process_interrupted');this.finish(request.id,null,'process_interrupted');}
  return requests.length;
 }
 lock(owner){this.tx(()=>{const worker=this.get('SELECT * FROM worker WHERE id=1');requireThat(!worker||worker.owner===owner||worker.expires_at<this.now(),503,'worker_locked','此 SQLite 数据库已有活跃服务进程；请使用单进程，或等待 30 秒租约过期');this.run('INSERT INTO worker VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at',owner,this.now()+30000);});}
 history(userId,offset=0){
  integer(offset,'账单分页偏移',0,1000000);
  const ledger=this.all('SELECT * FROM ledger WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 200 OFFSET ?',userId,offset),requests=this.all('SELECT id,model_id,status,reserved_micros,charged_micros,price_snapshot,usage,emitted,code,created_at,finished_at FROM requests WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 200 OFFSET ?',userId,offset);
  return {user:this.publicUser(this.user(userId)),ledger,requests,offset,next_offset:ledger.length===200||requests.length===200?offset+200:null};
 }
 report(){
  const requests=this.all('SELECT id,user_id,model_id,channel_id,status,charged_micros,usage FROM requests'),requestById=new Map(requests.map(item=>[item.id,item])),attempts=this.all('SELECT request_id,channel_id,model_id,cost_cny_micros,cost_kind,reserved_cny_micros,status,usage FROM attempts');
  const group=key=>{const rows=new Map();const get=id=>{if(!rows.has(id))rows.set(id,{id,requests:0,charged_micros:0,cost_cny_micros:0,actual_cost_cny_micros:0,unknown_cost_upper_bound_micros:0,active_reserved_cost_micros:0,upper_bound_attempts:0,billed_usage:{input:0,output:0,cache_read:0,cache_write:0},input:0,output:0,cache_read:0,cache_write:0});return rows.get(id);};for(const request of requests){const row=get(key==='user'?request.user_id:key==='model'?request.model_id:request.channel_id??'unassigned');row.requests++;row.charged_micros+=request.charged_micros;if(request.usage){const usage=JSON.parse(request.usage);for(const field of ['input','output','cache_read','cache_write'])row.billed_usage[field]+=usage[field];}}for(const attempt of attempts){const request=requestById.get(attempt.request_id);const row=get(key==='user'?request.user_id:key==='model'?attempt.model_id:attempt.channel_id);row.cost_cny_micros+=attempt.cost_cny_micros;if(attempt.cost_kind==='actual')row.actual_cost_cny_micros+=attempt.cost_cny_micros;if(attempt.cost_kind==='upper_bound')row.unknown_cost_upper_bound_micros+=attempt.cost_cny_micros;if(attempt.status==='active')row.active_reserved_cost_micros+=attempt.reserved_cny_micros;row.upper_bound_attempts+=Number(attempt.cost_kind==='upper_bound');if(attempt.usage){const usage=JSON.parse(attempt.usage);for(const field of ['input','output','cache_read','cache_write'])row[field]+=usage[field];}}return [...rows.values()].map(row=>({...row,estimated_gross_margin_micros:row.charged_micros-row.cost_cny_micros}));};
  return {currency:'CNY',by_user:group('user'),by_model:group('model'),by_channel:group('channel'),days:this.all('SELECT * FROM cost_days ORDER BY day DESC LIMIT 60'),pending:this.all("SELECT * FROM requests WHERE status='needs_review' ORDER BY created_at"),attempts:this.all('SELECT * FROM attempts ORDER BY created_at DESC LIMIT 200')};
 }
}
