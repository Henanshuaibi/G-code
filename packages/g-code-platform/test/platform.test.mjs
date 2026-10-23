import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,upstream,reply,rates,schema,usage,body,requestId,caps} from './helpers.mjs';
import {Store} from '../src/store.mjs';
import {charge,readUsage} from '../src/primitives.mjs';

test('account login, cookie CSRF, independent admin permission, disabled users and bill isolation',async t=>{
 const f=await fixture(t);
 const register=await f.request('/api/register',{username:'new-user',password:'new-password-fixture',accepted_terms:true},null,{'X-GCode-Client':'android'});assert.equal(register.response.status,200);assert(register.data.token);
 const token=register.data.token;assert.equal((await f.request('/api/admin/users',undefined,token)).response.status,403);
 const login=await f.request('/api/login',{username:'new-user',password:'new-password-fixture'},null);assert.equal(login.response.status,200);assert.equal(login.data.token,undefined);const cookie=login.response.headers.get('set-cookie').split(';')[0];assert.match(login.response.headers.get('set-cookie'),/HttpOnly/);
 const noCsrf=await fetch(f.url+'/api/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(noCsrf.status,403);
 const csrf=await fetch(f.url+'/api/logout',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':login.data.csrf,'Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,200);
 assert.equal((await f.request('/api/me',undefined,token)).response.status,200,'logout only deletes its own session');
 const own=await f.request('/api/history?user_id='+f.user.id,undefined,token);assert.deepEqual(own.data.ledger,[]);
 assert.equal((await f.request('/api/login',{username:'new-user',password:'wrong-password'},null)).response.status,401);
 const disabled=await f.request('/api/admin/users',{id:register.data.user.id,disabled:true,rpm:5,concurrency:1,reason:'test restriction'});assert.equal(disabled.response.status,200);
 assert.equal((await f.request('/api/me',undefined,token)).response.status,401);assert.equal((await f.request('/api/login',{username:'new-user',password:'new-password-fixture'},null)).response.status,403);
});

test('random cards: concurrent redemption succeeds once, export/revoke rules, encrypted persistence, adjustments audit',async t=>{
 const f=await fixture(t);const cards=(await f.request('/api/admin/cards',{amount_micros:1_000_000,count:3})).data.cards;
 assert.equal(new Set(cards.map(x=>x.code)).size,3);assert(cards.every(card=>card.code.length>=45));
 const old=f.store.user(f.user.id).balance_micros;
 const redeemed=await Promise.all(Array.from({length:8},()=>f.request('/api/redeem',{code:cards[0].code},f.token)));
 assert.equal(redeemed.filter(x=>x.response.ok).length,1);assert.equal(f.store.user(f.user.id).balance_micros,old+1_000_000);
 const listed=(await f.request('/api/admin/cards')).data;assert(!JSON.stringify(listed).includes(cards[1].code));
 assert.equal((await f.request('/api/admin/cards/export',{ids:[cards[1].id]})).data.cards[0].code,cards[1].code);
 assert.equal((await f.request('/api/admin/cards/export',{ids:[cards[0].id]})).response.status,409);
 await f.request('/api/admin/cards/revoke',{id:cards[1].id});assert.equal((await f.request('/api/redeem',{code:cards[1].code},f.token)).response.status,409);
 assert.equal((await f.request('/api/admin/adjust',{user_id:f.user.id,amount_micros:-1,reason:''})).response.status,400);
 const audit=f.store.all('SELECT * FROM audit');assert(audit.some(x=>x.actor_id===f.admin.id));
 for(const suffix of ['', '-wal']){const bytes=await readFile(f.config.db+suffix).catch(()=>Buffer.alloc(0));for(const card of cards)assert(!bytes.includes(Buffer.from(card.code)));}
 assert(!JSON.stringify(f.logs).includes(cards[0].code));
});

test('SQLite reservation concurrency across connections, actual settlement and idempotency, snapshot pricing',async t=>{
 const f=await fixture(t);f.configure();const model=f.store.get('SELECT * FROM models WHERE id=?','gcode-sol'),reserved=32768*3+100*8;
 const user=f.store.createUser('small-balance',f.user.password_hash);f.store.adjust(f.admin.id,user.id,reserved,'one reservation only');
 const second=new Store(f.config);t.after(()=>second.close());
 const first=f.store.reserve(user.id,requestId(),model,100,'fingerprint','chat');assert.equal(f.store.user(user.id).reserved_micros,reserved);
 assert.throws(()=>second.reserve(user.id,requestId(),model,100,'different','chat'),error=>error.code==='insufficient_balance');
 const parsed=readUsage(usage,schema);assert.deepEqual(parsed,{input:80,output:10,cache_read:20,cache_write:0});
 const result=f.store.finish(first.id,parsed,'complete');assert.equal(result.charged_micros,250);assert.equal(charge(rates,parsed),250);
 f.store.finish(first.id,parsed,'duplicate');assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ledger WHERE request_id=?',first.id).n,1);assert.equal(f.store.user(user.id).reserved_micros,0);
 const original=JSON.parse(result.price_snapshot);f.store.setModel(f.admin.id,'gcode-sol',{protocol:'chat',enabled:true,input_limit:32768,output_limit:100,sale_price:{...rates,input:10000000}});assert.deepEqual(JSON.parse(f.store.get('SELECT price_snapshot FROM requests WHERE id=?',first.id).price_snapshot),original);
 assert.throws(()=>f.store.reserve(user.id,first.id,model,100,'fingerprint','chat'),error=>error.code==='request_already_recorded');assert.throws(()=>f.store.reserve(user.id,first.id,model,100,'changed','chat'),error=>error.code==='idempotency_conflict');
 assert.throws(()=>f.store.adjust(f.admin.id,user.id,-1000000000000,'cannot overdraw'),error=>error.code==='balance_conflict');
});

test('priority failover only within one model, HTTP parameter errors do not retry, cooldown and recovery',async t=>{
 let now=Date.now();const f=await fixture(t,{now:()=>now});f.configure();
 const main=await upstream(t,(_req,res)=>{res.writeHead(503);res.end('private-error-key-must-not-leak');}),backup=await upstream(t,(_req,res,input)=>reply(res,{stream:input.stream})),flash=await upstream(t,(_req,res)=>reply(res));
 const a=await f.channel(main,{priority:1}),b=await f.channel(backup,{priority:2});await f.channel(flash,{model:'gcode-flash',priority:0});
 for(let i=0;i<3;i++){const result=await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()});assert.equal(result.response.status,200);assert.equal(result.data.choices[0].message.content,'fixture answer');}
 assert.equal(main.calls.length,3);assert.equal(backup.calls.length,3);assert.equal(flash.calls.length,0);assert.equal(backup.calls[0].body.model,backup.model);assert(f.store.get('SELECT cooldown_until FROM channels WHERE id=?',a.id).cooldown_until>now);
 await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()});assert.equal(main.calls.length,3);now+=31000;f.store.lock(f.store.workerOwner);
 await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()});assert.equal(main.calls.length,4);
 assert(f.store.report().attempts.some(x=>x.channel_id===a.id&&x.cost_kind==='upper_bound'));assert(f.store.report().by_user.find(x=>x.id===f.user.id).charged_micros<2000);
 f.store.run('UPDATE channels SET enabled=0 WHERE id=?',a.id);f.store.run('UPDATE channels SET enabled=0 WHERE id=?',b.id);
 const failed=await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()});assert.equal(failed.response.status,503);assert.equal(flash.calls.length,0);assert.equal(f.store.user(f.user.id).reserved_micros,0);
 const bad=await upstream(t,(_req,res)=>{res.writeHead(422);res.end('bad parameters');});await f.channel(bad,{priority:0});f.store.run('UPDATE channels SET enabled=1 WHERE id=?',b.id);
 const calls=backup.calls.length;const rejected=await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()});assert.equal(rejected.response.status,400);assert.equal(backup.calls.length,calls);assert.equal(f.store.user(f.user.id).reserved_micros,0);
});

