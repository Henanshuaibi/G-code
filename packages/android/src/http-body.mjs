export async function jsonBody(stream,limit=131072){
  const parts=[];let bytes=0;
  for await(const part of stream){bytes+=part.length;if(bytes>limit)throw new Error('请求过大');parts.push(part);}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
