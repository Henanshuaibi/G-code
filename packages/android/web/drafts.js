// Reconcile only the content acknowledged by this submission. A newer draft stays intact.
export function settleSubmission(storage,scope,sent){
  const key='draft:'+scope;
  if(storage.getItem(key)===sent.text)storage.removeItem(key);
  let attachments=[];try{const value=JSON.parse(storage.getItem('attachments:'+scope)||'[]');if(Array.isArray(value))attachments=value;}catch{}
  const ids=new Set(sent.attachments);const remaining=attachments.filter(item=>!ids.has(item.id));
  if(remaining.length)storage.setItem('attachments:'+scope,JSON.stringify(remaining));else storage.removeItem('attachments:'+scope);
  return {text:storage.getItem(key)||'',attachments:remaining};
}
