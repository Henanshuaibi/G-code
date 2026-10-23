import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {Attachments} from '../src/attachments.mjs';
const root=await mkdtemp(path.resolve('build/attachments-test-'));await mkdir(path.join(root,'uploads'));const store=new Attachments(root);
const add=async(name,data,mime='application/octet-stream')=>{const id=randomUUID();await writeFile(path.join(root,'uploads',id+'.data'),data);await writeFile(path.join(root,'uploads',id+'.json'),JSON.stringify({name,mime}));return id;};
const image=await add('照片.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==','base64'));const text=await add('代码.js',Buffer.from('const 消息="你好";\n'));const pdf=await add('说明.pdf',Buffer.from('%PDF-1.7\nfixture'));
const files=await store.prepare([image,text,pdf]);assert(files[0].uri.startsWith('data:image/png;base64,'));assert(files[1].uri.startsWith('data:text/plain;base64,'));assert(files[2].uri.startsWith('data:application/pdf;base64,'));assert.equal(files[1].name,'代码.js');
await assert.rejects(store.get('../../settings'),/标识/);await assert.rejects(store.prepare([image,image]),/不同附件/);await assert.rejects(store.prepare(Array(9).fill(image)),/8/);
const binary=await add('应用.apk',Buffer.from([0,1,2,3,254]));await assert.rejects(store.prepare([binary]),/UTF-8|二进制/);
const huge=await add('大文本.txt',Buffer.alloc(262145,65));await assert.rejects(store.prepare([huge]),/256 KB/);
const outside=path.join(root,'outside');await writeFile(outside,'private');const link=randomUUID();await symlink(outside,path.join(root,'uploads',link+'.data'));await assert.rejects(store.get(link),/超出范围/);
await store.discard([image,text,pdf]);await assert.rejects(readFile(path.join(root,'uploads',image+'.data')),/ENOENT/);
console.log('PASS: real attachment bytes, image/PDF/text MIME sniffing, UTF-8, limits, traversal/symlink rejection and cleanup');

const jpeg=await readFile(new URL('../tests/device-frame.jpg',import.meta.url));
const video=async(count=8)=>{const id=await add('手机视频.mp4',jpeg,'video/mp4');const folder=path.join(root,'uploads',id+'.frames');await mkdir(folder);const frames=[];for(let i=0;i<count;i++){await writeFile(path.join(folder,i+'.jpg'),jpeg);frames.push({file:i+'.jpg',timeMs:i*1000});}await writeFile(path.join(root,'uploads',id+'.json'),JSON.stringify({name:'手机视频.mp4',kind:'video',durationMs:9000,frames}));return id;};
const clip=await video(3);const clipFiles=await store.prepare([clip]);assert.equal(clipFiles.length,4);assert(clipFiles[0].uri.startsWith('data:text/plain;base64,'));const note=Buffer.from(clipFiles[0].uri.split(',')[1],'base64').toString();assert(note.includes('不含音轨')&&note.includes('00:02.0'));assert(clipFiles.slice(1).every(file=>file.uri.startsWith('data:image/jpeg;base64,')));assert.deepEqual((await store.preview(clip)).data,jpeg);
const converted=await add('HEIC 已转码.jpg',jpeg,'image/heic');assert.equal((await store.get(converted)).mime,'image/jpeg');
const clips=await Promise.all(Array.from({length:8},()=>video()));const batch=await store.prepare(clips);assert.equal(batch.filter(file=>file.uri.startsWith('data:image/jpeg')).length,16,'Total video frames must be bounded across multiple clips');
const broken=await video(1);const manifest=path.join(root,'uploads',broken+'.json');await writeFile(manifest,JSON.stringify({name:'bad.mp4',kind:'video',durationMs:1000,frames:[{file:'../../settings',timeMs:0}]}));await assert.rejects(store.prepare([broken]),/视频帧信息/);
const raw=await add('旧视频.mp4',Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(12)]));await assert.rejects(store.prepare([raw]),/视频需要先抽帧/);
await store.discard([clip,converted,...clips,broken,raw]);await assert.rejects(readFile(path.join(root,'uploads',clip+'.frames/0.jpg')),/ENOENT/);
const largeJpeg=Buffer.concat([jpeg,Buffer.alloc(8*1048576)]);const largeImages=await Promise.all(Array.from({length:3},()=>add('大照片.jpg',largeJpeg)));await assert.rejects(store.prepare(largeImages),/合计最多 20 MB/);await assert.rejects(store.prepare([...largeImages,randomUUID()]),/合计最多 20 MB/,'Stop at the size limit before reading the next file');
const tooLarge=await add('超大照片.jpg',Buffer.concat([jpeg,Buffer.alloc(10*1048576)]));await assert.rejects(store.get(tooLarge),/超过大小限制/);await store.discard([...largeImages,tooLarge]);
console.log('PASS: video frame bytes, timestamp/visual-only metadata, converted photo MIME sniffing, 16-frame batch bound, traversal rejection, legacy video guidance and complete frame cleanup');

const cancelled=new AbortController();cancelled.abort(new Error('附件准备已取消'));await assert.rejects(store.prepare([randomUUID()],{signal:cancelled.signal}),/附件准备已取消/);console.log('PASS: attachment size rejection precedes later file reads; cancelled preparation performs no file read');

const thumbnailId=await add('原图.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==','base64'));await mkdir(path.join(root,'media/assets'),{recursive:true});await writeFile(path.join(root,'uploads',thumbnailId+'.thumb'),jpeg);assert.deepEqual((await store.preview(thumbnailId)).data,jpeg);const originalBytes=(await store.get(thumbnailId)).data;const imageFiles=await store.prepare([thumbnailId]);assert.deepEqual(Buffer.from(imageFiles[0].uri.split(',')[1],'base64'),originalBytes,'Model gets original image, not UI thumbnail');const {readdir}=await import('node:fs/promises');assert((await readdir(path.join(root,'media/assets'))).some(name=>name.endsWith('.preview.jpg')));await store.discard([thumbnailId]);await assert.rejects(readFile(path.join(root,'uploads',thumbnailId+'.thumb')),/ENOENT/);console.log('PASS: small history thumbnail persists while model receives original image bytes; draft thumbnail cleanup');
