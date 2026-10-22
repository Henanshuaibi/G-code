import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.OPENCODE_TEST_ENTRY?path.dirname(path.dirname(process.env.OPENCODE_TEST_ENTRY)):path.resolve('.');
const {settleSubmission}=await import(pathToFileURL(path.join(root,'web/drafts.js')));
const {jsonBody}=await import(pathToFileURL(path.join(root,'src/http-body.mjs')));
const expected={text:'中文照片📷视频🎞️与新草稿',nested:{name:'天津'}};const bytes=Buffer.from(JSON.stringify(expected));
for(const width of [1,2,3,7,bytes.length]){const chunks=[];for(let i=0;i<bytes.length;i+=width)chunks.push(bytes.subarray(i,i+width));assert.deepEqual(await jsonBody(Readable.from(chunks)),expected);}
await assert.rejects(jsonBody(Readable.from([Buffer.alloc(131073,32)])),/请求过大/);await assert.rejects(jsonBody(Readable.from([Buffer.from('{bad')])),SyntaxError);
const folder=mkdtempSync(path.resolve('build/draft-check-'));const file=path.join(folder,'ui.json');writeFileSync(file,'{}');
const storage={getItem(key){return JSON.parse(readFileSync(file,'utf8'))[key]??null;},setItem(key,value){const data=JSON.parse(readFileSync(file,'utf8'));data[key]=value;writeFileSync(file,JSON.stringify(data));},removeItem(key){const data=JSON.parse(readFileSync(file,'utf8'));delete data[key];writeFileSync(file,JSON.stringify(data));}};
try{
  const sent={text:'已发送的内容',attachments:['photo']};storage.setItem('draft:A',sent.text);storage.setItem('attachments:A',JSON.stringify([{id:'photo'},{id:'new-video'}]));storage.setItem('draft:B','另一段对话');
  storage.setItem('draft:A','等待期间写的新内容');const after=settleSubmission(storage,'A',sent);assert.equal(after.text,'等待期间写的新内容');assert.deepEqual(after.attachments,[{id:'new-video'}]);assert.equal(storage.getItem('draft:B'),'另一段对话');
  settleSubmission(storage,'A',sent);assert.equal(storage.getItem('draft:A'),'等待期间写的新内容','Repeated admission acknowledgement cannot erase a new draft');
  settleSubmission(storage,'A',{text:'等待期间写的新内容',attachments:['new-video']});assert.equal(storage.getItem('draft:A'),null);assert.equal(storage.getItem('attachments:A'),null);
  storage.setItem('draft:A','');assert.equal(settleSubmission(storage,'A',sent).text,'');
  console.log('PASS: fragmented UTF-8 JSON preserves Chinese/emoji; byte limits and malformed input; acknowledged content only removed while newer drafts, attachments and other sessions persist');
}finally{rmSync(folder,{recursive:true,force:true});}
