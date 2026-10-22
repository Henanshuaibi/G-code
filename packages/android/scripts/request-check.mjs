import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {request} from '../web/request.js';
let count=0;let held;let closeHeld;
const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);count++;if(input.action==='stuck'){held=res;res.once('close',()=>closeHeld?.());return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(input.action==='failure'?{error:'fixture error'}:{data:input.input}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
try{
  assert.deepEqual(await request(url,'status',{ok:true}),{ok:true});await assert.rejects(request(url,'failure'),/fixture error/);
  const closed=new Promise(resolve=>closeHeld=resolve);await assert.rejects(request(url,'stuck',{},100),/超时/);await closed;assert(held.destroyed);assert.equal(count,3,'Timed out request must never be retried');assert.deepEqual(await request(url,'status',{recovered:true}),{recovered:true});
  console.log('PASS: real local HTTP request abort, socket closed, no automatic mutation retries, server error and subsequent request recovery');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
