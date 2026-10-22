import {appearance,defaultAppearance,loadAppearance,applyAppearance} from './appearance.js';
import {request} from './request.js';
import {settleSubmission} from './drafts.js';
import {tokenUsage,usageLabel,deleteSelected} from './usage.js';
import {RenderCache,reconcileChildren} from './render-cache.js';
const messageCards=new RenderCache();
const $=id=>document.getElementById(id);
const native=window.Mobile;
const storage={getItem:key=>native?native.storageGet(key):localStorage.getItem(key),setItem:(key,value)=>native?native.storageSet(key,value):localStorage.setItem(key,value),removeItem:key=>native?native.storageSet(key,''):localStorage.removeItem(key)};
let appearanceSettings=loadAppearance(storage.getItem('appearance')),appearancePreview=false;
const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
function showAppearance(value=appearanceSettings){applyAppearance(value,native?.systemDark?native.systemDark():systemTheme.matches,document,native);}
window.mobileAppearanceRefresh=()=>{if(!appearancePreview)showAppearance();};
showAppearance();systemTheme.addEventListener('change',()=>{if(!appearancePreview)showAppearance();});
const state={session:'',project:storage.getItem('project')||'',tab:'chat',status:null,messages:'',busy:false,loading:false,permission:'',pending:null,polling:false,creating:false,selection:null,attachments:[],preparing:false,attachmentRows:'',sessionRows:'',title:'',view:0,history:new Map(),historyCursor:undefined,usage:null};
const text=(tag,value,cls='')=>{const item=document.createElement(tag);item.textContent=value;item.className=cls;return item;};
const button=(value,action,cls='')=>{const item=text('button',value,cls);item.addEventListener('click',()=>Promise.resolve().then(action).catch(error=>toast(error.message)));return item;};
let toastTimer;
function toast(value){$('toast').textContent=value;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4500);}
async function rpc(action,input={}){return request('rpc',action,input);}
function drawer(open){$('drawer').classList.toggle('open',open);$('drawerShade').classList.toggle('open',open);if(open)void sessions().catch(error=>toast(error.message));}
function closeSheet(){if(appearancePreview){appearancePreview=false;showAppearance();}$('sheet').classList.remove('open');$('sheetShade').classList.remove('open');}
function sheet(title){if(appearancePreview){appearancePreview=false;showAppearance();}$('sheetTitle').textContent=title;$('sheetBody').replaceChildren();$('sheet').classList.add('open');$('sheetShade').classList.add('open');return $('sheetBody');}
function field(parent,label,value='',type='text',placeholder=''){const id='f_'+Math.random().toString(36).slice(2);const name=text('label',label,'field');name.htmlFor=id;const input=document.createElement('input');input.id=id;input.type=type;input.value=value;input.placeholder=placeholder;input.autocomplete='off';input.spellcheck=false;parent.append(name,input);return input;}
function titleOf(item){return !item.title||/^New session - \d{4}-/.test(item.title)?'新会话':item.title;}
function validModel(model){return state.status?.providers?.some(p=>p.id===model?.providerID&&p.models.includes(model.id));}
function rememberModel(model){state.selection=model;storage.setItem('model',JSON.stringify(model));const provider=state.status?.providers?.find(p=>p.id===model?.providerID);$('modelButton').textContent=model?(provider?.name?provider.name+' / ':'')+model.id:'选择模型';$('modelButton').title=$('modelButton').textContent;}
function setProject(project){state.project=project;storage.setItem('project',project);$('projectLabel').textContent=project||'手机工作区';}
let refreshTimer,lastSessionRefresh=0;
function scheduleRefresh(){clearTimeout(refreshTimer);if(!document.hidden)refreshTimer=setTimeout(refresh,state.busy?450:3000);}
document.addEventListener('visibilitychange',()=>{clearTimeout(refreshTimer);if(!document.hidden)void refresh();});
async function refresh(){
  clearTimeout(refreshTimer);if(state.polling||document.hidden)return;state.polling=true;
  try{
    state.status=await rpc('status');if(document.hidden)return;if(!validModel(state.selection))rememberModel(state.status.defaultModel??null);refreshPhone();if(!state.project||!state.status.projects.includes(state.project))setProject(state.status.projects[0]||'');
    state.busy=!!state.session&&state.status.active.includes(state.session);$('statusDot').className='ready';$('engineStatus').textContent=state.busy?(state.status.runs?.[state.session]?.label||'正在处理')+' · '+Math.floor((state.status.runs?.[state.session]?.quietMs||0)/1000)+' 秒前有进展':state.status.configured?'本地引擎就绪 · '+(state.selection?.id||state.status.model):'本地引擎已就绪 · 未配置对话模型';$('send').textContent=state.busy?'停止':'发送';$('send').disabled=!state.busy&&(state.loading||state.preparing);
    if(['stalled','failed'].includes(state.status.runs?.[state.session]?.phase))$('engineStatus').textContent=state.status.runs[state.session].label+' · 点击恢复';
    if(state.tab==='chat'){loadAttachments();if(state.session)await messages();}
    if(state.tab==='media')await renderMedia();
    if((state.session||$('drawer').classList.contains('open'))&&Date.now()-lastSessionRefresh>=5000)await sessions();
    if(state.session&&(state.busy||state.pending)){const permissions=await rpc('permissions',{sessionID:state.session});const pending=permissions.data?.find(item=>item.sessionID===state.session);state.pending=pending??null;if(pending){$('engineStatus').textContent='需要确认操作 · 点击这里处理';if(state.permission!==pending.id)showPermission(pending);}}
  }catch(error){$('engineStatus').textContent='连接超时或中断 · 点击恢复';$('statusDot').className='';}
  finally{state.polling=false;scheduleRefresh();}
}
function taskStatus(){
  const body=sheet('任务状态与恢复');const run=state.status?.runs?.[state.session];body.append(text('p',run?.label||'本地引擎状态可能暂未更新'),text('p','等待模型、执行操作和等待确认会分别显示。长时间没有响应时可以先停止任务；重启会中断当前引擎，保留项目、会话和 API 设置。','muted'));
  body.append(button('停止当前任务',async()=>{if(native)native.phoneStop();await rpc('interrupt',{sessionID:state.session});closeSheet();toast('已请求停止');}));
  if(native)body.append(button('重启本地引擎',()=>{const confirm=sheet('重启本地引擎');confirm.append(text('p','将停止手机控制并重新启动本地引擎。不会清除会话、项目和 API 设置。重启后请先检查任务结果，再决定是否继续。'),button('确认重启',()=>{native.restartEngine();closeSheet();},'primary sheetAction'));}));
}
function attachmentScope(){return state.session||'new:'+state.project;}
function attachmentProgress(){let job={};try{job=native?JSON.parse(native.attachmentStatus(attachmentScope())):{};}catch{}state.preparing=!!job.loading;const status=$('attachmentStatus');status.hidden=state.tab!=='chat'||(!job.loading&&!job.error&&!state.attachments.length);status.textContent=job.message||'';status.className=job.error?'attachmentError':'muted';$('send').disabled=!state.busy&&(state.loading||state.preparing);return job;}
function loadAttachments(){const previous=state.preparing;let serialized=storage.getItem('attachments:'+attachmentScope())||'[]';try{state.attachments=JSON.parse(serialized);}catch{state.attachments=[];serialized='[]';}attachmentProgress();if(state.attachmentRows!==serialized||previous!==state.preparing){state.attachmentRows=serialized;renderAttachments();}}
function renderAttachments(){attachmentProgress();state.attachmentRows=JSON.stringify(state.attachments);const root=$('attachmentList');root.replaceChildren();for(const item of state.attachments){const chip=text('div','','attachmentChip');if(item.mime?.startsWith('image/')||item.kind==='video'){const image=document.createElement('img');image.src='attachment/'+item.id;image.alt=item.name;chip.append(image);}chip.append(text('span',item.name+(item.kind==='video'?' · 抽帧，无音频':'')));chip.title=item.note||item.name;const scope=attachmentScope();const remove=button('×',async()=>{if(state.loading)return;await rpc('discardAttachment',{id:item.id});const items=JSON.parse(storage.getItem('attachments:'+scope)||'[]').filter(file=>file.id!==item.id);storage.setItem('attachments:'+scope,JSON.stringify(items));if(attachmentScope()===scope)loadAttachments();});remove.disabled=state.preparing||state.loading;remove.setAttribute('aria-label','移除 '+item.name);chip.append(remove);root.append(chip);}}

