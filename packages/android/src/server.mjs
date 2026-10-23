import path from 'node:path';
import {jsonBody} from './http-body.mjs';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';

const directory=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.env.OPENCODE_MOBILE_ROOT??path.join(directory,'../build/mobile-home'));
await mkdir(root,{recursive:true});
for(const [key,folder] of Object.entries({HOME:'',XDG_DATA_HOME:'data',XDG_CONFIG_HOME:'config',XDG_STATE_HOME:'state',XDG_CACHE_HOME:'cache',TMPDIR:'tmp'})){
  process.env[key]=path.join(root,folder);await mkdir(process.env[key],{recursive:true});
}
process.env.SHELL='/system/bin/sh';process.env.OPENCODE_NODE_PTY_PATH=path.join(directory,'pty.cjs');
const settings=JSON.parse(process.env.OPENCODE_MOBILE_SETTINGS??'{}');delete process.env.OPENCODE_MOBILE_SETTINGS;
const token=process.env.OPENCODE_MOBILE_TOKEN;if(!token||token.length<32)throw new Error('Missing private app token');delete process.env.OPENCODE_MOBILE_TOKEN;
const {DeviceBridge}=await import('./device.mjs');
const deviceToken=process.env.OPENCODE_DEVICE_TOKEN??'';delete process.env.OPENCODE_DEVICE_TOKEN;
const device=new DeviceBridge(process.stdin,process.stdout,deviceToken);
let deployment;try{deployment=JSON.parse(await readFile(path.join(directory,'../config/platform.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;deployment={};}
const {MobileEngine}=await import('./engine.mjs');const engine=await MobileEngine.create(root,settings,device,deployment);
const prefix='/m/'+token+'/';
const keys=[settings.key,...(settings.providers??[]).map(item=>item.key)].filter(Boolean);
const clean=error=>keys.reduce((text,key)=>text.replaceAll(key,'[API Key 已隐藏]'),String(error?.message??error)).slice(0,1200);
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const incoming=url.pathname.slice(0,prefix.length);const valid=incoming.length===prefix.length&&timingSafeEqual(Buffer.from(incoming),Buffer.from(prefix));
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  if(!valid){res.writeHead(403);res.end('Forbidden');return;}
  try{
    const route=url.pathname.slice(prefix.length);
    if(route==='rpc'&&req.method==='POST'){
      const input=await jsonBody(req);const result=await engine.action(input.action,input.input??{});
      res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({data:result??null}));return;
    }
    if(route.startsWith('asset/')&&['GET','HEAD'].includes(req.method)){
      const item=await engine.media.asset(route.slice(6));const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');const start=match?Number(match[1]):0;const end=match&&match[2]?Math.min(Number(match[2]),item.size-1):item.size-1;
      if(start>end||start>=item.size){res.writeHead(416,{'Content-Range':'bytes */'+item.size});res.end();return;}
      res.writeHead(match?206:200,{'Content-Type':item.mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(match?{'Content-Range':'bytes '+start+'-'+end+'/'+item.size}:{})});if(req.method==='HEAD')res.end();else createReadStream(item.path,{start,end}).pipe(res);return;
    }
    if(route.startsWith('attachment/')&&req.method==='GET'){const item=await engine.attachments.preview(route.slice(11));if(!item.mime.startsWith('image/'))throw new Error('仅预览图片附件');res.writeHead(200,{'Content-Type':item.mime});res.end(item.data);return;}
    const names={'':'index.html','index.html':'index.html','app.js':'app.js','request.js':'request.js','drafts.js':'drafts.js','usage.js':'usage.js','render-cache.js':'render-cache.js','appearance.js':'appearance.js','style.css':'style.css'};
    if(req.method!=='GET'||!Object.hasOwn(names,route)){res.writeHead(404);res.end();return;}
    const file=names[route];res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
    res.end(await readFile(path.join(directory,'../web',file)));
  }catch(error){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:clean(error)}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
console.log('MOBILE_READY '+JSON.stringify({port:server.address().port,path:prefix,core:'2.0.32'}));
const stop=async()=>{server.close();server.closeAllConnections();device.close();await engine.close();process.exit(0);};
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