test('SSE tool calls/parameters pass through, actual usage settles once, no credential or prompt storage',async t=>{
 const f=await fixture(t);f.configure();const mock=await upstream(t,(_req,res,input)=>reply(res,{stream:true,tool:true,crlf:true}));const c=await f.channel(mock);const id=requestId();
 const input=body('gcode-sol',{stream:true,temperature:0.5,reasoning_effort:'low',tools:[{type:'function',function:{name:'fixture_tool',description:'test',parameters:{type:'object'}}}],tool_choice:'auto'});
 const result=await f.request('/v1/chat/completions',input,f.token,{'Idempotency-Key':id});assert.equal(result.response.status,200);assert.match(result.text,/tool_calls/);assert.match(result.text,/fixture_tool/);assert.match(result.text,/\[DONE\]/);assert.equal(mock.calls[0].body.reasoning_effort,'low');assert.equal(mock.calls[0].body.temperature,0.5);assert.deepEqual(mock.calls[0].body.tools,input.tools);assert.equal(mock.calls[0].body.stream_options.include_usage,true);assert.equal(mock.calls[0].headers.authorization,'Bearer '+c.key);
 assert.equal(f.store.get('SELECT charged_micros FROM requests WHERE id=?',id).charged_micros,250);assert.equal(f.store.user(f.user.id).reserved_micros,0);
 const duplicate=await f.request('/v1/chat/completions',input,f.token,{'Idempotency-Key':id});assert.equal(duplicate.response.status,409);assert.equal(mock.calls.length,1);
 assert(!result.text.includes(c.key));assert(!JSON.stringify((await f.request('/api/catalog')).data).includes(c.key));assert(!JSON.stringify((await f.request('/api/admin/channels')).data).includes(c.key));assert(!JSON.stringify(f.logs).includes(c.key));
 for(const suffix of ['', '-wal']){const bytes=await readFile(f.config.db+suffix).catch(()=>Buffer.alloc(0));assert(!bytes.includes(Buffer.from(c.key)));assert(!bytes.includes(Buffer.from('private-prompt-fixture-do-not-store')));assert(!bytes.includes(Buffer.from('fixture stream answer')));}
 const exposed=await f.request('/api/admin/channels',undefined,f.token);assert.equal(exposed.response.status,403);
});

