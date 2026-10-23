import path from 'node:path';
import {mkdir,readFile,writeFile,readdir,rename,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {mediaMime} from './attachments.mjs';
import {saveVideo} from './video-download.mjs';

const uuid=/^[a-f0-9-]{36}$/;
const busy=new Set(['submitting','queued','in_progress','downloading']);
export class MediaJobs {
  static async create(root,providers){
    const media=new MediaJobs();media.root=path.join(root,'media');media.providers=providers;media.jobs=new Map();media.pending=new Map();media.timers=new Map();media.controllers=new Set();media.closed=false;
    await mkdir(path.join(media.root,'jobs'),{recursive:true});await mkdir(path.join(media.root,'assets'),{recursive:true});
    for(const name of await readdir(path.join(media.root,'jobs'))){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;const job=JSON.parse(await readFile(path.join(media.root,'jobs',name),'utf8'));if(!uuid.test(job.id)||name!==job.id+'.json')continue;
      if(busy.has(job.status)&&!job.remoteId){job.status='interrupted';job.error='上次请求连接中断，未自动重新提交。请先检查服务端任务或用量，再决定是否重试。';await media.save(job);}media.jobs.set(job.id,job);if(busy.has(job.status)&&job.remoteId)media.schedule(job);
    }return media;
  }
  options(){return this.providers.filter(p=>p.imageModels?.length||p.videoModels?.length).map(p=>({id:p.id,name:p.name,imageModels:p.imageModels??[],videoModels:p.videoModels??[]}));}
  list(sessionID){return [...this.jobs.values()].filter(job=>!sessionID||job.sessionID===sessionID).sort((a,b)=>b.created-a.created).slice(0,100).map(job=>this.public(job));}
  public(job){const {base,...data}=job;return data;}
  error(error){return this.providers.map(p=>p.key).filter(Boolean).reduce((value,key)=>value.replaceAll(key,'[API Key 已隐藏]'),String(error.message??error)).slice(0,1200);}
  async save(job){const target=path.join(this.root,'jobs',job.id+'.json');await writeFile(target+'.tmp',JSON.stringify(job));await rename(target+'.tmp',target);}
  provider(job){const provider=this.providers.find(p=>p.id===job.providerID&&p.base===job.base);if(!provider)throw new Error('原 API 服务已删除或地址改变，无法查询此任务；请恢复原服务配置');return provider;}
  async request(provider,route,options={},limit=40*1048576){
    const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),180000);
    try{
      const response=await fetch(provider.base.replace(/\/$/,'')+route,{...options,redirect:'error',signal:controller.signal,headers:{...(provider.key?{Authorization:'Bearer '+provider.key}:{}),...options.headers}});
      const data=await this.bytes(response,limit);if(!response.ok){let detail;try{const json=JSON.parse(data.toString());detail=json.error?.message??json.message;}catch{}throw new Error('生成接口请求失败（HTTP '+response.status+'）'+(detail?'：'+detail:response.status===404?'：该服务可能未提供这个生成接口':''));}return {response,data};
    }finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  async bytes(response,limit){const parts=[];let size=0;for await(const chunk of response.body??[]){size+=chunk.length;if(size>limit)throw new Error('生成内容超过本机保存上限');parts.push(chunk);}return Buffer.concat(parts);}
  async download(url,provider,limit,targetFile){
    const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),180000);
    try{for(let hop=0;hop<5;hop++){
      const target=new URL(url);if(target.username||target.password||!(target.protocol==='https:'||provider.allowHttp&&target.protocol==='http:'))throw new Error('生成文件地址不安全或协议不支持');
      const same=target.origin===new URL(provider.base).origin;const response=await fetch(target,{signal:controller.signal,redirect:'manual',headers:same&&provider.key?{Authorization:'Bearer '+provider.key}:{}});
      if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new Error('下载重定向缺少地址');url=new URL(location,target).href;continue;}
      if(!response.ok){await response.body?.cancel();throw new Error('下载生成文件失败（HTTP '+response.status+'）');}return targetFile?await saveVideo(response,targetFile,limit):await this.bytes(response,limit);
    }throw new Error('下载重定向次数过多');}finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  async start(input,sessionID){
    if(this.closed)throw new Error('生成服务正在关闭');if(!['image','video'].includes(input.kind))throw new Error('请选择图片或视频');
    const available=this.providers.filter(p=>(p[input.kind+'Models']??[]).length);const provider=input.providerID?available.find(p=>p.id===input.providerID):available[0];
    if(!provider)throw new Error('请先在 API 服务中填写独立的'+(input.kind==='image'?'生图':'视频')+'模型 ID；不会使用对话模型代替');
    const model=input.model??provider[input.kind+'Models'][0];if(!provider[input.kind+'Models'].includes(model))throw new Error('所选生成模型未配置，请检查 API 设置');
    if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>12000)throw new Error('生成描述请填写 1～12000 个字符');
    if([...this.jobs.values()].filter(job=>busy.has(job.status)).length>=3)throw new Error('最多同时运行 3 个生成任务');
    const size=input.size||undefined;if(size&&!/^\d{2,5}x\d{2,5}$/.test(size))throw new Error('尺寸格式应为 宽x高，例如 1024x1024');
    const seconds=String(input.seconds??'4');if(input.kind==='video'&&!['4','8','12'].includes(seconds))throw new Error('此视频接口支持选择 4、8 或 12 秒');
    const job={id:randomUUID(),sessionID,kind:input.kind,providerID:provider.id,providerName:provider.name,model,base:provider.base,prompt:input.prompt.trim(),status:'submitting',created:Date.now(),progress:0,files:[],...(size?{size}:{}),...(input.kind==='video'?{seconds}:{})};
    this.jobs.set(job.id,job);await this.save(job);this.track(job,()=>this.submit(job));return this.public(job);
  }
  track(job,operation){
    if(this.pending.has(job.id)||this.closed)return;
    const task=operation().catch(async error=>{job.status=job.remoteId?'paused':error.name==='AbortError'?'interrupted':'failed';job.error=(job.remoteId?'查询或下载未完成，可刷新原任务。':'')+this.error(error);await this.save(job);}).finally(()=>this.pending.delete(job.id));this.pending.set(job.id,task);
  }
  async submit(job){
    const provider=this.provider(job);
    if(job.kind==='image'){
      const {data}=await this.request(provider,'/images/generations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:job.model,prompt:job.prompt,n:1,...(job.size?{size:job.size}:{})})});
      const result=JSON.parse(data.toString());const image=result.data?.[0];if(!image?.b64_json&&!image?.url)throw new Error('生图响应缺少 data[0].b64_json 或 url；请确认中转站的接口格式');
      const bytes=image.b64_json?Buffer.from(image.b64_json,'base64'):await this.download(image.url,provider,20*1048576);if(bytes.length>20*1048576)throw new Error('单张生成图片最多保存 20 MB');const mime=mediaMime(bytes);if(!mime?.startsWith('image/'))throw new Error('生成响应不是可识别的图片文件');
      const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[mime];const filename=job.id+'.'+ext;await writeFile(path.join(this.root,'assets',filename),bytes);job.files=[{filename,mime,size:bytes.length}];job.status='completed';job.progress=100;await this.save(job);return;
    }
    const body=new FormData();body.set('model',job.model);body.set('prompt',job.prompt);body.set('seconds',job.seconds);if(job.size)body.set('size',job.size);
    const {data}=await this.request(provider,'/videos',{method:'POST',body});const result=JSON.parse(data.toString());if(typeof result.id!=='string'||!result.id||result.id.length>300)throw new Error('视频响应没有任务 ID；请确认该站支持 OpenAI Videos 接口');job.remoteId=result.id;job.status='queued';await this.save(job);this.schedule(job);
  }
  schedule(job){if(this.closed||this.timers.has(job.id))return;const timer=setTimeout(()=>{this.timers.delete(job.id);if(Date.now()-job.created>3600000){job.status='paused';job.error='已暂停自动查询，可点击刷新继续查询原任务';void this.save(job);return;}this.track(job,()=>this.poll(job));},5000);this.timers.set(job.id,timer);}
  async poll(job){
    const provider=this.provider(job);const {data}=await this.request(provider,'/videos/'+encodeURIComponent(job.remoteId),{},1048576);const result=JSON.parse(data.toString());job.progress=Math.max(0,Math.min(100,Number(result.progress)||0));
    if(result.status==='failed'){job.status='failed';job.error=this.error(new Error(result.error?.message||'视频生成失败'));await this.save(job);return;}
    if(result.status!=='completed'){if(!['queued','in_progress'].includes(result.status))throw new Error('无法识别视频任务状态：'+String(result.status));job.status=result.status;await this.save(job);this.schedule(job);return;}
    job.status='downloading';await this.save(job);const filename=job.id+'.mp4';const saved=await this.download(provider.base.replace(/\/$/,'')+'/videos/'+encodeURIComponent(job.remoteId)+'/content',provider,100*1048576,path.join(this.root,'assets',filename));
    job.files=[{filename,mime:'video/mp4',size:saved.size}];job.status='completed';job.progress=100;delete job.error;await this.save(job);
  }
  refresh(id,sessionID){const job=this.jobs.get(id);if(!job||sessionID&&job.sessionID!==sessionID)throw new Error('没有找到此生成任务');if(job.remoteId&&job.status!=='completed'){const timer=this.timers.get(id);if(timer)clearTimeout(timer);this.timers.delete(id);this.track(job,()=>this.poll(job));}return this.public(job);}
  async asset(filename){if(!/^[a-f0-9-]{36}\.(png|jpg|webp|gif|mp4|preview\.jpg)$/.test(filename))throw new Error('生成文件标识不正确');const file=path.join(this.root,'assets',filename);return {path:file,size:(await stat(file)).size,mime:filename.endsWith('.mp4')?'video/mp4':filename.endsWith('.jpg')?'image/jpeg':'image/'+filename.split('.').at(-1)};}
  async close(){this.closed=true;for(const timer of this.timers.values())clearTimeout(timer);for(const controller of this.controllers)controller.abort();await Promise.allSettled(this.pending.values());}
}
export function mediaPlugin(media){
  return {id:'android-media',setup:async context=>{const registration=await context.tool.transform(editor=>editor.add({name:'generate_media',description:'用户明确要求生成图片或视频时使用。独立调用用户配置的生成模型，不要把对话模型用于 Images/Videos。action=create 新建任务，action=status 查看当前会话任务；视频未完成时不要宣称已经生成。结果会在对话和创作页显示。只在用户明确要求时 create，不要因查询状态重复创建。支持的服务与模型：'+JSON.stringify(media.options()),input:{type:'object',properties:{action:{type:'string',enum:['create','status']},kind:{type:'string',enum:['image','video']},prompt:{type:'string'},providerID:{type:'string'},model:{type:'string'},size:{type:'string'},seconds:{type:'string',enum:['4','8','12']}},required:['action'],additionalProperties:false},options:{codemode:false},execute:async(input,ctx)=>{try{return {content:JSON.stringify(input.action==='status'?media.list(ctx.sessionID):await media.start(input,ctx.sessionID))};}catch(error){return {content:JSON.stringify({error:media.error(error),instruction:'告知实际错误；不要换用对话模型或重复发起收费生成。'})};}}}));return ()=>registration.dispose();}};
}
