import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const source=process.env.OPENCODE_TEST_ENTRY?path.join(path.dirname(process.env.OPENCODE_TEST_ENTRY),'platform.mjs'):path.resolve('src/platform.mjs');
const {PlatformAccount}=await import(pathToFileURL(source));
const root=await mkdtemp(path.resolve('build/platform-account-'));
let failCatalog=false,loginGate,loginArrived;
const users={alpha:{id:'user_alpha',username:'alpha',available_micros:1000,reserved_micros:0},beta:{id:'user_beta',username:'beta',available_micros:2000,reserved_micros:0}};
const server=createServer(async(req,res)=>{
 let text='';for await(const chunk of req)text+=chunk;const input=text?JSON.parse(text):{};
 res.setHeader('Content-Type','application/json');
 if(req.url==='/api/login'){if(loginGate){loginArrived();await loginGate;}const user=users[input.username];res.end(JSON.stringify({user,token:'session_'+input.username}));return;}
 if(req.url==='/api/me'){const name=req.headers.authorization?.replace('Bearer session_','');res.end(JSON.stringify({user:users[name]}));return;}
 if(req.url==='/api/catalog'){if(failCatalog){res.writeHead(503);res.end(JSON.stringify({error:{message:'mock catalogue unavailable'}}));return;}res.end(JSON.stringify({models:[],disclosure:'mock disclosure'}));return;}
 if(req.url==='/api/logout'){res.end('{}');return;}
 res.writeHead(404);res.end('{}');
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,account=await PlatformAccount.create(root,{base_url:base});let rebound;
try{
 assert.equal(account.status().managed,true);assert.equal(account.status().serviceConfigured,true);
 await account.action('login',{username:'alpha',password:'mock password',accepted_terms:true});const before=account.status(),saved=await readFile(account.file,'utf8');
 await assert.rejects(account.action('login',{base:'http://127.0.0.1:1',username:'beta',password:'mock password',accepted_terms:true}),/无需更改地址/);
 failCatalog=true;await assert.rejects(account.action('login',{base,username:'beta',password:'mock password',accepted_terms:true}),/mock catalogue unavailable/);
 assert.deepEqual(account.status(),before,'Failed account switch must restore identity, balance, model catalogue and session together');
 assert.equal(await readFile(account.file,'utf8'),saved,'Failed account switch must not persist a new token');
 failCatalog=false;
 let release;loginGate=new Promise(resolve=>{release=resolve;});const arrived=new Promise(resolve=>{loginArrived=resolve;});
 const switching=account.action('login',{base,username:'beta',password:'mock password',accepted_terms:true});
 try{
  await arrived;assert.deepEqual(account.status(),before);assert.equal(await readFile(account.file,'utf8'),saved);
  await assert.rejects(account.action('logout',{}),/正在处理账号操作/);
  const blocked=await fetch(account.base+'/chat/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+account.key,'Content-Type':'application/json'},body:JSON.stringify({model:'gcode-sol',messages:[]})});
  assert.equal(blocked.status,400);assert.match(await blocked.text(),/账号正在变更/);
 }finally{release();await switching;loginGate=null;}
 assert.equal(account.status().user.id,'user_beta');assert.equal(JSON.parse(await readFile(account.file,'utf8')).token,'session_beta');
 rebound=await PlatformAccount.create(root,{base_url:'http://127.0.0.1:1'});assert.equal(rebound.status().connected,false);assert(!JSON.parse(await readFile(account.file,'utf8')).token,'Changing operator endpoint must not forward the prior service token');
 console.log('PASS: fixed operator endpoint login without user address, endpoint override rejected and cross-service token cleared; real HTTP account switch, catalogue failure rolls back all account state and disk session, concurrent account actions and broker calls blocked during switch, successful switch persists coherently');
}finally{if(rebound)await rebound.close();await account.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
