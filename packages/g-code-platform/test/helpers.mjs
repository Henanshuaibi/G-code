import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createPlatform} from '../src/server.mjs';
import {hashPassword} from '../src/primitives.mjs';
export const rates={currency:'CNY',input:2_000_000,output:8_000_000,cache_read:500_000,cache_write:3_000_000}; // synthetic fixture rates, not market prices
export const schema={input:'prompt_tokens',output:'completion_tokens',cache_read:'prompt_tokens_details.cached_tokens',cache_write:null,input_includes_cache:true,output_includes_reasoning:true};
export const caps={stream:true,tools:true,input:['text'],params:['temperature','top_p','parallel_tool_calls','reasoning_effort','reasoning','include','text','truncation'],reasoning_efforts:['low']};
export const usage={prompt_tokens:100,completion_tokens:10,total_tokens:110,prompt_tokens_details:{cached_tokens:20}};
export async function fixture(t,overrides={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'gcode-platform-'));
 const config={db:path.join(root,'platform.db'),key:randomBytes(32),host:'127.0.0.1',port:0,origin:'http://127.0.0.1',production:false,allowLoopback:true,registration:true,dailyCostLimit:100_000_000,userRpm:200,userConcurrency:10,maxAttempts:3,routeDeadline:2000,...overrides};
 const logs=[],app=await createPlatform(config,entry=>logs.push(entry));
 const admin=app.store.createUser('administrator',await hashPassword('admin-password-fixture'),'admin'),adminSession=app.store.createSession(admin.id);
 const request=async(route,input,token=adminSession.token,extra={})=>{if(route==='/api/register'&&input&&!input.registration_proof){const challenge=await fetch(app.url+'/api/register-challenge').then(response=>response.json());for(let counter=0;counter<=8000000;counter++){const hash=createHash('sha256').update(challenge.nonce+':'+counter).digest();if(hash[0]===0&&(hash[1]&252)===0){input={...input,registration_proof:{id:challenge.id,counter}};break;}}}const response=await fetch(app.url+route,{method:input===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(input!==undefined?{'Content-Type':'application/json'}:{}),...extra},...(input!==undefined?{body:JSON.stringify(input)}:{})});let data;const text=await response.text();try{data=JSON.parse(text);}catch{data=text;}return {response,data,text};};
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 const user=app.store.createUser('trial-user',await hashPassword('trial-password-fixture')),session=app.store.createSession(user.id);app.store.adjust(admin.id,user.id,10_000_000,'test trial credit');app.store.adjust(admin.id,admin.id,10_000_000,'test own use credit');
 const channel=async(mock,{model='gcode-sol',priority=1,protocol='chat',key='fixture-upstream-key-'+randomUUID(),capabilities=caps,usage_schema=schema,...rest}={})=>{
  const id=app.store.setChannel(admin.id,{name:'fixture '+priority,base_url:mock.url+'/v1',api_key:key,protocol,priority,enabled:true,timeout_ms:500,concurrency:10,capabilities,usage_schema,evidence:'mock provider contract checked by test',...rest});
  app.store.setMapping(admin.id,id,model,{upstream_model:mock.model,enabled:true,verified:true,evidence:'ID from controlled mock interface',cost_price:rates});return {id,key};
 };
 const configure=(id='gcode-sol',protocol='chat')=>app.store.setModel(admin.id,id,{protocol,enabled:true,input_limit:32768,output_limit:4096,sale_price:rates});
 return {...app,root,config,logs,admin,adminSession,user,token:session.token,request,channel,configure};
}
export async function upstream(t,handler,model='fixture-model-'+randomUUID()){
 const calls=[],sockets=new Set();
 const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;let body;try{body=JSON.parse(text);}catch{}const call={path:req.url,headers:req.headers,body};calls.push(call);try{await handler(req,res,body,call);}catch{res.destroy();}});server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 return {url:'http://127.0.0.1:'+server.address().port,calls,model,server};
}
export function reply(res,{stream=false,tool=false,missingUsage=false,secret='',crlf=false}={}){
 if(!stream){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'chatcmpl_fixture',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:secret||'fixture answer'},finish_reason:'stop'}],...(missingUsage?{}:{usage})}));return;}
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const events=[{id:'chatcmpl_fixture',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant'},finish_reason:null}]},{id:'chatcmpl_fixture',object:'chat.completion.chunk',choices:[{index:0,delta:tool?{tool_calls:[{index:0,id:'call_fixture',type:'function',function:{name:'fixture_tool',arguments:'{"value":1}'}}]}:{content:secret||'fixture stream answer'},finish_reason:null}]},{id:'chatcmpl_fixture',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}]},...(missingUsage?[]:[{id:'chatcmpl_fixture',object:'chat.completion.chunk',choices:[],usage}])];
 const newline=crlf?'\r\n':'\n';for(const event of events)res.write('data: '+JSON.stringify(event)+newline+newline);res.end('data: [DONE]'+newline+newline);
}
export const body=(model='gcode-sol',extra={})=>({model,messages:[{role:'user',content:'private-prompt-fixture-do-not-store'}],max_tokens:100,...extra});
export const requestId=()=>randomUUID();
