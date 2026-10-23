import {open,rename,rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';

// Keep only stream buffers and eight header bytes in memory. Publish after a complete download.
export async function saveVideo(response,target,limit){
  const temporary=target+'.part';let size=0,header=Buffer.alloc(0),handle;
  try{
    if(!response.body)throw new Error('视频下载没有返回内容');
    // Await creation: a failed source may reject before a lazily opened writer creates .part.
    handle=await open(temporary,'w',0o600);
    await pipeline(response.body,async function*(source){
      for await(const chunk of source){
        size+=chunk.length;if(size>limit)throw new Error('生成内容超过本机保存上限');
        if(header.length<8){header=Buffer.concat([header,Buffer.from(chunk.subarray(0,8-header.length))]);if(header.length===8&&header.subarray(4,8).toString()!=='ftyp')throw new Error('视频下载结果不是可识别的 MP4 文件');}
        yield chunk;
      }
      if(header.length<8)throw new Error('视频下载结果为空或不完整');
    },handle.createWriteStream({highWaterMark:65536}));
    await rename(temporary,target);return {size};
  }catch(error){await handle?.close().catch(()=>{});await rm(temporary,{force:true});throw error;}
}