test('partial stream never reroutes, unknown usage held for review, restart recovery and manual refund are idempotent',async t=>{
 const f=await fixture(t);f.configure();const partial=await upstream(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{id:'call1',type:'function',function:{name:'fixture_tool',arguments:'{'}}]}}]})+'\n\n');}),backup=await upstream(t,(_req,res)=>reply(res,{stream:true}));await f.channel(partial,{priority:0});await f.channel(backup,{priority:2});
 const id=requestId(),result=await f.request('/v1/chat/completions',body('gcode-sol',{stream:true}),f.token,{'Idempotency-Key':id});assert.match(result.text,/不会自动重跑/);assert.equal(backup.calls.length,0);assert.equal(f.store.get('SELECT status FROM requests WHERE id=?',id).status,'needs_review');assert(f.store.user(f.user.id).reserved_micros>0);
 const refund=await f.request('/api/admin/resolve',{id,action:'refund',reason:'fixture provider confirms no bill'});assert.equal(refund.data.request.status,'failed');await f.request('/api/admin/resolve',{id,action:'refund',reason:'duplicate refund'});assert.equal(f.store.user(f.user.id).reserved_micros,0);assert.equal(f.store.get('SELECT COUNT(*) AS n FROM ledger WHERE request_id=?',id).n,1);
 const model=f.store.get('SELECT * FROM models WHERE id=?','gcode-sol'),orphan=f.store.reserve(f.user.id,requestId(),model,100,'orphan','chat'),channel=f.store.routes('gcode-sol','chat')[0];f.store.reserveAttempt(orphan,channel);assert.equal(f.store.recover(true),1);assert.equal(f.store.user(f.user.id).reserved_micros,0);assert.equal(f.store.get('SELECT status FROM requests WHERE id=?',orphan.id).status,'failed');assert.equal(f.store.get("SELECT COUNT(*) AS n FROM attempts WHERE status='active'").n,0);
 const emitted=f.store.reserve(f.user.id,requestId(),model,100,'orphan-emitted','chat');f.store.emitted(emitted.id,channel.id);f.store.recover(true);assert.equal(f.store.get('SELECT status FROM requests WHERE id=?',emitted.id).status,'needs_review');assert(f.store.user(f.user.id).reserved_micros>0);const verified=await f.request('/api/admin/resolve',{id:emitted.id,action:'usage',usage:{input:80,output:10,cache_read:20,cache_write:0},reason:'verified supplier usage'});assert.equal(verified.data.request.charged_micros,250);assert.equal(f.store.user(f.user.id).reserved_micros,0);
});

