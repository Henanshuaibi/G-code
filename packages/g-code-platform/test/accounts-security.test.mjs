import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {registrationProof} from '../web/registration.js';

test('highest owner alone assigns roles; staff cannot modify owner; new registration cannot self-promote',async t=>{
 const f=await fixture(t);assert.equal(f.store.publicUser(f.store.user(f.admin.id)).is_owner,true);assert.equal(f.store.publicUser(f.store.user(f.user.id)).is_owner,false);
 assert.equal((await f.request('/api/admin/roles',{id:f.user.id,role:'admin',reason:'forbidden self promotion'},f.token)).response.status,403);
 assert.equal((await f.request('/api/admin/roles',{id:f.user.id,role:'admin',reason:'owner delegates administration'})).response.status,200);
 assert.equal((await f.request('/api/me',undefined,f.token)).response.status,401,'Role changes revoke prior sessions');
 const staff=(await f.request('/api/login',{username:f.user.username,password:'trial-password-fixture'},null,{'X-GCode-Client':'android'})).data.token;
 assert.equal((await f.request('/api/admin/roles',{id:f.admin.id,role:'user',reason:'staff cannot downgrade owner'},staff)).response.status,403);
 assert.equal((await f.request('/api/admin/users',{id:f.admin.id,disabled:true,rpm:10,concurrency:1,reason:'staff cannot disable owner'},staff)).response.status,403);
 assert.equal((await f.request('/api/admin/adjust',{user_id:f.admin.id,amount_micros:1,reason:'staff cannot edit owner balance'},staff)).response.status,403);
 assert.equal((await f.request('/api/admin/roles',{id:f.admin.id,role:'user',reason:'owner cannot demote sole owner'})).response.status,403);
 assert.equal((await f.request('/api/admin/roles',{id:f.user.id,role:'user',reason:'owner revokes delegation'})).response.status,200);
 assert.equal((await f.request('/api/admin/users',undefined,staff)).response.status,401);
 assert(f.store.all("SELECT * FROM audit WHERE action='role_update'").every(entry=>entry.actor_id===f.admin.id));
});

test('registration uses expiring one-time client proof; replay, missing proof, honeypot and excessive challenge requests are rejected',async t=>{
 const f=await fixture(t),post=async input=>fetch(f.url+'/api/register',{method:'POST',headers:{'Content-Type':'application/json','X-GCode-Client':'android'},body:JSON.stringify(input)}),base={username:'proof-customer',password:'test-pass!',accepted_terms:true};
 assert.equal((await post(base)).status,400);
 const challenge=await fetch(f.url+'/api/register-challenge').then(response=>response.json()),proof=await registrationProof(challenge);
 const created=await post({...base,registration_proof:proof,role:'admin',is_owner:true});assert.equal(created.status,200);const data=await created.json();assert.equal(data.user.role,'user');assert.equal(data.user.is_owner,false);
 assert.equal((await post({...base,username:'proof-replay',registration_proof:proof})).status,400);
 const expired=await fetch(f.url+'/api/register-challenge').then(response=>response.json()),expiredProof=await registrationProof(expired);f.store.run('UPDATE registration_challenges SET expires_at=0 WHERE id=?',expired.id);assert.equal((await post({...base,username:'proof-expired',registration_proof:expiredProof})).status,400);
 assert.equal((await post({...base,website:'spam-field'})).status,400);
 const flood=await Promise.all(Array.from({length:12},()=>fetch(f.url+'/api/register-challenge')));assert(flood.some(response=>response.status===429));assert.equal((await fetch(f.url+'/health')).status,200);
 assert.equal(f.store.get("SELECT COUNT(*) AS n FROM users WHERE username LIKE 'proof-%'").n,1);
});

test('authentication body and password hashing concurrency stay bounded while server health remains responsive',async t=>{
 const f=await fixture(t);
 const huge=await fetch(f.url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'oversized',password:'x'.repeat(9000)})});assert.equal(huge.status,413);
 const requests=await Promise.all(Array.from({length:8},()=>fetch(f.url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.admin.username,password:'admin-password-fixture'})})));
 assert(requests.some(response=>response.status===200));assert(requests.some(response=>response.status===429));assert(requests.every(response=>[200,429].includes(response.status)));assert.equal((await fetch(f.url+'/health')).status,200);
});

test('existing database gains a sole owner without losing users or ledger balances',async t=>{
 const f=await fixture(t),{DatabaseSync}=await import('node:sqlite'),{readFile}=await import('node:fs/promises'),{Store}=await import('../src/store.mjs');
 const file=f.root+'/previous-version.db',old=new DatabaseSync(file);old.exec(await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));old.exec("CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,applied_at INTEGER NOT NULL); INSERT INTO schema_migrations VALUES('001_initial.sql',1);");
 old.prepare('INSERT INTO users(id,username,password_hash,role,balance_micros,rpm,concurrency,created_at) VALUES(?,?,?,?,?,?,?,?)').run('legacy-owner','legacy-admin','fixture-hash','admin',1234567,10,2,1);old.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-ledger','legacy-owner','adjustment',1234567,1234567,null,null,'legacy-owner','original credit',1);old.close();
 const upgraded=new Store({...f.config,db:file});try{assert.equal(upgraded.user('legacy-owner').is_owner,1);assert.equal(upgraded.user('legacy-owner').balance_micros,1234567);assert.equal(upgraded.get('SELECT balance_after_micros FROM ledger WHERE id=?','old-ledger').balance_after_micros,1234567);assert.equal(upgraded.get('SELECT COUNT(*) AS n FROM schema_migrations').n,3);assert.equal(upgraded.get('SELECT COUNT(*) AS n FROM users WHERE is_owner=1').n,1);}finally{upgraded.close();}
});
