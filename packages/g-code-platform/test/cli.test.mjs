import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {configuration} from '../src/config.mjs';

test('documented CLI migration, one-time administrator initialization, server health/static UI and graceful shutdown',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'gcode-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const passwordFile=path.join(root,'password.txt');await writeFile(passwordFile,'cli-password-fixture',{mode:0o600});
 const env={...process.env,GCODE_MASTER_KEY:randomBytes(32).toString('base64'),GCODE_DB:path.join(root,'platform.db'),GCODE_PORT:'0',GCODE_HOST:'127.0.0.1',GCODE_PUBLIC_ORIGIN:'http://127.0.0.1',GCODE_PRODUCTION:'false',GCODE_ALLOW_LOOPBACK_UPSTREAM:'true',GCODE_DAILY_COST_LIMIT_MICROS:'1000000',GCODE_ADMIN_USERNAME:'cli-admin',GCODE_ADMIN_PASSWORD_FILE:passwordFile};
 const cli=async action=>{const child=spawn(process.execPath,['src/cli.mjs',action],{env,stdio:['ignore','pipe','pipe']});let out='',error='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>error+=chunk);const [code]=await once(child,'exit');return {code,out,error};};
 assert.equal((await cli('migrate')).code,0);assert.equal((await cli('migrate')).code,0);
 const admin=await cli('admin');assert.equal(admin.code,0,admin.error);assert(!admin.out.includes('cli-password-fixture'));assert.notEqual((await cli('admin')).code,0);
 const child=spawn(process.execPath,['src/main.mjs'],{env,stdio:['ignore','pipe','pipe']});const exited=once(child,'exit');t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const ready=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',chunk=>{text+=chunk;for(const line of text.split('\n')){try{const entry=JSON.parse(line);if(entry.event==='listening')resolve(entry.address);}catch{}}});child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited before startup: '+code)));});
 assert.deepEqual(await fetch(ready+'/health').then(response=>response.json()),{ok:true});assert.match(await fetch(ready).then(response=>response.text()),/G Code/);
 const catalog=await fetch(ready+'/api/catalog').then(response=>response.json());assert.equal(catalog.models.length,2);assert(catalog.models.every(model=>model.sale_price===null&&!model.available));
 assert.match(await fetch(ready+'/app.js').then(response=>response.text()),/admin\/channels/);
 child.kill('SIGTERM');assert.equal((await exited)[0],0);
 const store=new Store(configuration(env));try{assert.equal(store.get('SELECT COUNT(*) AS n FROM schema_migrations').n,3);assert.equal(store.get("SELECT COUNT(*) AS n FROM users WHERE role='admin'").n,1);assert.equal(store.get('SELECT COUNT(*) AS n FROM worker').n,0);}finally{store.close();}
});