test('capability gates, unconfigured prices, output limits, global cost cap and self-use cost accounting',async t=>{
 const f=await fixture(t),mock=await upstream(t,(_req,res)=>reply(res));await f.channel(mock,{capabilities:{...caps,reasoning_efforts:[],params:[]}});
 const unset=await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()});assert.equal(unset.response.status,503);assert.equal(mock.calls.length,0);f.configure();
 const effort=await f.request('/v1/chat/completions',body('gcode-sol',{reasoning_effort:'high'}),f.token,{'Idempotency-Key':requestId()});assert.equal(effort.response.status,503);assert.equal(mock.calls.length,0);
 assert.equal((await f.request('/v1/chat/completions',body('gcode-sol',{max_tokens:99999}),f.token,{'Idempotency-Key':requestId()})).response.status,400);
 assert.equal((await f.request('/v1/chat/completions',body('gcode-sol',{base_url:'http://attacker.invalid'}),f.token,{'Idempotency-Key':requestId()})).response.status,400);
 await f.request('/api/admin/settings',{daily_cost_limit_micros:1});const capped=await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()});assert.match(capped.text,/预算/);assert.equal(mock.calls.length,0);assert.equal(f.store.user(f.user.id).reserved_micros,0);
 await f.request('/api/admin/settings',{daily_cost_limit_micros:100000000});const own=await f.request('/v1/chat/completions',body(),f.adminSession.token,{'Idempotency-Key':requestId()});assert.equal(own.response.status,200);const report=(await f.request('/api/admin/report')).data;assert(report.by_user.find(row=>row.id===f.admin.id).cost_cny_micros>0);assert(report.by_user.find(row=>row.id===f.admin.id).charged_micros>0);
});

test('Responses uses only Responses channels and preserves function-call streaming and final usage',async t=>{
 const f=await fixture(t);f.configure('gcode-sol','responses');const rschema={input:'input_tokens',output:'output_tokens',cache_read:'input_tokens_details.cached_tokens',cache_write:null,input_includes_cache:true,output_includes_reasoning:true};
 const mock=await upstream(t,(_req,res,input)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});for(const item of [{type:'response.created',response:{id:'resp_fixture'}},{type:'response.output_item.added',output_index:0,item:{type:'function_call',id:'fc1',call_id:'call1',name:'fixture_tool',arguments:''}},{type:'response.function_call_arguments.delta',item_id:'fc1',output_index:0,delta:'{"value":1}'},{type:'response.completed',response:{id:'resp_fixture',status:'completed',output:[],usage:{input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:20}}}}])res.write('event: '+item.type+'\ndata: '+JSON.stringify(item)+'\n\n');res.end();});await f.channel(mock,{protocol:'responses',usage_schema:rschema});
 const id=requestId(),input={model:'gcode-sol',input:[{role:'user',content:[{type:'input_text',text:'fixture question'}]}],stream:true,max_output_tokens:100,tools:[{type:'function',name:'fixture_tool',parameters:{type:'object'}}]};const result=await f.request('/v1/responses',input,f.token,{'Idempotency-Key':id});assert.equal(result.response.status,200);assert.match(result.text,/response.function_call_arguments.delta/);assert.match(result.text,/response.completed/);assert.equal(mock.calls[0].path,'/v1/responses');assert.equal(mock.calls[0].body.model,mock.model);assert.equal(f.store.get('SELECT charged_micros FROM requests WHERE id=?',id).charged_micros,250);
 assert.equal((await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()})).response.status,400);
});

test('concurrent HTTP reservations cannot spend the same balance; cancellation aborts upstream and releases unused hold',async t=>{
 const f=await fixture(t);f.configure();let entered;const arrived=new Promise(resolve=>entered=resolve);let finish;const release=new Promise(resolve=>finish=resolve);let closed;const cancelled=new Promise(resolve=>closed=resolve);
 const mock=await upstream(t,async(_req,res)=>{entered();res.once('close',closed);res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();await release;if(!res.destroyed)reply(res,{stream:true});});await f.channel(mock);
 const user=f.store.createUser('concurrent-user',f.user.password_hash);f.store.adjust(f.admin.id,user.id,32768*3+100*8,'exactly one call budget');const token=f.store.createSession(user.id).token;
 const controller=new AbortController(),id=requestId();const first=fetch(f.url+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(body('gcode-sol',{stream:true})),signal:controller.signal});const handled=assert.rejects(first);
 await arrived;const others=await Promise.all(Array.from({length:6},()=>f.request('/v1/chat/completions',body(),token,{'Idempotency-Key':requestId()})));assert(others.every(item=>item.response.status===402));assert.equal(mock.calls.length,1);
 controller.abort();await handled;await cancelled;finish();
 // Provider closure is acknowledged only after gateway settlement; this deterministic endpoint observes the serialized store.
 for(let count=0;count<100;count++){if(f.store.get('SELECT status FROM requests WHERE id=?',id).status!=='active')break;await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(f.store.user(user.id).reserved_micros,0);assert.equal(f.store.user(user.id).balance_micros,32768*3+100*8);assert.equal(f.store.get('SELECT status FROM requests WHERE id=?',id).status,'failed');
});

