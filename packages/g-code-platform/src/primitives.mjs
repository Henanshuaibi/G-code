import {randomBytes,createCipheriv,createDecipheriv,createHmac,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export class Fault extends Error {
 constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
export function requireThat(value,status,code,message){if(!value)throw new Fault(status,code,message);}
export function integer(value,name,min=0,max=1_000_000_000_000){requireThat(Number.isSafeInteger(value)&&value>=min&&value<=max,400,'invalid_parameter',`${name} 必须是 ${min}～${max} 的整数`);return value;}
export function string(value,name,max=200){requireThat(typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value),400,'invalid_parameter',`${name} 格式不正确`);return value.trim();}
export function secret(){return randomBytes(32).toString('base64url');}
export function masterKey(value){const key=Buffer.from(value??'','base64');requireThat(key.length===32,500,'configuration','GCODE_MASTER_KEY 必须配置为 32 字节随机主密钥的 Base64');return key;}
export function digest(key,value){return createHmac('sha256',key).update(value).digest('hex');}
export function encrypt(key,value,context){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(item=>item.toString('base64')).join('.');}
export function decrypt(key,value,context){const [iv,tag,data]=value.split('.').map(item=>Buffer.from(item,'base64'));const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');}
export async function hashPassword(password){requireThat(typeof password==='string'&&password.length>=10&&Buffer.byteLength(password)<=1024,400,'invalid_password','密码须至少 10 个字符，最多 1024 字节');const salt=randomBytes(16);const hash=await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return `scrypt$32768$${salt.toString('base64')}$${hash.toString('base64')}`;}
export async function verifyPassword(password,encoded){if(typeof password!=='string'||Buffer.byteLength(password)>1024)return false;const [,n,salt,hash]=encoded.split('$');const actual=await derive(password,Buffer.from(salt,'base64'),64,{N:Number(n),r:8,p:1,maxmem:64*1024*1024});const expected=Buffer.from(hash,'base64');return expected.length===actual.length&&timingSafeEqual(expected,actual);}
export function price(value,sale=false){
 requireThat(value&&typeof value==='object',400,'price_unconfigured','价格未配置');
 requireThat(sale?value.currency==='CNY':['CNY','USD'].includes(value.currency),400,'invalid_currency','销售币种仅支持 CNY；采购币种支持 CNY/USD');
 const result={currency:value.currency};for(const key of ['input','output','cache_read','cache_write'])result[key]=integer(value[key],`${key} 每百万 token 的微货币价格`);
 result.fx_cny_micros=value.currency==='CNY'?1_000_000:integer(value.fx_cny_micros,'每单位采购货币折合微 CNY',1,100_000_000);
 return result;
}
export function charge(rates,usage){let sum=0n;for(const key of ['input','output','cache_read','cache_write'])sum+=BigInt(rates[key])*BigInt(usage[key]);const total=(sum+999999n)/1000000n;requireThat(total<=1_000_000_000_000n,400,'amount_limit','单笔金额超过限制');return Number(total);}
export function upperBound(rates,input,output){return charge({...rates,input:Math.max(rates.input,rates.cache_read,rates.cache_write)},{input,output,cache_read:0,cache_write:0});}
export function toCny(amount,rates){return Number((BigInt(amount)*BigInt(rates.fx_cny_micros)+999999n)/1000000n);}
export function usageSchema(value){
 requireThat(value&&typeof value==='object'&&typeof value.input_includes_cache==='boolean',400,'invalid_usage_schema','必须确认缓存 token 是否包含在总输入中');
 const result={input_includes_cache:value.input_includes_cache};
 for(const field of ['input','output','cache_read','cache_write']){const path=value[field]??null;requireThat(path===null||typeof path==='string'&&/^[a-zA-Z_][a-zA-Z_0-9]*(\.[a-zA-Z_][a-zA-Z_0-9]*)*$/.test(path)&&path.length<=180,400,'invalid_usage_schema','用量字段路径不正确');result[field]=path;}
 requireThat(result.input&&result.output&&value.output_includes_reasoning===true,400,'invalid_usage_schema','须确认总输出包含推理 token；暂不支持推理输出额外计价');result.output_includes_reasoning=true;return result;
}
export function readUsage(raw,schema){
 if(!raw||typeof raw!=='object')return null;
 const result={};for(const field of ['input','output','cache_read','cache_write']){const path=schema[field];const value=path?path.split('.').reduce((item,part)=>item?.[part],raw):0;if(!Number.isSafeInteger(value)||value<0||value>100_000_000)return null;result[field]=value;}
 if(schema.input_includes_cache)result.input-=result.cache_read+result.cache_write;
 if(result.input<0)return null;return result;
}
export function upstreamURL(value,allowLoopback){
 const url=new URL(string(value,'Base URL',1000));requireThat(!url.username&&!url.password&&!url.search&&!url.hash,400,'invalid_url','Base URL 不得包含凭据、查询或片段');
 requireThat(url.protocol==='https:'||(allowLoopback&&url.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(url.hostname)),400,'invalid_url','上游必须使用 HTTPS；HTTP 只允许显式开启的本机模拟服务');return url.href.replace(/\/+$/,'');
}
export function redact(value,secrets){
 const clean=item=>{if(typeof item==='string'){for(const key of secrets)if(key)item=item.replaceAll(key,'[redacted]');return item;}if(Array.isArray(item))return item.map(clean);if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,data])=>[clean(key),clean(data)]));return item;};
 return typeof value==='string'?clean(value):JSON.stringify(clean(value));
}
