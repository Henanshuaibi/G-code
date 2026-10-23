import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile,realpath,lstat,rm,writeFile} from 'node:fs/promises';

export function mediaMime(bytes){
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(/^GIF8[79]a/.test(bytes.subarray(0,6).toString('ascii')))return 'image/gif';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(bytes.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
}
const asFile=(mime,data,name)=>({uri:'data:'+mime+';base64,'+data.toString('base64'),name});
const timestamp=ms=>{const seconds=Math.max(0,ms/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+(seconds%60).toFixed(1).padStart(4,'0');};
export class Attachments {
  constructor(root){this.root=path.join(root,'uploads');}
  valid(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('附件标识不正确');}
  async read(file,max,signal){signal?.throwIfAborted();const directory=await realpath(this.root);const target=await realpath(path.join(directory,file));if(!target.startsWith(directory+path.sep))throw new Error('附件超出范围');const stat=await lstat(target);if(!stat.isFile()||stat.size>max)throw new Error('附件文件无效或超过大小限制');return readFile(target,{signal});}
  async get(id,signal){signal?.throwIfAborted();
    this.valid(id);const data=await this.read(id+'.data',10*1048576,signal);const info=JSON.parse((await this.read(id+'.json',32768,signal)).toString('utf8'));const detected=mediaMime(data);const name=String(info.name??'附件').slice(0,160);
    if(info.kind==='video'){
      if(detected!=='image/jpeg'||!Array.isArray(info.frames)||info.frames.length<1||info.frames.length>8||!Number.isFinite(info.durationMs)||info.durationMs<=0)throw new Error('视频抽帧信息不完整，请重新选择视频');
      const seen=new Set();const frames=[];
      for(const frame of info.frames){if(!/^[0-7]\.jpg$/.test(frame.file)||seen.has(frame.file)||!Number.isFinite(frame.timeMs)||frame.timeMs<0||frame.timeMs>info.durationMs)throw new Error('视频帧信息不正确');seen.add(frame.file);frames.push({file:frame.file,timeMs:frame.timeMs});}
      return {id,name,mime:'image/jpeg',size:0,frames,durationMs:info.durationMs};
    }
    if(detected)return {id,name,mime:detected,size:data.length,data};
    if(data.subarray(4,8).toString()==='ftyp'){const brands=data.subarray(8,48).toString('ascii');throw new Error(/heic|heix|heif|mif1|avif/.test(brands)?'HEIC/AVIF 照片需要本机转码，请删除旧附件后重新选择照片':'视频需要先抽帧，请删除旧附件并使用“选择视频（抽帧）”重新添加');}
    if(data.length>262144)throw new Error('文本和代码文件最多 256 KB；较大的文档请转换成 PDF');
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw new Error('此文件不是可读取的照片、PDF 或 UTF-8 文本；视频请使用“选择视频（抽帧）”');}
    if(/[\x00-\x08\x0e-\x1f]/.test(text))throw new Error('暂不解析此二进制格式，请转换成 PDF 或文本');
    return {id,name,mime:'text/plain',size:data.length,data};
  }
  async preview(id){this.valid(id);const data=await this.read(id+'.thumb',524288).catch(error=>{if(error.code==='ENOENT')return this.read(id+'.data',10*1048576);throw error;});const mime=mediaMime(data);if(!mime?.startsWith('image/'))throw new Error('仅预览图片或视频缩略图');return {data,mime};}
  async prepare(ids=[],{signal}={}){signal?.throwIfAborted();
    if(!Array.isArray(ids)||ids.length>8||new Set(ids).size!==ids.length)throw new Error('每条消息最多添加 8 个不同附件');
    const items=[];let sourceBytes=0;for(const id of ids){signal?.throwIfAborted();const item=await this.get(id,signal);sourceBytes+=item.size;if(sourceBytes>20*1048576)throw new Error('处理后的附件合计最多 20 MB，请减少附件');if(item.data){if(item.mime.startsWith('image/')){const thumbnail=await this.read(id+'.thumb',524288,signal).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(thumbnail&&mediaMime(thumbnail)==='image/jpeg'){const hash=createHash('sha256').update(item.data).digest('hex').slice(0,32),filename=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20)+'.preview.jpg';await writeFile(path.join(this.root,'../media/assets',filename),thumbnail);}}item.file=asFile(item.mime,item.data,item.name);delete item.data;}items.push(item);}const videos=items.filter(item=>item.frames);const photos=items.filter(item=>!item.frames&&item.mime.startsWith('image/')).length;const frameLimit=videos.length?Math.min(8,Math.floor((16-photos)/videos.length)):0;const files=[];let size=0;
    for(const item of items){signal?.throwIfAborted();
      if(!item.frames){files.push(item.file);size+=item.size;continue;}
      const count=Math.min(frameLimit,item.frames.length);const selected=Array.from({length:count},(_,index)=>item.frames[count===1?0:Math.round(index*(item.frames.length-1)/(count-1))]);
      const note=Buffer.from('视频抽帧附件：'+item.name+'\n原视频时长约 '+timestamp(item.durationMs)+'，本次提供 '+selected.length+' 张抽样静帧，位置约为 '+selected.map(frame=>timestamp(frame.timeMs)).join('、')+'。\n这些静帧不是完整视频，也不含音轨。只能分析可见画面；不能声称听到语音、音乐或看到了未抽样的连续动作。\n');files.push(asFile('text/plain',note,item.name+'（抽帧说明，不含音频）.txt'));size+=note.length;
      for(const [index,frame] of selected.entries()){const data=await this.read(item.id+'.frames/'+frame.file,10*1048576,signal);if(mediaMime(data)!=='image/jpeg')throw new Error('视频帧不是可识别的 JPEG');size+=data.length;if(size>20*1048576)throw new Error('处理后的附件合计最多 20 MB');files.push(asFile('image/jpeg',data,item.name+' · 画面'+(index+1)+' · 约'+timestamp(frame.timeMs)+'.jpg'));}
    }
    if(size>20*1048576)throw new Error('处理后的照片、视频帧和文件合计最多 20 MB，请减少附件');return files;
  }
  async discard(ids){for(const id of ids){this.valid(id);await Promise.all([rm(path.join(this.root,id+'.data'),{force:true}),rm(path.join(this.root,id+'.json'),{force:true}),rm(path.join(this.root,id+'.thumb'),{force:true}),rm(path.join(this.root,id+'.frames'),{recursive:true,force:true}),rm(path.join(this.root,id+'.source'),{force:true})]);}}
}