test('pre-content role stream may fail over; all failures and deadlines release hold; nonstream missing usage never invents tokens',async t=>{
 const f=await fixture(t);f.configure();const early=await upstream(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{role:'assistant'}}]})+'\n\n');}),backup=await upstream(t,(_req,res)=>reply(res,{stream:true}));const main=await f.channel(early,{priority:0}),second=await f.channel(backup,{priority:1});
 const first=await f.request('/v1/chat/completions',body('gcode-sol',{stream:true}),f.token,{'Idempotency-Key':requestId()});assert.equal(first.response.status,200);assert.match(first.text,/fixture stream answer/);assert.equal(backup.calls.length,1);assert.equal(f.store.user(f.user.id).reserved_micros,0);
 f.store.run('UPDATE channels SET enabled=0 WHERE id=?',second.id);const result=await f.request('/v1/chat/completions',body('gcode-sol',{stream:true}),f.token,{'Idempotency-Key':requestId()});assert.equal(result.response.status,503);assert.equal(f.store.user(f.user.id).reserved_micros,0);
 f.store.run('UPDATE channels SET enabled=0 WHERE id=?',main.id);const missing=await upstream(t,(_req,res)=>reply(res,{missingUsage:true}));await f.channel(missing);const id=requestId(),noUsage=await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':id});assert.equal(noUsage.response.status,502);assert.equal(f.store.get('SELECT charged_micros FROM requests WHERE id=?',id).charged_micros,0);assert.equal(f.store.get('SELECT usage FROM requests WHERE id=?',id).usage,null);assert.equal(f.store.user(f.user.id).reserved_micros,0);
});

test('exclusive cache accounting, integer rounding, foreign procurement FX snapshots, actual procurement reconciliation',async t=>{
 const f=await fixture(t);f.configure();const exclusive=readUsage({in:80,out:10,read:20,write:5},{input:'in',output:'out',cache_read:'read',cache_write:'write',input_includes_cache:false});assert.deepEqual(exclusive,{input:80,output:10,cache_read:20,cache_write:5});assert.equal(charge({...rates,input:1,output:1,cache_read:1,cache_write:1},exclusive),1);
 const mock=await upstream(t,(_req,res)=>{res.writeHead(500);res.end();});const c=await f.channel(mock);f.store.setMapping(f.admin.id,c.id,'gcode-sol',{upstream_model:mock.model,enabled:true,verified:true,evidence:'fixture actual ID',cost_price:{...rates,currency:'USD',fx_cny_micros:7000000}});
 await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()});const attempt=f.store.get('SELECT * FROM attempts');assert.equal(JSON.parse(attempt.cost_snapshot).currency,'USD');assert.equal(attempt.cost_cny_micros,attempt.cost_micros*7);assert.equal(attempt.cost_kind,'upper_bound');
 const reconciled=await f.request('/api/admin/reconcile-attempt',{id:attempt.id,usage:{input:100,output:10,cache_read:0,cache_write:0},reason:'mock supplier billing export confirms usage'});assert.equal(reconciled.data.attempt.cost_cny_micros,280*7);const day=f.store.get('SELECT * FROM cost_days');assert.equal(day.spent_micros,280*7);await f.request('/api/admin/reconcile-attempt',{id:attempt.id,usage:{input:100,output:10,cache_read:0,cache_write:0},reason:'duplicate evidence'});assert.equal(f.store.get('SELECT * FROM cost_days').spent_micros,280*7);
});

test('bounded upstream timeout releases reservations and daily cost reserve',async t=>{
 const f=await fixture(t,{routeDeadline:150});f.configure();const silent=await upstream(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();});await f.channel(silent,{timeout_ms:100});
 const id=requestId(),result=await f.request('/v1/chat/completions',body('gcode-sol',{stream:true}),f.token,{'Idempotency-Key':id});assert.equal(result.response.status,503);assert.equal(f.store.user(f.user.id).reserved_micros,0);assert.equal(f.store.get('SELECT reserved_micros FROM cost_days').reserved_micros,0);assert.equal(f.store.get('SELECT status FROM requests WHERE id=?',id).status,'failed');assert.equal(silent.calls.length,1);
});