async function ensureSession(){if(state.creating)throw new Error('对话正在创建，请稍候');if(state.session)return state.session;if(!state.project){const info=await rpc('status');if(!info.projects.includes('我的对话'))await rpc('createProject',{name:'我的对话'});setProject('我的对话');}return newSession();}
async function attachmentMenu(){if(state.loading){toast('消息正在提交，请稍候');return;}if(state.preparing){toast('附件正在处理，请稍候');return;}const body=sheet('添加与创作');for(const [kind,label] of [['image','选择照片'],['video','选择视频（抽帧）'],['file','选择文件']])body.append(button(label,async()=>{if(!native)throw new Error('请在 Android 应用中选择附件');const sessionID=await ensureSession();if(!sessionID||state.session!==sessionID)throw new Error('页面已切换，请重新添加附件');closeSheet();native.pickAttachments(kind,sessionID);}));body.append(button('生成图片',()=>generationForm('image')),button('生成视频',()=>generationForm('video')),text('p','照片会在本机缩放、转换后再发送；HEIC/AVIF 取决于系统解码能力。视频原文件最多 100 MB，最多抽取 8 张画面，不含音频，也不代表完整视频。所选模型需要支持图片输入。每条最多 8 个附件，处理后合计 20 MB；普通文件最多 10 MB，文本/代码最多 256 KB。点击发送后才会提交给 AI。','muted'));}

