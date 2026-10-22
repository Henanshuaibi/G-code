// A projection of actual SDK execution events; model/tool execution stays in the SDK.
export class RunState {
  constructor(onChange=()=>{},idleMs=480000){this.items=new Map();this.permissions=new Map();this.onChange=onChange;this.idleMs=idleMs;}
  start(id,now=Date.now()){this.permissions.delete(id);const item={sessionID:id,phase:'waiting_model',label:'等待模型响应',started:now,updated:now,active:true};this.items.set(id,item);this.onChange({...item});return item;}
  update(id,phase,label,now=Date.now()){
    const item=this.items.get(id);if(!item||!item.active)return;
    const changed=item.phase!==phase||now-item.updated>=750;Object.assign(item,{phase,label,updated:now});if(changed)this.onChange({...item});
  }
  finish(id,phase='completed',label='任务已结束',now=Date.now()){
    const item=this.items.get(id);if(!item||!item.active)return;this.permissions.delete(id);Object.assign(item,{phase,label,updated:now,active:false});this.onChange({...item});
  }
  consume(event,now=Date.now()){
    const id=event.data?.sessionID;if(!this.items.get(id)?.active)return;
    const type=event.type;
    if(type==='permission.asked'){const pending=this.permissions.get(id)??new Set();pending.add(event.data.id);this.permissions.set(id,pending);return this.update(id,'permission','等待你确认，请返回 G code',now);}
    if(type==='permission.replied'){const pending=this.permissions.get(id);pending?.delete(event.data.requestID);return this.update(id,pending?.size?'permission':'waiting_model',pending?.size?'等待你确认，请返回 G code':'继续处理任务',now);}
    if(type==='session.execution.succeeded')return this.finish(id,'completed','任务已结束',now);
    if(type==='session.execution.failed')return this.finish(id,'failed','任务失败，请查看对话中的原因',now);
    if(type==='session.execution.interrupted')return this.finish(id,'stopped','任务已停止',now);
    if(this.permissions.get(id)?.size)return;
    if(type==='session.retry.scheduled')return this.update(id,'retry','服务响应异常，SDK 正在重试',now);
    if(type.startsWith('session.reasoning.'))return this.update(id,'thinking','模型正在思考',now);
    if(type.startsWith('session.text.'))return this.update(id,'replying','模型正在回复',now);
    if(type.startsWith('session.compaction.'))return this.update(id,'compacting','正在整理上下文',now);
    if(type==='session.tool.input.started'||type==='session.tool.input.delta')return this.update(id,'planning','模型正在准备操作',now);
    if(type==='session.tool.called'||type==='session.tool.progress')return this.update(id,'tool','正在执行工具操作',now);
    if(type==='session.tool.success'||type==='session.tool.failed'||type==='session.step.started')return this.update(id,'waiting_model','等待模型决定下一步',now);
  }
  stalled(now=Date.now()){
    const ids=[];for(const item of this.items.values()){if(!item.active||item.phase==='permission'||now-item.updated<this.idleMs)continue;ids.push(item.sessionID);this.finish(item.sessionID,'stalled','长时间没有响应，已请求停止；请检查网络或服务后继续',now);}return ids;
  }
  snapshot(now=Date.now()){return Object.fromEntries([...this.items].map(([id,item])=>[id,{...item,quietMs:Math.max(0,now-item.updated)}]));}
}
