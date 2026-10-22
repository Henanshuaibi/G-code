import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {MediaJobs} from '../src/media.mjs';
const root=await mkdtemp(path.resolve('build/media-test-'));const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==','base64');const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(32)]);const calls=[];const cdnKeys=[];
const cdn=createServer((req,res)=>{cdnKeys.push(req.headers.authorization);if(req.url==='/redirect'){res.writeHead(302,{Location:'/image'});res.end();return;}res.setHeader('Content-Type','image/png');res.end(png);});await new Promise(resolve=>cdn.listen(0,'127.0.0.1',resolve));
const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;calls.push({path:req.url,method:req.method,body,headers:req.headers});assert.equal(req.headers.authorization,'Bearer media-fake-key-not-real');
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/images/generations'){const data=JSON.parse(body);assert.equal(data.model,'image-fixture');if(data.prompt==='error'){res.writeHead(400);res.end(JSON.stringify({error:{message:'unsupported model: media-fake-key-not-real'}}));return;}res.end(JSON.stringify({data:[data.prompt==='url'?{url:'http://127.0.0.1:'+cdn.address().port+'/redirect'}:{b64_json:png.toString('base64')}]}));return;}
  if(req.url==='/v1/videos'&&req.method==='POST'){assert(req.headers['content-type'].startsWith('multipart/form-data;'));assert(body.includes('video-fixture'));assert(body.includes('name="seconds"'));res.end(JSON.stringify({id:'video_fixture_'+calls.length,status:'queued'}));return;}
  if(req.url.endsWith('/content')){res.setHeader('Content-Type','video/mp4');res.end(mp4);return;}
  if(req.url.startsWith('/v1/videos/')){res.end(JSON.stringify({status:'completed',progress:100}));return;}res.writeHead(404);res.end('{}');
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const providers=[{id:'a',name:'fixture',base:'http://127.0.0.1:'+server.address().port+'/v1',key:'media-fake-key-not-real',allowHttp:true,models:['text-fixture'],imageModels:['image-fixture'],videoModels:['video-fixture']}];let media=await MediaJobs.create(root,providers);
const until=async(predicate)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Fixture timed out: '+JSON.stringify(media.list()));};
try{
 await assert.rejects(media.start({kind:'image',model:'text-fixture',prompt:'x'},'s'),/模型未配置/);assert.equal(calls.length,0);
 const image=await media.start({kind:'image',prompt:'base64'},'s');await until(()=>media.jobs.get(image.id).status==='completed');assert.deepEqual(await readFile((await media.asset(media.jobs.get(image.id).files[0].filename)).path),png);
 const url=await media.start({kind:'image',prompt:'url'},'s');await until(()=>media.jobs.get(url.id).status==='completed');assert.equal(cdnKeys.length,2);assert(cdnKeys.every(key=>key===undefined),'API key must never reach CDN');
 const error=await media.start({kind:'image',prompt:'error'},'s');await until(()=>media.jobs.get(error.id).status==='failed');assert(media.jobs.get(error.id).error.includes('HTTP 400'));assert(!media.jobs.get(error.id).error.includes('media-fake-key-not-real'));
 const video=await media.start({kind:'video',prompt:'scene',seconds:'4',size:'1280x720'},'s');await until(()=>media.jobs.get(video.id).remoteId&&!media.pending.has(video.id));const postCount=calls.filter(c=>c.path==='/v1/videos'&&c.method==='POST').length;await media.close();media=await MediaJobs.create(root,providers);media.refresh(video.id,'s');await until(()=>media.jobs.get(video.id).status==='completed');assert.equal(calls.filter(c=>c.path==='/v1/videos'&&c.method==='POST').length,postCount,'Resume must query old video ID, not create again');assert.deepEqual(await readFile((await media.asset(media.jobs.get(video.id).files[0].filename)).path),mp4);
 assert(!JSON.stringify(media.list()).includes('media-fake-key-not-real'));assert(!(await readFile(path.join(root,'media/jobs',image.id+'.json'),'utf8')).includes('media-fake-key-not-real'));await assert.rejects(media.asset('../../secret'),/标识/);
 console.log('PASS: actual HTTP image base64/URL+redirect download, no key leak to CDN, separate generation models, video multipart/task/content, restart recovery without duplicate submission, HTTP error redaction and persisted result bytes');
}finally{await media.close();server.closeAllConnections();cdn.closeAllConnections();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>cdn.close(resolve))]);}
