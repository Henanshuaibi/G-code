import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {DeviceBridge,deviceResult} from '../src/device.mjs';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
const input=new PassThrough();const output=new PassThrough();const lines=createInterface({input:output});const requests=[];
const bridge=new DeviceBridge(input,output,'private-test-device-token');
lines.on('line',line=>requests.push(JSON.parse(line.slice('MOBILE_DEVICE '.length))));
try{
  const first=bridge.request('read',{},'session-a');const second=bridge.request('open',{},'session-b');
  assert.equal(requests.length,2);assert.notEqual(requests[0].id,requests[1].id);assert.equal(requests[0].sessionID,'session-a');assert(requests[0].deadline>Date.now());
  input.write(JSON.stringify({token:'wrong',id:requests[0].id,data:'forged'})+'\n');
  input.write('not JSON\n');
  input.write(JSON.stringify({token:requests[1].token,id:requests[1].id,data:{opened:true}})+'\n');
  input.write(JSON.stringify({token:requests[0].token,id:requests[0].id,data:{screen:'legitimate'}})+'\n');
  assert.deepEqual(await first,{screen:'legitimate'});assert.deepEqual(await second,{opened:true});
  const failure=bridge.request('click',{},'session-a');const errorRequest=requests.at(-1);input.write(JSON.stringify({token:errorRequest.token,id:errorRequest.id,error:'未授权'})+'\n');await assert.rejects(failure,/未授权/);
  const controller=new AbortController();const pending=bridge.request('click',{},'session-a',controller.signal);controller.abort();await assert.rejects(pending,/已取消/);
  const cancel=requests.at(-1);assert.equal(cancel.action,'cancel');assert.equal(cancel.input.requestID,requests.at(-2).id);assert.equal(cancel.sessionID,'session-a');input.write(JSON.stringify({token:cancel.token,id:cancel.id,data:{cancelled:true}})+'\n');assert(!requests.some(item=>item.action==='stop'));
  await assert.rejects(bridge.request('read',{},'session-a',controller.signal),/已取消/);
  const disconnected=bridge.request('read',{},'session-a');input.end();await assert.rejects(disconnected,/连接已关闭/);
  assert.equal(bridge.pending.size,0);
  console.log('PASS: private IPC authentication, response correlation, error propagation, request-only abort, preserved authorization and disconnect cleanup');
}finally{bridge.close();lines.close();input.destroy();output.destroy();}

const timedInput=new PassThrough();const timedOutput=new PassThrough();const timedLines=createInterface({input:timedOutput});const timedRequests=[];
const timed=new DeviceBridge(timedInput,timedOutput,'timed-test-token',{timeoutMs:100});
timedLines.on('line',line=>{const item=JSON.parse(line.slice(14));timedRequests.push(item);if(item.action==='cancel'||item.action==='status')timedInput.write(JSON.stringify({token:item.token,id:item.id,data:item.action==='status'?{active:true,sessionID:'session-a'}:{cancelled:true}})+'\n');});
try{
  await assert.rejects(timed.request('type',{text:'可乐'},'session-a'),error=>error.code==='REQUEST_TIMEOUT');
  assert.equal(timedRequests[1].action,'cancel');assert.equal(timedRequests[1].input.requestID,timedRequests[0].id);assert.equal((await timed.request('status',{},'session-a')).active,true);assert(!timedRequests.some(item=>item.action==='stop'));assert.equal(timed.pending.size,0);
  console.log('PASS: actual private IPC deadline cancels only the timed-out request; status remains authorized and no session stop is sent');
}finally{timed.close();timedLines.close();timedInput.destroy();timedOutput.destroy();}

const root=await mkdtemp(path.resolve('build/device-file-test-'));
try{
  const shots=path.join(root,'device-shots');await mkdir(shots);const name='12345678-1234-1234-1234-123456789abc.jpg';const jpeg=await readFile(new URL('../tests/device-frame.jpg',import.meta.url));
  await writeFile(path.join(shots,name),jpeg);const result=await deviceResult({screen:'screen-a',imageFile:name,imageWidth:2,imageHeight:2},root);
  assert.equal(result.content[0].type,'text');assert(!result.content[0].text.includes('imageFile'));assert.equal(result.content[1].mime,'image/jpeg');assert.deepEqual(Buffer.from(result.content[1].uri.split(',')[1],'base64'),jpeg);await assert.rejects(readFile(path.join(shots,name)),/ENOENT/);
  await assert.rejects(deviceResult({imageFile:'../../settings.json'},root),/无效/);
  await writeFile(path.join(root,'secret.txt'),'private-test-content');await symlink(path.join(root,'secret.txt'),path.join(shots,name));await assert.rejects(deviceResult({imageFile:name},root),/ELOOP/);assert.equal(await readFile(path.join(root,'secret.txt'),'utf8'),'private-test-content');
  await writeFile(path.join(shots,name),'invalid');await assert.rejects(deviceResult({imageFile:name},root),/JPEG/);await assert.rejects(readFile(path.join(shots,name)),/ENOENT/);
  await writeFile(path.join(shots,name),Buffer.alloc(4000001));await assert.rejects(deviceResult({imageFile:name},root),/过大/);
  assert.deepEqual(await deviceResult({performed:'home'},root),{content:'{"performed":"home"}'});
  console.log('PASS: real screenshot bytes as SDK tool file content, private filename stripping, size/type bounds, traversal/symlink rejection and cleanup');
}finally{await rm(root,{recursive:true,force:true});}
