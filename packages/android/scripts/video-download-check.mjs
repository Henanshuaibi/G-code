import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const source=process.env.OPENCODE_TEST_ENTRY?path.dirname(process.env.OPENCODE_TEST_ENTRY):path.resolve('src');
const {saveVideo}=await import(pathToFileURL(path.join(source,'video-download.mjs')));
const folder=await mkdtemp(path.resolve('build/video-transfer-'));const file=path.join(folder,'video.mp4');
const header=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom')]);const chunk=Buffer.alloc(65536,71);let broken;
const server=createServer(async(req,res)=>{
  if(req.url==='/invalid'){res.end('<html>not a video</html>');return;}
  if(req.url==='/empty'){res.end();return;}
  res.writeHead(200,{'Content-Type':'video/mp4'});res.write(header);
  if(req.url==='/broken'){broken=res;return;}
  for(let i=0;i<32;i++)if(!res.write(chunk))await once(res,'drain');res.end();
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
try{
  const expected=Buffer.concat([header,...Array(32).fill(chunk)]);const result=await saveVideo(await fetch(base+'/valid'),file,3*1048576);assert.equal(result.size,expected.length);assert.deepEqual(await readFile(file),expected);assert.deepEqual(await readdir(folder),['video.mp4']);
  for(const [route,limit,pattern] of [['/invalid',3*1048576,/MP4/],['/empty',3*1048576,/不完整/],['/valid',100000,/保存上限/]]){await assert.rejects(saveVideo(await fetch(base+route),file,limit),pattern);assert.deepEqual(await readFile(file),expected,'Failed transfer must preserve previous complete video');assert.deepEqual(await readdir(folder),['video.mp4']);}
  const response=await fetch(base+'/broken');const saving=saveVideo(response,file,3*1048576);const failed=assert.rejects(saving);broken.destroy();await failed;assert.deepEqual(await readFile(file),expected);assert.deepEqual(await readdir(folder),['video.mp4']);
  // Force a filesystem publish failure without replacing any previously published file.
  const blocked=path.join(folder,'missing','video.mp4');await assert.rejects(saveVideo(await fetch(base+'/valid'),blocked,3*1048576),/ENOENT/);
  console.log('PASS: real HTTP video streams to atomic file; complete bytes verified; invalid/empty/oversize/disconnected transfers remove partial data and preserve previous output; disk failure reported');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true});}
