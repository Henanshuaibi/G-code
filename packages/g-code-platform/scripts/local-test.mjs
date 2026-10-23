import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createPlatform} from '../src/server.mjs';
import {hashPassword} from '../src/primitives.mjs';
process.umask(0o077);
const root=path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))),'data/local-test');await mkdir(root,{recursive:true,mode:0o700});
const keyFile=path.join(root,'master-key');let key;try{key=Buffer.from((await readFile(keyFile,'utf8')).trim(),'base64');}catch(error){if(error.code!=='ENOENT')throw error;key=randomBytes(32);await writeFile(keyFile,key.toString('base64'),{mode:0o600,flag:'wx'});}
const port=Number(process.env.GCODE_TEST_PORT??8787),app=await createPlatform({db:path.join(root,'platform.db'),key,host:'127.0.0.1',port,origin:'http://127.0.0.1:'+port,production:false,allowLoopback:false,registration:true,dailyCostLimit:1000000000,userRpm:30,userConcurrency:2,authConcurrency:2,maxAttempts:3,routeDeadline:60000,disclosure:'本机账号与计费服务，尚未部署公网。平台模型只使用管理员配置的真实渠道；渠道、能力或价格未配置时不可用，不提供模拟回复。现有余额为本机测试余额。自填 Key 独立使用。'},entry=>process.stdout.write(JSON.stringify(entry)+'\n'));
try{
 let owner=app.store.get('SELECT * FROM users WHERE is_owner=1');
 if(!owner){if(!process.env.GCODE_ADMIN_USERNAME||!process.env.GCODE_ADMIN_PASSWORD_FILE)throw new Error('首次启动请设置 GCODE_ADMIN_USERNAME 和私有 GCODE_ADMIN_PASSWORD_FILE');const passwordFile=process.env.GCODE_ADMIN_PASSWORD_FILE;owner=app.store.createUser(process.env.GCODE_ADMIN_USERNAME,await hashPassword((await readFile(passwordFile,'utf8')).trimEnd()),'admin');await rm(passwordFile,{force:true});}
 app.store.tx(()=>{
  // Retire the old demonstration routes without changing user-created channels or historical bills.
  app.store.run("UPDATE channels SET enabled=0 WHERE id IN ('local_mock_primary','local_mock_backup')");app.store.run("UPDATE mappings SET enabled=0,verified=0 WHERE channel_id IN ('local_mock_primary','local_mock_backup')");
  if(!app.store.get("SELECT id FROM audit WHERE action='simulation_prices_retired' LIMIT 1")){
   // price() normalizes CNY with an FX field. Match fields, not serialized property order.
   for(const model of app.store.all('SELECT * FROM models WHERE price_version=1')){const price=model.sale_price?JSON.parse(model.sale_price):null;if(price?.currency==='CNY'&&price.input===1000000&&price.output===1000000&&price.cache_read===0&&price.cache_write===0&&(price.fx_cny_micros===undefined||price.fx_cny_micros===1000000))app.store.run('UPDATE models SET sale_price=NULL,enabled=0,price_version=price_version+1 WHERE id=?',model.id);}
   app.store.audit(owner.id,'simulation_prices_retired','local-service','停用演示线路和未修改的演示售价；保留账号、用户配置与历史价格快照');
  }
 });
 await writeFile(path.join(root,'service.pid'),String(process.pid)+'\n',{mode:0o600});console.log(JSON.stringify({event:'local_service_ready',address:app.url,notice:'No simulated model routes. Configure real mappings, capabilities and prices before use.'}));
}catch(error){await app.close();throw error;}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
