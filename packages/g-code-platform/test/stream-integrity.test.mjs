import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,upstream,reply,usage,body,requestId} from './helpers.mjs';

test('stream parameter errors stop immediately while explicit rate limits may use the same-model backup',async t=>{
 const f=await fixture(t);f.configure();let error={type:'invalid_request_error',code:'invalid_parameter',status:400,message:'private upstream diagnostic'};
 const main=await upstream(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({error})+'\n\n');});
 const backup=await upstream(t,(_req,res,input)=>reply(res,{stream:input.stream}));await f.channel(main,{priority:0});await f.channel(backup,{priority:1});
 const id=requestId(),invalid=await f.request('/v1/chat/completions',body('gcode-sol',{stream:true}),f.token,{'Idempotency-Key':id});
 assert.equal(backup.calls.length,0,'An HTTP 200 envelope must not make an SSE parameter error retryable');
 assert.equal(invalid.response.status,400);assert.equal(f.store.get('SELECT status FROM requests WHERE id=?',id).status,'failed');assert.equal(f.store.user(f.user.id).reserved_micros,0);assert(!invalid.text.includes('private upstream diagnostic'));
 error={type:'rate_limit_error',code:'rate_limit_exceeded',status:429};
 const limited=await f.request('/v1/chat/completions',body('gcode-sol',{stream:true}),f.token,{'Idempotency-Key':requestId()});assert.equal(limited.response.status,200);assert.equal(backup.calls.length,1);assert.match(limited.text,/\[DONE\]/);
});

test('malformed or conflicting final usage cannot reuse earlier counts as actual billing',async t=>{
 const f=await fixture(t);f.configure();let final={...usage,completion_tokens:-1};
 const mock=await upstream(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});for(const frame of [{choices:[{delta:{content:'visible response'},finish_reason:null}]},{choices:[],usage},{choices:[],usage:final}])res.write('data: '+JSON.stringify(frame)+'\n\n');res.end('data: [DONE]\n\n');});await f.channel(mock);
 for(const value of [{...usage,completion_tokens:-1},{...usage,completion_tokens:11},null]){
  final=value;const id=requestId(),result=await f.request('/v1/chat/completions',body('gcode-sol',{stream:true}),f.token,{'Idempotency-Key':id});
  const request=f.store.get('SELECT * FROM requests WHERE id=?',id);assert.equal(request.status,'needs_review');assert.equal(request.usage,null);assert.equal(request.charged_micros,0);assert.match(result.text,/待管理员核对/);assert(!result.text.includes('[DONE]'));
  const attempt=f.store.get('SELECT * FROM attempts WHERE request_id=?',id);assert.equal(attempt.cost_kind,'upper_bound');assert.equal(attempt.usage,null);
  f.store.resolve(f.admin.id,id,{action:'refund',reason:'mock usage inconsistency'});
 }
});

test('Responses failed events respect permanent errors and never retry after a tool call starts',async t=>{
 const f=await fixture(t);f.configure('gcode-sol','responses');let tool=false;
 const rschema={input:'input_tokens',output:'output_tokens',cache_read:null,cache_write:null,input_includes_cache:true,output_includes_reasoning:true};
 const main=await upstream(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});if(tool)res.write('data: '+JSON.stringify({type:'response.output_item.added',item:{id:'fc1',type:'function_call',name:'mock_tool',arguments:''}})+'\n\n');res.end('data: '+JSON.stringify({type:'response.failed',response:{error:tool?{code:'server_error'}:{code:'invalid_prompt',status:400}}})+'\n\n');});
 const backup=await upstream(t,(_req,res)=>{res.writeHead(503);res.end();});await f.channel(main,{priority:0,protocol:'responses',usage_schema:rschema});await f.channel(backup,{priority:1,protocol:'responses',usage_schema:rschema});
 for(const withTool of [false,true]){tool=withTool;const id=requestId();await f.request('/v1/responses',{model:'gcode-sol',input:'mock request',stream:true,max_output_tokens:100},f.token,{'Idempotency-Key':id});assert.equal(backup.calls.length,0);assert.equal(f.store.get('SELECT status FROM requests WHERE id=?',id).status,withTool?'needs_review':'failed');}
});