function welcome(){const root=$('timeline');root.replaceChildren();const empty=text('section','','empty');empty.append(text('div','>_','glyph'),text('h1','让想法，在手机上落地。'),text('p','连接你的 API，打开一个项目，然后描述你想完成的工作。OpenCode 引擎在应用内运行。'));empty.append(button('配置 API 服务',settings),button('＋ 新建项目',createProject));root.append(empty);}
async function sessions(){
  const result=await rpc('sessions');lastSessionRefresh=Date.now();const current=result.data?.find(item=>item.id===state.session);if(current){state.title=titleOf(current);state.usage=current.tokens;$('usageButton').textContent=usageLabel(state.usage);$('projectLabel').textContent=state.project+' · '+state.title;}
  const signature=JSON.stringify([state.session,result.data]);if(signature===state.sessionRows)return;state.sessionRows=signature;
  const list=$('sessionList');list.replaceChildren();for(const item of result.data??[]){if(item.parentID)continue;const row=text('div','','sessionRow');row.append(button(titleOf(item)+' · '+usageLabel(item.tokens),()=>selectSession(item),item.id===state.session?'active':''));const more=button('⋯',()=>sessionActions(item),'sessionMore');more.setAttribute('aria-label','管理对话：'+titleOf(item));row.append(more);list.append(row);}if(!list.children.length)list.append(text('p','还没有会话','muted'));
}
function clearSession(){messageCards.clear();state.history.clear();state.historyCursor=undefined;state.view++;if(native)native.phoneStop();storage.removeItem('session');state.session='';state.usage=null;$('usageButton').textContent='会话用量';state.title='';state.messages='';state.pending=null;state.permission='';state.busy=false;state.attachments=[];renderAttachments();$('send').textContent='发送';$('input').value='';setProject(state.project);}
function sessionActions(item){
  drawer(false);const body=sheet('管理对话');const title=field(body,'对话标题',titleOf(item));body.append(button('保存标题',async()=>{await rpc('renameSession',{sessionID:item.id,title:title.value});closeSheet();await sessions();}));
  body.append(button('删除对话',()=>{const confirm=sheet('删除这段对话？');confirm.append(text('p','会删除这段对话及其记录，并停止 AI 回复。项目文件保留，已提交的图片/视频任务会继续显示在创作页。'));confirm.append(button('确认删除',async()=>{if(native&&state.session===item.id)native.phoneStop();await rpc('deleteSession',{sessionID:item.id});storage.removeItem('draft:'+item.id);storage.removeItem('attachments:'+item.id);storage.removeItem('attachment-job:'+item.id);if(state.session===item.id){clearSession();await selectTab('chat');}state.sessionRows='';closeSheet();await sessions();toast('对话已删除');},'danger sheetAction'),button('取消',closeSheet));},'danger'));
}
async function selectSession(item){messageCards.clear();state.history.clear();state.historyCursor=undefined;state.view++;if(native&&state.session&&state.session!==item.id)native.phoneStop();state.session=item.id;state.usage=item.tokens;$('usageButton').textContent=usageLabel(state.usage);state.busy=!!state.status?.active.includes(item.id);$('send').textContent=state.busy?'停止':'发送';state.pending=null;state.permission='';state.title=titleOf(item);setProject(item.location.directory.split('/').pop());$('projectLabel').textContent=state.project+' · '+state.title;storage.setItem('session',item.id);if(validModel(item.model))rememberModel(item.model);state.messages='';$('input').value=storage.getItem('draft:'+item.id)||'';loadAttachments();drawer(false);closeSheet();await selectTab('chat');}
async function newSession(){
  if(state.creating||state.loading&&state.session)return;
  if(!state.project){await chooseProject();return;}state.creating=true;$('newSession').disabled=true;
  try{const previous=state.session,view=state.view;const item=await rpc('createSession',{project:state.project,model:state.selection});if(view!==state.view)return item.id;await selectSession(item);if(previous===item.id)toast('当前已经是空白新对话');return item.id;}finally{state.creating=false;$('newSession').disabled=false;}
}
async function chooseModel(){
  if(state.loading||state.creating){toast('任务正在启动，请稍候');return;}
  const body=sheet('选择模型');const info=await rpc('status');state.status=info;
  if(!info.providers.length){body.append(button('添加 API 服务',settings));return;}
  for(const provider of info.providers){body.append(text('h3',provider.name));for(const id of provider.models){const model={providerID:provider.id,id};const chosen=state.selection?.providerID===model.providerID&&state.selection?.id===id;body.append(button((chosen?'✓ ':'')+id,async()=>{if(state.busy||state.loading||state.creating){toast('请先停止当前任务，再切换模型');return;}if(state.session)await rpc('setModel',{sessionID:state.session,model});rememberModel(model);closeSheet();toast('已切换至 '+provider.name+' / '+id);}));}}
  body.append(button('管理 API 服务和模型',settings));
}
async function chooseProject(){drawer(false);const info=await rpc('status');const body=sheet('选择项目');for(const project of info.projects)body.append(button(project,async()=>{if(state.loading||state.creating)throw new Error('消息或对话正在创建，请稍候');setProject(project);closeSheet();await newSession();}));body.append(button('＋ 新建项目',createProject));}
function createProject(){drawer(false);const body=sheet('新建项目');const input=field(body,'项目名称','','text','例如：我的网站');body.append(button('创建并打开',async()=>{if(state.loading||state.creating)throw new Error('消息或对话正在创建，请稍候');const result=await rpc('createProject',{name:input.value});setProject(result.name);closeSheet();await newSession();},'primary sheetAction'));}
async function messages(older=false){
  if(state.tab!=='chat')return;const sessionID=state.session,view=state.view,cursor=state.historyCursor;if(older&&!cursor)return;
  const result=await rpc('messages',{sessionID,...(older?{cursor}:{})});if(sessionID!==state.session||view!==state.view||state.tab!=='chat')return;
  state.usage=result.usage;$('usageButton').textContent=usageLabel(state.usage);
  const jobs=await rpc('mediaJobs',{sessionID});if(sessionID!==state.session||view!==state.view||state.tab!=='chat')return;
  for(const item of result.data)state.history.set(item.id,item);if(older||state.historyCursor===undefined)state.historyCursor=result.cursor?.next??null;
  const data=[...state.history.values()].sort((a,b)=>a.time.created-b.time.created);
  const root=$('timeline');const follow=!older&&root.scrollHeight-root.scrollTop-root.clientHeight<100;const previousHeight=root.scrollHeight,previousTop=root.scrollTop;const nodes=[];
  if(state.historyCursor)nodes.push(messageCards.get('older',state.historyCursor,()=>button('加载更早的消息',()=>messages(true))));
  for(const item of data){const node=messageCards.get(item.id,item,messageCard);if(node)nodes.push(node);}
  messageCards.retain(['empty',...data.map(item=>item.id),...(state.historyCursor?['older']:[])]);
  for(const job of jobs)nodes.push(mediaCard(job));retainMedia(jobs);
  if(!nodes.length){nodes.push(messageCards.get('empty',true,()=>{const intro=text('section','','empty');intro.append(text('div','>_','glyph'),text('h1','从一个具体的任务开始。'),text('p','例如：读一下 README.md，帮我整理项目结构；或者创建一个简单的网页。'));return intro;}));}
  reconcileChildren(root,nodes);
  if(older)root.scrollTop=previousTop+root.scrollHeight-previousHeight;else if(follow)root.scrollTop=root.scrollHeight;
}
function previewImage(file){const image=document.createElement('img');image.src=file.preview;image.alt=file.name||'图片';image.className='mediaPreview';image.loading='lazy';image.decoding='async';return image;}
function messageCard(item,previous){
  if(item.type==='user'){const card=text('article','','message user');card.append(text('div','你','role'),text('div',item.text,'text'));for(const file of item.files??[]){card.append(text('p','📎 '+file.name,'muted'));if(file.preview)card.append(previewImage(file));}return card;}
  if(item.type==='assistant'){
    const card=text('article','','message');card.append(text('div',item.model?.id||'OpenCode','role'));
    for(const part of item.content??[]){
      if(part.type==='text')appendMarkdown(card,part.text);
      if(part.type==='reasoning'){const details=text('details','','tool');details.append(text('summary','思考过程'),text('div',part.text,'text'));card.append(details);}
      if(part.type==='tool'){const details=text('details','','tool');const name=part.name||'tool';const status=part.state?.type||part.state?.status||'';details.append(text('summary',name+' · '+({completed:'已完成',running:'运行中',error:'失败',streaming:'正在准备'}[status]||status)));const output={...part.state,content:part.state?.content?.filter(value=>value.type!=='file')};details.append(text('pre',JSON.stringify(output,null,2)));for(const file of part.state?.content??[]){if(file.type==='file'&&file.preview)details.append(previewImage(file));}card.append(details);}
    }
    card.append(button(usageLabel(item.tokens),()=>showUsage(item.tokens,'本条回复用量'),'usageDetail'));
    if(item.error)card.append(text('div',item.error.message||JSON.stringify(item.error),'error'));
    const opened=[...(previous?.querySelectorAll('details')??[])].map(item=>item.open);card.querySelectorAll('details').forEach((item,index)=>item.open=opened[index]??false);return card;
  }
  if(item.type==='idle'&&item.error)return text('div',item.error.message||JSON.stringify(item.error),'error');return null;
}
function appendMarkdown(parent,value){const pieces=value.split(/(```[\s\S]*?```)/g);for(const piece of pieces){if(piece.startsWith('```')){const first=piece.indexOf('\n');const block=text('pre',piece.slice(first<0?3:first+1,-3));parent.append(block);}else if(piece)parent.append(text('div',piece,'text'));}}
async function send(){
  if(state.busy){if(native)native.phoneStop();await rpc('interrupt',{sessionID:state.session});toast('已请求停止');return;}if(state.loading)return;if(state.preparing){toast('照片或视频正在处理中，请稍候');return;}
  const raw=$('input').value,value=raw.trim();if(!value&&!state.attachments.length)return;if(!state.status?.configured){settings();return;}state.loading=true;$('send').disabled=true;
  let sessionID=state.session;const model=state.selection,sent={text:raw,attachments:state.attachments.map(item=>item.id)};
  try{sessionID=sessionID||await ensureSession();if(!sessionID)return;
    if(!storage.getItem('draft:'+sessionID))storage.setItem('draft:'+sessionID,raw);
    await rpc('prompt',{sessionID,text:value,model,attachments:sent.attachments});
    const remaining=settleSubmission(storage,sessionID,sent);
    if(state.session===sessionID){$('input').value=remaining.text;state.attachments=remaining.attachments;renderAttachments();state.busy=true;state.messages='';await messages();}
  }catch(error){if(state.session===sessionID&&!$('input').value)$('input').value=storage.getItem('draft:'+sessionID)||'';toast(error.message);}finally{state.loading=false;loadAttachments();$('send').disabled=!state.busy&&state.preparing;}

}
async function selectTab(tab){const view=++state.view,project=state.project,sessionID=state.session;state.tab=tab;if(tab!=='chat')messageCards.clear();document.querySelectorAll('[data-tab]').forEach(item=>item.classList.toggle('selected',item.dataset.tab===tab));$('composer').style.display=tab==='chat'?'flex':'none';$('attachmentList').hidden=tab!=='chat';attachmentProgress();
  if(tab==='chat'){state.messages='';if(state.session)await messages();else welcome();return;}
  if(tab==='media'){await renderMedia(true);return;}
  const root=$('timeline');root.replaceChildren(text('p','正在读取…','muted'));
  if(!state.project){root.replaceChildren(button('选择项目',chooseProject));return;}
  if(tab==='files'){const items=await rpc('files',{project});if(view!==state.view)return;root.replaceChildren();for(const file of items){const card=text('div','','card');card.append(button(file.path,async()=>{const content=await rpc('read',{project,path:file.path});const body=sheet(file.path);body.append(text('pre',content.text,'preview'));},'path'),text('div',Math.max(1,Math.round(file.size/1024))+' KB','muted'));root.append(card);}return;}
  if(!state.session){root.replaceChildren(text('p','先开始一个会话，执行任务后在这里查看修改。','muted'));return;}
  const changes=await rpc('changes',{sessionID});if(view!==state.view)return;$('changeCount').textContent=changes.length?' '+changes.length:'';root.replaceChildren();
  if(!changes.length)root.append(text('p','本次任务还没有文件修改。','muted'));
  for(const item of changes){const card=text('div','','card');card.append(text('div',item.path,'path'),text('p',({added:'新增',deleted:'删除',modified:'修改'})[item.kind],'muted'));const pre=text('pre','','preview');for(const line of item.diff.split('\n'))pre.append(text('div',line,line.startsWith('+')?'diffadd':line.startsWith('-')?'diffdel':''));card.append(pre);root.append(card);}
}
function showPermission(request){state.permission=request.id;const body=sheet('G code 请求操作');body.append(text('p',request.message||request.action),text('pre',request.resources.join('\n'),'preview'));for(const [label,decision] of [['本次允许','once'],['拒绝','reject']])body.append(button(label,async()=>{await rpc('reply',{sessionID:request.sessionID,requestID:request.id,decision});state.permission='';closeSheet();}));}
function appearanceSettingsPanel(){
  drawer(false);const body=sheet('外观与界面');let draft={...appearanceSettings};
  body.append(text('p','默认白底黑字。可以切换模式，或自己修改颜色、字号和圆角；预览后保存，关闭面板会撤销未保存的预览。','muted'));
  const modes=text('div','','appearanceModes');const edits=text('div','','appearanceFields');const buttons=[];
  const preview=()=>{const value=appearance(draft);appearancePreview=true;showAppearance(value);};
  const updateMode=()=>{edits.hidden=draft.mode!=='custom';for(const [mode,item] of buttons)item.setAttribute('aria-pressed',String(mode===draft.mode));};
  for(const [mode,label] of [['light','白底黑字'],['dark','深色'],['system','跟随系统'],['custom','自定义']]){const item=button(label,()=>{draft.mode=mode;updateMode();preview();});buttons.push([mode,item]);modes.append(item);}body.append(modes);
  for(const [key,label] of [['background','背景色'],['foreground','文字色'],['accent','按钮与强调色']]){const input=field(edits,label,draft[key],'text','#ffffff');input.maxLength=7;input.spellcheck=false;input.oninput=()=>draft[key]=input.value.trim();}
  body.append(edits);updateMode();
  for(const [key,label,min,max,suffix] of [['fontSize','字号',12,22,'px'],['radius','圆角',0,24,'px']]){const title=text('label',label+' · '+draft[key]+suffix,'field');const slider=document.createElement('input');slider.type='range';slider.min=min;slider.max=max;slider.step=1;slider.value=draft[key];slider.className='appearanceSlider';slider.setAttribute('aria-label',label);slider.oninput=()=>{draft[key]=Number(slider.value);title.textContent=label+' · '+draft[key]+suffix;try{preview();}catch{}};body.append(title,slider);}
  const sample=text('div','','appearancePreview');sample.append(text('div','G code · 界面预览','role'),text('p','你好，按你喜欢的样子使用 G code。','sampleBubble'),text('p','这段文字会跟随字号、背景色和文字色改变。'));body.append(sample);
  const actions=text('div','','appearanceActions');actions.append(button('预览',preview),button('保存外观',()=>{const value=appearance(draft);storage.setItem('appearance',JSON.stringify(value));appearanceSettings=value;appearancePreview=false;showAppearance();closeSheet();toast('外观已保存');},'primary'));body.append(actions);
  body.append(button('恢复白底黑字',()=>{appearanceSettings={...defaultAppearance};storage.setItem('appearance',JSON.stringify(appearanceSettings));appearancePreview=false;showAppearance();closeSheet();toast('已恢复默认外观');}));
}
function configuration(){const config=native?JSON.parse(native.settings()):{};return {version:2,providers:config.providers??[],defaultModel:config.defaultModel??null};}
function saveConfiguration(config){if(state.loading||state.creating||state.status?.active.length||state.status?.mediaSubmitting)throw new Error('请先等待所有任务完成或停止，再修改 API 服务');if(!native)throw new Error('请在 Android 应用中保存设置');const error=native.saveSettings(JSON.stringify(config));if(error)throw new Error(error);closeSheet();toast('配置已保存，正在连接…');}
function settings(){
  drawer(false);const config=configuration();const body=sheet('API 服务与模型');body.append(text('p','可以保存多个中转站，每个服务添加多个模型。聊天时点击顶部模型名称即可切换。','muted'));
  for(const provider of config.providers){const card=text('div','','card');card.append(button(provider.name,()=>editProvider(provider.id)),text('p',[provider.models?.length?'对话：'+provider.models.join(' · '):'',provider.imageModels?.length?'生图：'+provider.imageModels.join(' · '):'',provider.videoModels?.length?'视频：'+provider.videoModels.join(' · '):''].filter(Boolean).join(' / '),'muted'));body.append(card);}
  body.append(button('ChatGPT 账号登录',chatgptSettings));
  body.append(button('＋ 添加 API 服务',()=>editProvider(),'primary sheetAction'),text('p','每个服务分别保存地址、接口类型和 API Key。留空保留该服务的原密钥。','muted'));
}
function modelListField(body,label,values){body.append(text('label',label,'field'));const input=document.createElement('textarea');input.className='modelIds';input.rows=3;input.value=values.join('\n');input.setAttribute('aria-label',label);body.append(input);return input;}
function editProvider(id){
  const config=configuration();const saved=config.providers.find(p=>p.id===id)??{id:'p_'+crypto.randomUUID().replaceAll('-',''),name:'',models:[]};const body=sheet(id?'编辑 API 服务':'添加 API 服务');
  const name=field(body,'服务名称',saved.name,'text','例如：我的中转站');const base=field(body,'API 地址',saved.base||'','url','https://example.com/v1');const key=field(body,'API Key','','password',saved.hasKey?'已保存；留空保留原密钥':'填写服务商提供的 API Key');
  body.append(text('label','对话模型 ID（每行一个）','field'));const models=document.createElement('textarea');models.className='modelIds';models.setAttribute('aria-label','模型 ID，每行一个');models.rows=5;models.value=saved.models.join('\n');models.placeholder='model-a\nmodel-b';models.spellcheck=false;body.append(models);const imageModels=modelListField(body,'生图模型 ID（可留空，每行一个）',saved.imageModels??[]);const videoModels=modelListField(body,'视频模型 ID（可留空，每行一个）',saved.videoModels??[]);body.append(text('p','按服务商提供的准确 ID 填写；可在聊天顶部切换。模型需要支持工具调用。','muted'));
  const protocol={value:saved.protocol||'chat'};for(const [value,label] of [['chat','Chat Completions'],['responses','Responses']]){const line=text('label','','choice');const radio=document.createElement('input');radio.type='radio';radio.name='protocol';radio.checked=protocol.value===value;radio.onchange=()=>protocol.value=value;line.append(radio,text('span',label));body.append(line);}
  const http=text('label','','choice');const allow=document.createElement('input');allow.type='checkbox';allow.checked=!!saved.allowHttp;http.append(allow,text('span','允许 HTTP（仅用于可信服务）'));body.append(http);
  const clearLine=text('label','','choice');const clear=document.createElement('input');clear.type='checkbox';clearLine.append(clear,text('span','清除该服务已保存的 API Key'));body.append(clearLine);
  body.append(button('保存服务',()=>{const provider={id:saved.id,name:name.value.trim(),base:base.value.trim(),models:[...new Set(models.value.split(/[\n\r]+/).map(value=>value.trim()).filter(Boolean))],imageModels:imageModels.value.split(/[\n\r]+/).map(value=>value.trim()).filter(Boolean),videoModels:videoModels.value.split(/[\n\r]+/).map(value=>value.trim()).filter(Boolean),key:key.value,protocol:protocol.value,allowHttp:allow.checked,clearKey:clear.checked};const position=config.providers.findIndex(p=>p.id===saved.id);if(position<0)config.providers.push(provider);else config.providers[position]=provider;saveConfiguration(config);},'primary sheetAction'));
  if(id)body.append(button('删除这个 API 服务',()=>{const confirm=sheet('删除 API 服务？');confirm.append(text('p','会移除该服务的模型和本机 API Key。已有对话记录会保留，可改用其他服务继续。'),button('确认删除',()=>{config.providers=config.providers.filter(p=>p.id!==id);saveConfiguration(config);},'danger sheetAction'),button('取消',settings));},'danger'));
  body.append(text('p','API Key 由 Android Keystore 加密保存在本机；不会显示在模型列表中。','muted'));
}
const mediaCards=new Map();
function retainMedia(jobs){const ids=new Set(jobs.map(job=>job.id));for(const id of mediaCards.keys())if(!ids.has(id))mediaCards.delete(id);}
function mediaCard(job){const signature=JSON.stringify(job);const cached=mediaCards.get(job.id);if(cached?.signature===signature)return cached.element;
  const card=text('article','','card mediaCard');card.append(text('h3',job.kind==='image'?'生成图片':'生成视频'),text('p',job.prompt,'text'),text('p',job.providerName+' / '+job.model,'muted'),text('p',({submitting:'正在提交',queued:'已排队',in_progress:'正在生成',downloading:'正在下载',completed:'已完成',failed:'生成失败',interrupted:'连接中断',paused:'查询已暂停'})[job.status]||job.status,'muted'));
  if(job.remoteId)card.append(text('p','任务 ID：'+job.remoteId,'muted'));if(job.progress&&job.status!=='completed')card.append(text('p',job.progress+'%','muted'));if(job.error)card.append(text('p',job.error,'error'));
  for(const file of job.files??[]){const element=document.createElement(file.mime.startsWith('video/')?'video':'img');element.src='asset/'+file.filename;element.className='mediaPreview';if(file.mime.startsWith('video/')){element.controls=true;element.preload='metadata';}else{element.alt=job.prompt;element.loading='lazy';element.decoding='async';}card.append(element);if(native)card.append(button('保存到手机',()=>native.saveMedia(file.filename)));}
  if(job.remoteId&&job.status!=='completed')card.append(button('刷新原任务',async()=>{await rpc('mediaRefresh',{id:job.id,sessionID:job.sessionID});toast('已查询原任务，不会重新提交生成');}));mediaCards.set(job.id,{signature,element:card});return card;
}
let mediaSignature='';
async function renderMedia(force=false){const jobs=await rpc('mediaJobs');if(state.tab!=='media')return;const signature=JSON.stringify(jobs);if(!force&&signature===mediaSignature)return;mediaSignature=signature;const root=$('timeline');if(force||!root.querySelector('.mediaActions')){root.replaceChildren();const controls=text('div','','mediaActions');controls.append(button('生成图片',()=>generationForm('image')),button('生成视频',()=>generationForm('video')));root.append(controls);}const keep=new Set();for(const job of jobs){const id='job_'+job.id;keep.add(id);const previous=document.getElementById(id);const card=mediaCard(job);card.id=id;if(previous&&previous!==card)previous.replaceWith(card);else if(!previous)root.append(card);}for(const item of root.querySelectorAll('.mediaCard'))if(!keep.has(item.id))item.remove();if(!jobs.length&&!root.querySelector('.mediaEmpty'))root.append(text('p','生成任务和结果会显示在这里。先在 API 服务中设置生图或视频模型。','muted mediaEmpty'));if(jobs.length)root.querySelector('.mediaEmpty')?.remove();retainMedia(jobs);}
async function generationForm(kind){
  const options=await rpc('mediaOptions');const fieldName=kind+'Models';const choices=options.flatMap(provider=>(provider[fieldName]??[]).map(model=>({providerID:provider.id,model,label:provider.name+' / '+model})));const body=sheet(kind==='image'?'生成图片':'生成视频');
  if(!choices.length){body.append(text('p','先在 API 服务中填写独立的'+(kind==='image'?'生图':'视频')+'模型 ID。普通对话模型不会自动用于此接口。'),button('去配置 API 服务',settings));return;}
  const label=text('label','服务与模型','field');const select=document.createElement('select');select.className='mediaSelect';select.setAttribute('aria-label','生成服务与模型');choices.forEach((choice,index)=>{const option=text('option',choice.label);option.value=index;select.append(option);});body.append(label,select,text('label','描述你想生成的内容','field'));const prompt=document.createElement('textarea');prompt.className='modelIds';prompt.rows=4;prompt.setAttribute('aria-label','生成描述');body.append(prompt);const size=field(body,'尺寸（可留空，按服务默认值）','','text',kind==='image'?'例如 1024x1024':'例如 1280x720');let seconds;
  if(kind==='video'){body.append(text('label','时长','field'));seconds=document.createElement('select');seconds.className='mediaSelect';for(const value of ['4','8','12']){const option=text('option',value+' 秒');option.value=value;seconds.append(option);}body.append(seconds);}
  body.append(text('p',kind==='image'?'使用 Images Generations 接口；请填写该站实际支持的生图模型。':'使用 OpenAI Videos 接口，支持排队、查询进度和保存 MP4。中转站使用其他视频协议时需要另行适配。','muted'));
  const start=button('开始生成',async()=>{if(!prompt.value.trim())throw new Error('请先填写生成描述');start.disabled=true;try{const choice=choices[Number(select.value)];const sessionID=await ensureSession();if(!sessionID)throw new Error('请先选择或创建对话');await rpc('generateMedia',{sessionID,kind,prompt:prompt.value,...choice,size:size.value.trim(),...(seconds?{seconds:seconds.value}:{})});closeSheet();await selectTab('media');}finally{start.disabled=false;}},'primary sheetAction');body.append(start);
}
function phoneStatus(){if(!native)return {enabled:false,active:false,reason:'请在 Android 应用中使用'};try{return JSON.parse(native.phoneStatus());}catch{return {enabled:false,active:false,reason:'手机控制暂不可用'};}}
function refreshPhone(){const status=phoneStatus();$('phoneBar').hidden=!status.active;$('phoneLabel').textContent=status.active?'全设备控制 · 剩余 '+Math.ceil(status.remainingMs/60000)+' 分钟':'';}
async function phoneControl(){
  drawer(false);const status=phoneStatus();const body=sheet('手机控制');
  body.append(text('p',status.enabled?'无障碍服务已连接':'先启用 G code 手机控制无障碍服务'),text('p',status.active?'当前已授权：全设备界面控制':status.reason,'muted'));
  body.append(text('p','授权后，AI 可以查看可启动应用、跨应用打开和操作页面，读取控件与截图，点击、长按、输入、滑动，以及操作桌面、多任务、通知栏和快捷设置。页面及截图可能包含个人信息，会发送给你选择的 AI 服务并保存在本机会话中。'));
  body.append(text('p','不限定应用。每次为当前会话开启 15 分钟或 300 步，可随时点击悬浮停止按钮。截图操作需要支持视觉和工具调用的模型。不能绕过锁屏或应用保护；最终付款、下单、密码及系统授权由你操作。升级后若截图或手势不可用，请在系统中关闭再开启此无障碍服务。'));
  if(!status.enabled)body.append(button('打开系统无障碍设置',()=>{if(native)native.phoneSettings();else toast('请在 Android 应用中设置');},'primary sheetAction'));
  body.append(button('刷新连接状态',phoneControl));
  const line=text('label','','choice');const consent=document.createElement('input');consent.type='checkbox';line.append(consent,text('span','我同意将当前可见页面及截图发送给已配置的 AI 服务，并为本次会话开启全设备界面控制'));body.append(line);
  body.append(button('为当前会话开启控制',async()=>{
    if(!native||!status.enabled){toast('请先启用无障碍服务，再刷新状态');return;}if(!consent.checked){toast('请先阅读并勾选授权说明');return;}if(!state.status?.configured){toast('请先配置支持工具调用的 API');return;}
    if(!state.session){if(!state.project){const info=await rpc('status');if(!info.projects.includes('手机助手'))await rpc('createProject',{name:'手机助手'});setProject('手机助手');}const sessionID=await newSession();if(!sessionID||state.session!==sessionID){toast('页面已切换，请重新开启控制');return;}}
    if(!state.session)return;const error=native.phoneGrant(state.session,'device');if(error){toast(error);return;}closeSheet();refreshPhone();toast('已开启。直接告诉 AI 要在哪些应用完成什么事。');
  },'primary sheetAction'));
  body.append(button('立即停止手机控制',()=>{if(native)native.phoneStop();refreshPhone();closeSheet();toast('已停止手机控制');}));
}
async function chatgptSettings(){
  drawer(false);const body=sheet('ChatGPT 账号');const note=text('p','正在读取登录状态…','muted');body.append(note);const info=await rpc('chatgptStatus');if(!note.isConnected)return;
  note.textContent=info.connected?'已保存 ChatGPT 授权。模型访问权限以实际请求结果为准。':'使用系统浏览器登录 OpenAI 官方账号，并授权使用 ChatGPT 订阅额度。';
  body.append(text('p','可用额度取决于账号、套餐及官方限制。此入口用于对话和本地工具；生图、视频仍使用创作页配置的 API。授权凭据保存在应用私有目录，不发给中转站。','muted'));
  if(info.attempt?.status==='pending'){
    body.append(text('p','等待浏览器授权。完成后返回这里，点击“检查登录结果”。'));
    body.append(button('重新打开授权页面',()=>openChatGPT(info.attempt.url)),button('检查登录结果',async()=>{await chatgptSettings();state.status=await rpc('status');if(!validModel(state.selection))rememberModel(state.status.defaultModel??null);}),button('取消本次登录',async()=>{await rpc('chatgptCancel');await chatgptSettings();}));
  }else{
    if(info.attempt?.status==='failed'||info.attempt?.status==='expired')body.append(text('p',info.attempt.message||'登录已过期，请重试。','error'));
    if(info.available)body.append(button('Continue with ChatGPT',async()=>{const result=await rpc('chatgptLogin');openChatGPT(result.attempt.url);await chatgptSettings();},'primary sheetAction'));
    else body.append(text('p','当前引擎未提供 ChatGPT 授权方式。','error'));
  }
  if(info.connected){
    body.append(button('选择 ChatGPT 模型',async()=>{state.status=await rpc('status');await chooseModel();}));
    body.append(button('退出 ChatGPT 账号',()=>{const confirm=sheet('退出 ChatGPT 账号？');confirm.append(text('p','删除本机保存的 ChatGPT 授权，保留对话和 API 设置。需先停止正在运行的任务。'),button('确认退出',async()=>{await rpc('chatgptLogout');state.status=await rpc('status');if(!validModel(state.selection))rememberModel(state.status.defaultModel??null);await chatgptSettings();},'danger'),button('取消',chatgptSettings));},'danger'));
  }
}
function openChatGPT(url){if(!native?.openChatGPT)throw new Error('请在新版 Android 应用中登录');const error=native.openChatGPT(url);if(error)throw new Error(error);}
function showUsage(tokens,label='会话用量'){
  const body=sheet(label);const usage=tokenUsage(tokens);body.append(text('h3',usageLabel(tokens)));
  if(usage)for(const [name,key] of [['输入（不含缓存）','input'],['输出（不含推理）','output'],['推理','reasoning'],['缓存读取','read'],['缓存写入','write']])body.append(text('p',name+'：'+usage[key].toLocaleString('zh-CN')));
  body.append(text('p','按服务返回、OpenCode 已记录的 token 统计。未上报用量的请求无法计入；会话累计包含 SDK 记录的自动标题、上下文压缩等额外请求。这不是账单或账号剩余额度。','muted'));
}
function forgetSession(id){for(const key of ['draft:','attachments:','attachment-job:'])storage.removeItem(key+id);if(state.session===id)clearSession();state.sessionRows='';}
async function batchSessions(){
  if(state.loading||state.creating)throw new Error('请等消息或会话创建完成');drawer(false);const body=sheet('批量删除对话');const marker=text('p','正在读取会话…','muted');body.append(marker);
  const result=await rpc('sessions');if(!marker.isConnected)return;marker.textContent='勾选需要删除的对话。全选仅针对下面显示的会话。';const items=(result.data??[]).filter(item=>!item.parentID);const selected=new Set(),boxes=[];const counter=text('p','已选 0 项','muted');body.append(counter);
  const update=()=>{counter.textContent='已选 '+selected.size+' / '+items.length+' 项';remove.disabled=!selected.size;};
  body.append(button('全选当前列表',()=>{for(const entry of boxes){entry.box.checked=true;selected.add(entry.id);}update();}),button('取消全选',()=>{selected.clear();for(const entry of boxes)entry.box.checked=false;update();}));
  for(const item of items){const row=text('label','','batchRow'),box=document.createElement('input');box.type='checkbox';box.onchange=()=>{if(box.checked)selected.add(item.id);else selected.delete(item.id);update();};row.append(box,text('span',titleOf(item)+' · '+usageLabel(item.tokens)));body.append(row);boxes.push({id:item.id,box});}
  const remove=button('删除所选对话',()=>{
    const ids=[...selected];const confirm=sheet('删除这 '+ids.length+' 段对话？');confirm.append(text('p','会停止所选对话的任务并删除记录，不能撤销。项目文件和已提交的生成任务保留。'));
    const proceed=button('确认删除',async()=>{
      proceed.disabled=true;cancel.disabled=true;const progress=text('p','正在删除…','muted');confirm.append(progress);
      const outcome=await deleteSelected(ids,id=>rpc('deleteSession',{sessionID:id}),id=>{forgetSession(id);progress.textContent='已删除 '+(++done)+' / '+ids.length;});
      await sessions();if(state.tab==='chat'&&!state.session)await selectTab('chat');
      const finished=sheet('批量删除结果');finished.append(text('p','成功删除 '+outcome.deleted.length+' 段，失败 '+outcome.failed.length+' 段。'));
      for(const item of outcome.failed)finished.append(text('p',(items.find(row=>row.id===item.id)?.title||'对话')+'：'+item.message,'error'));
      finished.append(button('完成',closeSheet));
    },'danger sheetAction');let done=0;const cancel=button('取消',batchSessions);confirm.append(proceed,cancel);
  },'danger sheetAction');remove.disabled=true;body.append(remove);
}

