// Timeouts abort the actual fetch. Mutations are never automatically retried.
export async function request(url,action,input={},timeoutMs=action==='prompt'?40000:20000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input}),signal:controller.signal});
    const data=await response.json();if(data.error)throw new Error(data.error);if(!response.ok)throw new Error('本地引擎请求失败（'+response.status+'）');return data.data;
  }catch(error){if(controller.signal.aborted)throw new Error(action==='prompt'?'提交等待超时，任务可能已受理。请先查看任务状态，不要重复发送。':'本地引擎响应超时。可以停止任务，或在任务状态面板重启引擎。');throw error;}
  finally{clearTimeout(timer);}
}
