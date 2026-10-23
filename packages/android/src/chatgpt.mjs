// The original SDK owns PKCE, callback validation, credential storage and renewal.
export class ChatGPTAccount {
  constructor(sdk,root){this.sdk=sdk;this.location={location:{directory:root}};this.attempt=null;this.connecting=false;this.models=[];this.connections=[];this.available=false;}
  async refresh(){
    const result=await this.sdk.integration.list(this.location);const info=result.data.find(item=>item.id==='openai');
    if(!info){this.available=false;this.connections=[];this.models=[];return this.status();}
    this.available=info.methods.some(item=>item.id==='chatgpt-token-sharing');
    this.connections=info.connections.filter(item=>item.type==='credential'&&item.method==='oauth');
    const models=this.connections.length?(await this.sdk.model.list(this.location)).data:[];
    this.modelDetails=models.filter(item=>item.providerID==='openai'&&item.enabled!==false);this.models=this.modelDetails.map(item=>item.id);
    return this.status();
  }
  status(){return {available:this.available,connected:!!this.connections.length,models:this.models,attempt:this.attempt,accounts:this.connections.map(item=>({id:item.id,label:item.label,status:item.status?.status}))};}
  async start(){
    if(this.connecting)throw new Error('登录正在启动，请稍候');this.connecting=true;
    try{
      await this.cancel();const result=await this.sdk.integration.oauth.connect({...this.location,integrationID:'openai',methodID:'chatgpt-token-sharing',label:'G code · ChatGPT'});
      const attempt=result.data;const url=new URL(attempt.url);
      if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize')throw new Error('登录地址不是受支持的 OpenAI 官方授权页面');
      // Dynamic registration must identify this app rather than the SDK's default name.
      if(url.searchParams.has('agent_name_hint'))url.searchParams.set('agent_name_hint','G code');
      this.attempt={id:attempt.attemptID,url:url.href,expires:attempt.time.expires,status:'pending'};return this.status();
    }finally{this.connecting=false;}
  }
  async poll(){
    if(this.attempt?.status==='pending'){
      const attempt=this.attempt;const result=await this.sdk.integration.oauth.status({...this.location,integrationID:'openai',attemptID:attempt.id});if(this.attempt!==attempt)return this.status();this.attempt={...attempt,status:result.data.status};
      if(result.data.status==='failed')this.attempt.message='登录未完成，请重新登录并确认订阅授权。';
    }
    return this.refresh();
  }
  async cancel(){if(this.attempt?.status==='pending')await this.sdk.integration.oauth.cancel({...this.location,integrationID:'openai',attemptID:this.attempt.id});this.attempt=null;}
  async logout(){await this.cancel();await this.refresh();for(const item of this.connections)await this.sdk.credential.remove({credentialID:item.id});await this.refresh();}
}