function about(){drawer(false);const body=sheet('关于 G code');body.append(text('h3','G code 0.13'),text('p','基于 OpenCode 2.0.32 的非官方 Android 移植，与 OpenCode 官方团队不存在隶属关系。'),text('p','本地运行原版 Core / SDK，支持接入 API、照片/视频抽帧/PDF/文本附件、独立生图与视频任务、会话、文件读取修改与修改预览。授权后支持跨应用控制、屏幕识别与手势操作；各应用的实际兼容性仍需真机验证。'),text('p','首版暂不提供完整 Git、命令终端、MCP 配置、语音入口。项目文件保存在应用内，卸载或清除应用数据会删除它们，请妥善保留重要文件。'),text('p','OpenCode · MIT License。运行时及依赖许可证随安装包提供。','muted'));}
$('chatgptAccount').onclick=()=>void chatgptSettings().catch(error=>toast(error.message));
$('batchSessions').onclick=()=>void batchSessions().catch(error=>toast(error.message));
$('usageButton').onclick=()=>showUsage(state.usage);
$('appearance').onclick=appearanceSettingsPanel;
$('taskRecovery').onclick=taskStatus;
$('modelButton').onclick=()=>void chooseModel().catch(error=>toast(error.message));
$('phoneControl').onclick=()=>void phoneControl().catch(error=>toast(error.message));$('phoneHalt').onclick=()=>{if(native)native.phoneStop();refreshPhone();toast('已停止手机控制');};
$('menu').onclick=()=>drawer(true);$('closeDrawer').onclick=()=>drawer(false);$('drawerShade').onclick=()=>drawer(false);$('closeSheet').onclick=closeSheet;$('sheetShade').onclick=closeSheet;
$('newSession').onclick=()=>void newSession().catch(error=>toast(error.message));$('chooseProject').onclick=()=>void chooseProject().catch(error=>toast(error.message));$('createProject').onclick=createProject;$('engineStatus').onclick=()=>{if(state.pending)showPermission(state.pending);else taskStatus();};$('settings').onclick=settings;$('apiButton').onclick=settings;$('about').onclick=about;$('send').onclick=()=>void send().catch(error=>toast(error.message));
$('input').addEventListener('input',()=>{storage.setItem('draft:'+state.session,$('input').value);$('input').style.height='auto';$('input').style.height=Math.min(140,$('input').scrollHeight)+'px';});
document.querySelectorAll('[data-tab]').forEach(item=>item.onclick=()=>void selectTab(item.dataset.tab).catch(error=>toast(error.message)));
let gripY=0;$('grip').addEventListener('touchstart',event=>{gripY=event.touches[0].clientY;},{passive:true});$('grip').addEventListener('touchend',event=>{if(event.changedTouches[0].clientY-gripY>45)closeSheet();},{passive:true});
let edgeX=0,edgeY=0;document.addEventListener('touchstart',event=>{edgeX=event.touches[0].clientX;edgeY=event.touches[0].clientY;},{passive:true});document.addEventListener('touchend',event=>{const dx=event.changedTouches[0].clientX-edgeX,dy=event.changedTouches[0].clientY-edgeY;if(Math.abs(dx)<65||Math.abs(dx)<Math.abs(dy)*1.4)return;if(edgeX<24&&dx>0)drawer(true);if($('drawer').classList.contains('open')&&dx<0)drawer(false);},{passive:true});
window.mobileBack=()=>{if($('sheet').classList.contains('open')){closeSheet();return true;}if($('drawer').classList.contains('open')){drawer(false);return true;}if(state.tab!=='chat'){void selectTab('chat');return true;}return false;};
window.mobileAttachments=loadAttachments;$('addAttachment').onclick=()=>void attachmentMenu().catch(error=>toast(error.message));window.mobileNotice=toast;
(async()=>{try{state.status=await rpc('status');let remembered;try{remembered=JSON.parse(storage.getItem('model')||'null');}catch{}rememberModel(validModel(remembered)?remembered:state.status.defaultModel??null);setProject(state.status.projects.includes(state.project)?state.project:state.status.projects[0]||'');const id=storage.getItem('session');if(id){const list=await rpc('sessions');const item=list.data.find(item=>item.id===id);if(item)await selectSession(item);else welcome();}else welcome();loadAttachments();}catch(error){toast(error.message);welcome();}void refresh();})();
