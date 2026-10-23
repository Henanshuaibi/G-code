// A one-time, IP-bound challenge raises bulk registration cost without an external CAPTCHA service.
export async function registrationProof(challenge){
 if(challenge.difficulty!==14||typeof challenge.nonce!=='string')throw new Error('注册校验格式不正确');
 const encoder=new TextEncoder();for(let counter=0;counter<=8000000;counter++){
  if(Date.now()>=challenge.expires_at)throw new Error('注册校验已过期，请重试');
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(challenge.nonce+':'+counter)));
  if(hash[0]===0&&(hash[1]&252)===0)return {id:challenge.id,counter};
 }
 throw new Error('注册校验未完成，请稍后重试');
}
