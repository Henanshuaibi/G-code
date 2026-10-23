import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,upstream,reply,rates,caps,schema,body,requestId} from './helpers.mjs';

test('operator APIs configure two products; new user redeems, uses both exact IDs, checks prices, bills and independent self-use costs',async t=>{
 const f=await fixture(t);
 const solMain=await upstream(t,(_req,res)=>{res.writeHead(503);res.end();},'mock-sol-primary');
 const solBackup=await upstream(t,(_req,res,input)=>reply(res,{stream:input.stream,tool:true}),'mock-sol-backup');
 const flash=await upstream(t,(_req,res,input)=>reply(res,{stream:input.stream}),'mock-flash-only');
 const inputPrices={...rates,input:4_000_000,output:12_000_000}; // Synthetic sale rates, deliberately distinct from procurement and other product.
 for(const [id,sale] of [['gcode-sol',rates],['gcode-flash',inputPrices]]){
  const saved=await f.request('/api/admin/models',{id,protocol:'chat',enabled:true,input_limit:32768,output_limit:4096,sale_price:sale});assert.equal(saved.response.status,200);
 }
 for(const [mock,model,priority] of [[solMain,'gcode-sol',0],[solBackup,'gcode-sol',1],[flash,'gcode-flash',0]]){
  const channel=await f.request('/api/admin/channels',{name:mock.model,base_url:mock.url+'/v1',api_key:'mock-secret-'+mock.model,protocol:'chat',priority,enabled:true,timeout_ms:500,concurrency:5,capabilities:caps,usage_schema:schema,evidence:'controlled local mock protocol'});assert.equal(channel.response.status,200);
  assert.equal((await f.request('/api/admin/mappings',{channel_id:channel.data.id,model_id:model,upstream_model:mock.model,enabled:true,verified:true,evidence:'exact ID from controlled mock',cost_price:rates})).response.status,200);
 }
 const signed=await f.request('/api/register',{username:'new-customer',password:'mock-customer-password',accepted_terms:true},null,{'X-GCode-Client':'android'});assert.equal(signed.response.status,200);const token=signed.data.token,userId=signed.data.user.id;assert.equal(signed.data.user.balance_micros,0);
 const catalog=await f.request('/api/catalog',undefined,token);assert.equal(catalog.data.models.length,2);assert(catalog.data.models.every(model=>model.available));assert.equal(catalog.data.models.find(model=>model.id==='gcode-flash').sale_price.input,inputPrices.input);assert(!catalog.text.includes('mock-secret'));assert(!catalog.text.includes(solMain.url));
 assert.equal((await f.request('/v1/chat/completions',body(),token,{'Idempotency-Key':requestId()})).response.status,402);assert.equal(solMain.calls.length,0);
 const issued=await f.request('/api/admin/cards',{amount_micros:1_000_000,count:1});assert.equal(issued.response.status,201);
 assert.equal((await f.request('/api/redeem',{code:issued.data.cards[0].code},token)).response.status,200);
 for(const model of ['gcode-sol','gcode-flash']){
  const response=await f.request('/v1/chat/completions',body(model,{stream:true,tools:[{type:'function',function:{name:'fixture_tool',parameters:{type:'object',properties:{}}}}]}),token,{'Idempotency-Key':requestId()});assert.equal(response.response.status,200);assert.match(response.text,/\[DONE\]/);
 }
 assert.equal(solMain.calls.length,1);assert.equal(solBackup.calls.length,1);assert.equal(flash.calls.length,1);assert.equal(solBackup.calls[0].body.model,solBackup.model);assert.equal(flash.calls[0].body.model,flash.model);assert.equal(solBackup.calls[0].body.tools[0].function.name,'fixture_tool');
 const history=await f.request('/api/history',undefined,token);assert.equal(history.data.requests.length,2);assert(history.data.requests.every(row=>row.status==='settled'));assert.equal(history.data.user.id,userId);assert.equal(history.data.user.reserved_micros,0);
 const debits=history.data.requests.reduce((total,row)=>total+row.charged_micros,0);assert.equal(history.data.user.available_micros,1_000_000-debits);assert.equal(history.data.ledger.filter(row=>row.kind==='usage').length,2);
 assert.equal((await f.request('/api/admin/report',undefined,token)).response.status,403);
 assert.equal((await f.request('/v1/chat/completions',body('gcode-flash'),f.adminSession.token,{'Idempotency-Key':requestId()})).response.status,200);
 const report=(await f.request('/api/admin/report')).data,customer=report.by_user.find(row=>row.id===userId),owner=report.by_user.find(row=>row.id===f.admin.id);
 assert.equal(customer.charged_micros,debits);assert.equal(customer.billed_usage.input,160);assert.equal(customer.billed_usage.output,20);assert(customer.actual_cost_cny_micros>0);assert(customer.unknown_cost_upper_bound_micros>0);assert.equal(customer.cost_cny_micros,customer.actual_cost_cny_micros+customer.unknown_cost_upper_bound_micros);assert.equal(customer.estimated_gross_margin_micros,debits-customer.cost_cny_micros);assert(owner.actual_cost_cny_micros>0);assert.equal(owner.unknown_cost_upper_bound_micros,0);assert.equal(owner.active_reserved_cost_micros,0);
 assert(!JSON.stringify(f.logs).includes('mock-secret'));assert(!JSON.stringify(f.logs).includes(issued.data.cards[0].code));
});

test('report separates live cost reservations, unknown upper bounds and verified procurement reconciliation',async t=>{
 const f=await fixture(t);f.configure();const mock=await upstream(t,(_req,res)=>{res.writeHead(503);res.end();});const channel=await f.channel(mock);
 const pending=f.store.reserve(f.user.id,requestId(),f.store.get('SELECT * FROM models WHERE id=?','gcode-sol'),100,'controlled-active-attempt','chat');
 const attempt=f.store.reserveAttempt(pending,f.store.routes('gcode-sol','chat')[0]);
 const live=f.store.report().by_user.find(row=>row.id===f.user.id);assert.equal(live.actual_cost_cny_micros,0);assert.equal(live.unknown_cost_upper_bound_micros,0);assert.equal(live.active_reserved_cost_micros,attempt.reserved_cny_micros);
 f.store.finishAttempt(attempt.id,null,'upstream_retryable');f.store.finish(pending.id,null,'upstream_retryable',channel.id);
 const unknown=f.store.report().by_user.find(row=>row.id===f.user.id);assert.equal(unknown.actual_cost_cny_micros,0);assert.equal(unknown.unknown_cost_upper_bound_micros,attempt.reserved_cny_micros);assert.equal(unknown.active_reserved_cost_micros,0);
 const result=await f.request('/api/admin/reconcile-attempt',{id:attempt.id,usage:{input:80,output:10,cache_read:20,cache_write:0},reason:'controlled supplier evidence'});assert.equal(result.response.status,200);
 const verified=f.store.report().by_user.find(row=>row.id===f.user.id);assert.equal(verified.actual_cost_cny_micros,result.data.attempt.cost_cny_micros);assert.equal(verified.unknown_cost_upper_bound_micros,0);assert.equal(verified.upper_bound_attempts,0);assert.equal(verified.billed_usage.input,0);assert.equal(verified.input,80);assert.equal(verified.active_reserved_cost_micros,0);
});