test('prices freeze before settlement; missing/invalid usage, verification and worker ownership never fake success',async t=>{
 const f=await fixture(t);f.configure();const original=f.store.get('SELECT * FROM models WHERE id=?','gcode-sol'),id=requestId();f.store.reserve(f.user.id,id,original,100,'snapshot-in-flight','chat');f.store.setModel(f.admin.id,'gcode-sol',{protocol:'chat',enabled:true,input_limit:32768,output_limit:4096,sale_price:{...rates,input:99000000}});assert.equal(f.store.finish(id,{input:80,output:10,cache_read:20,cache_write:0},'completed').charged_micros,250);
 const mock=await upstream(t,(_req,res)=>reply(res));const c=await f.channel(mock);f.store.setMapping(f.admin.id,c.id,'gcode-sol',{upstream_model:mock.model,enabled:true,verified:false,evidence:'not verified yet',cost_price:rates});assert.equal((await f.request('/api/catalog')).data.models.find(item=>item.id==='gcode-sol').available,false);assert.equal((await f.request('/v1/chat/completions',body(),f.token,{'Idempotency-Key':requestId()})).response.status,503);assert.equal(mock.calls.length,0);
 assert.equal(readUsage({prompt_tokens:10,completion_tokens:1,prompt_tokens_details:{cached_tokens:20}},schema),null);assert.equal(readUsage({prompt_tokens:100},schema),null);assert.throws(()=>f.store.lock('another-worker'),error=>error.code==='worker_locked');
});

test('verified output-parameter mapping and upstream secret redaction, including JSON escaped secrets',async t=>{
 const f=await fixture(t);f.configure();const key='synthetic-key-with-"-escaped-character';
 const mock=await upstream(t,(_req,res,input)=>reply(res,{secret:key,stream:input.stream}));await f.channel(mock,{key,capabilities:{...caps,output_parameter:'max_completion_tokens'}});
 for(const stream of [false,true]){const response=await f.request('/v1/chat/completions',body('gcode-sol',{stream}),f.token,{'Idempotency-Key':requestId()});assert.equal(response.response.status,200);assert(!response.text.includes('escaped-character'));assert.match(response.text,/redacted/);assert.equal(mock.calls.at(-1).body.max_tokens,undefined);assert.equal(mock.calls.at(-1).body.max_completion_tokens,100);}
 const code=requestId();assert.equal((await f.request('/v1/chat/completions',{},f.token,{'Idempotency-Key':code})).response.status,400);assert.equal((await f.request('/v1/chat/completions',body('gcode-sol',{temperature:'invalid'}),f.token,{'Idempotency-Key':code})).response.status,400);
});

test('lease takeover fences old worker; persistent startup recovery releases unused reservations',async t=>{
 const f=await fixture(t);f.configure();const request=f.store.reserve(f.user.id,requestId(),f.store.get('SELECT * FROM models WHERE id=?','gcode-sol'),100,'crash-recovery','chat');
 f.store.run('UPDATE worker SET expires_at=0');assert.throws(()=>f.store.emitted(request.id,'unused-channel'),error=>error.code==='worker_lost');
 const {createPlatform}=await import('../src/server.mjs');const recovered=await createPlatform({...f.config,port:0});t.after(()=>recovered.close());
 assert.equal(recovered.store.get('SELECT status FROM requests WHERE id=?',request.id).status,'failed');assert.equal(recovered.store.user(f.user.id).reserved_micros,0);
 assert.throws(()=>f.store.finish(request.id,{input:100,output:10,cache_read:0,cache_write:0},'late old worker'),error=>error.code==='worker_lost');
 assert.equal(recovered.store.get('SELECT charged_micros FROM requests WHERE id=?',request.id).charged_micros,0);
});

test('interim stream counters are not mistaken for final actual usage',async t=>{
 const f=await fixture(t);f.configure();const mock=await upstream(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'partial counted response'},finish_reason:null}],usage})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});await f.channel(mock);const id=requestId();await f.request('/v1/chat/completions',body('gcode-sol',{stream:true}),f.token,{'Idempotency-Key':id});const row=f.store.get('SELECT * FROM requests WHERE id=?',id);assert.equal(row.status,'needs_review');assert.equal(row.usage,null);assert.equal(row.charged_micros,0);assert(f.store.user(f.user.id).reserved_micros>0);
});
