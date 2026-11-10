import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateCryptoKeyPair,MemoryKvStore,signRequest,getDocumentLoader} from '@fedify/fedify';
import {CryptographicKey,Follow,Person,Undo} from '@fedify/vocab';
import {ACTOR_PATH,ORIGIN,buildFederation,onFollow,onUndo,flushPublications,deliverPublication,federationFetch} from '../cms/federation.mjs';
import consumer from '../cms/federation-consumer.mjs';
import worker from '../cms/worker.mjs';
import {newSession} from '../cms/auth.mjs';

class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync('migrations/0001_cms.sql','utf8'));this.db.exec(readFileSync('migrations/0003_federation.sql','utf8'));}
 prepare(sql){let args=[];const db=this.db;const run=()=>{const s=db.prepare(sql);if(/^\s*SELECT/i.test(sql)||/RETURNING/i.test(sql))return {results:s.all(...args)};const r=s.run(...args);return {results:[],meta:{changes:Number(r.changes)}};};return {bind(...values){args=values;return this;},async first(){return run().results[0]||null;},async all(){return run();},async run(){return run();}};}
 async batch(statements){this.db.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.all());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const localKeys=await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
const remoteKeys=await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
const remoteId=new URL('https://remote.example/users/alice'),remoteInbox=new URL('https://remote.example/users/alice/inbox');
const remote=new Person({id:remoteId,preferredUsername:'alice',inbox:remoteInbox,publicKey:new CryptographicKey({id:new URL(remoteId+'#main-key'),owner:remoteId,publicKey:remoteKeys.publicKey})});
const remoteDocument=await remote.toJsonLd();
const loader=async url=>{
 if(url.split('#')[0]!==remoteId.href)throw new Error('Unexpected remote document '+url);
 return {document:remoteDocument,documentUrl:remoteId.href,contextUrl:null};
};

async function fixture(){
 const DB=new D1();
 DB.db.prepare('INSERT INTO ap_keys VALUES(1,?,?)').run(JSON.stringify(await crypto.subtle.exportKey('jwk',localKeys.publicKey)),JSON.stringify(await crypto.subtle.exportKey('jwk',localKeys.privateKey)));
 const tasks=[],sent=[];
 const env={DB,FEDERATION_ENABLED:'true',FEDERATION_KV:{},FEDERATION_QUEUE:{send:async(body)=>tasks.push(body),sendBatch:async(batch)=>tasks.push(...batch.map(m=>m.body))}};
 const queue={nativeRetrial:true,enqueue:async(message)=>tasks.push(message),listen:async()=>{}};
 const federation=await buildFederation(env,{kv:new MemoryKvStore(),queue,documentLoaderFactory:()=>loader,contextLoaderFactory:()=>getDocumentLoader(),authenticatedDocumentLoaderFactory:()=>loader});
 const ctx=federation.createContext(new URL(ORIGIN),env);
 const sendCtx={data:env,getActorUri:ctx.getActorUri.bind(ctx),getFollowersUri:ctx.getFollowersUri.bind(ctx),getObjectUri:ctx.getObjectUri.bind(ctx),sendActivity:async(...args)=>sent.push(args)};
 const follow=(suffix='1')=>new Follow({id:new URL('https://remote.example/follows/'+suffix),actor:remote,object:new URL(ORIGIN+ACTOR_PATH)});
 const insert=(status='draft',slug='new-work')=>DB.db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,1,?)').run(slug,'新しい絵','art','2026-11-10',status,JSON.stringify({slug,title:'新しい絵',description:'<テスト>の説明',category:'art',date:'2026-11-10',tags:[],body:'本文は配信しない',html:'<p>本文は配信しない</p>',cover:'/images/test.jpg',coverAlt:'絵の説明'}),new Date().toISOString());
 const update=(status,title='新しい絵')=>{const p=JSON.parse(DB.db.prepare('SELECT document FROM posts WHERE slug=?').get('new-work').document);p.title=title;DB.db.prepare('UPDATE posts SET status=?,title=?,document=?,version=version+1,updated_at=? WHERE slug=?').run(status,title,JSON.stringify(p),new Date().toISOString(),'new-work');};
 const oldFollower=()=>DB.db.prepare("UPDATE ap_followers SET followed_at='2020-01-01T00:00:00.000Z'").run();
 return {DB,env,federation,ctx,sendCtx,tasks,sent,follow,insert,update,oldFollower};
}

test('WebFinger and actor expose a persistent identity; unknown accounts and preview are rejected',async()=>{
 const f=await fixture();
 const fetch=path=>f.federation.fetch(new Request(ORIGIN+path,{headers:{accept:'application/activity+json'}}),{contextData:f.env});
 const wf=await fetch('/.well-known/webfinger?resource=acct:hiroba@monozukuri-hiroba-tomo.pages.dev');assert.equal(wf.status,200);const webfinger=await wf.json();assert.equal(webfinger.subject,'acct:hiroba@monozukuri-hiroba-tomo.pages.dev');assert.ok(webfinger.links.some(l=>l.href===ORIGIN+ACTOR_PATH));
 const actor=await (await fetch(ACTOR_PATH)).json();assert.equal(actor.preferredUsername,'hiroba');assert.equal(actor.inbox,ORIGIN+ACTOR_PATH+'/inbox');assert.match(actor.publicKey.publicKeyPem,/BEGIN PUBLIC KEY/);assert.ok(!JSON.stringify(actor).includes('PRIVATE'));
 assert.equal((await fetch('/ap/actors/nobody')).status,404);
 assert.equal((await fetch('/.well-known/webfinger?resource=acct:nobody@monozukuri-hiroba-tomo.pages.dev')).status,404);
 assert.equal((await federationFetch(new Request('https://preview.pages.dev'+ACTOR_PATH),f.env)).status,404);
 assert.equal((await federationFetch(new Request(ORIGIN+ACTOR_PATH),{})).status,404);
 assert.equal((await federationFetch(new Request(ORIGIN+'/ap/inbox',{method:'POST',body:'x'.repeat(262145)}),f.env)).status,413);
 const again=await buildFederation(f.env,{kv:new MemoryKvStore(),queue:undefined});const a=await again.fetch(new Request(ORIGIN+ACTOR_PATH,{headers:{accept:'application/activity+json'}}),{contextData:f.env});assert.deepEqual((await a.json()).publicKey,actor.publicKey);
});

test('HTTP signatures gate Follow; a verified Follow queues Accept',async()=>{
 const f=await fixture();
 const activity=await f.follow().toJsonLd();
 const request=()=>new Request(ORIGIN+ACTOR_PATH+'/inbox',{method:'POST',headers:{'content-type':'application/activity+json'},body:JSON.stringify(activity)});
 const unsigned=await f.federation.fetch(request(),{contextData:f.env});assert.ok([400,401,403].includes(unsigned.status));assert.equal(f.tasks.length,0);
 const signed=await signRequest(request(),remoteKeys.privateKey,new URL(remoteId+'#main-key'));
 const response=await f.federation.fetch(signed,{contextData:f.env});assert.equal(response.status,202,await response.clone().text());
 assert.equal(f.tasks[0].type,'inbox');await f.federation.processQueuedTask(f.env,f.tasks.shift());
 assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_followers').get().n,1);
 assert.equal(f.tasks.at(-1).type,'outbox');assert.equal(f.tasks.at(-1).inbox,remoteInbox.href);assert.match(JSON.stringify(f.tasks.at(-1).activity),/Accept/);
 const forged=await signRequest(request(),localKeys.privateKey,new URL(remoteId+'#main-key'));
 assert.ok([400,401,403].includes((await f.federation.fetch(forged,{contextData:f.env})).status));
});

test('Follow/Undo is idempotent, checks actor ownership and handles out-of-order queues',async()=>{
 const f=await fixture(),follow=f.follow();
 await onFollow(f.sendCtx,follow);await onFollow(f.sendCtx,follow);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_followers').get().n,1);assert.equal(f.sent[0][2].id.href,f.sent[1][2].id.href);
 await onUndo(f.sendCtx,new Undo({actor:new URL('https://attacker.example/user'),object:follow}));assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_followers').get().n,1);
 await onUndo(f.sendCtx,new Undo({actor:remoteId,object:follow}));assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_followers').get().n,0);
 const cancelled=f.follow();cancelled.getActor=async()=>{throw new Error('Deleted remote account cannot be fetched');};await onFollow(f.sendCtx,cancelled);
 await onFollow(f.sendCtx,follow);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_followers').get().n,0);
 await onFollow(f.sendCtx,f.follow('2'));await onUndo(f.sendCtx,new Undo({actor:remoteId,object:follow}));assert.equal(f.DB.db.prepare('SELECT follow_id FROM ap_followers').get().follow_id,f.follow('2').id.href);
 const third=f.follow('3');await onUndo(f.sendCtx,new Undo({actor:remoteId,object:third}));await onFollow(f.sendCtx,third);assert.equal(f.DB.db.prepare('SELECT follow_id FROM ap_followers').get().follow_id,f.follow('2').id.href);
});

test('publish, edit, retract and re-publish preserve privacy and use new publication IDs',async()=>{
 const f=await fixture();await onFollow(f.sendCtx,f.follow());f.oldFollower();f.sent.length=0;
 f.insert();assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_events').get().n,0);
 f.update('published');await flushPublications(f.env);assert.equal(f.tasks.length,1);
 await deliverPublication(f.sendCtx,f.tasks[0]);let json=await f.sent.at(-1)[2].toJsonLd();assert.equal(json.type,'Create');assert.match(json.object.content,/新しい絵/);assert.match(json.object.content,/&lt;テスト&gt;/);assert.ok(!json.object.content.includes('本文は配信しない'));assert.equal(json.object.attachment.url,ORIGIN+'/images/test.jpg');
 const firstId=json.object.id;
 f.update('published','編集済み');await flushPublications(f.env);await deliverPublication(f.sendCtx,f.tasks[1]);json=await f.sent.at(-1)[2].toJsonLd();assert.equal(json.type,'Update');assert.equal(json.object.id,firstId);assert.match(json.object.content,/編集済み/);
 f.update('draft','非公開の新しい内容');await flushPublications(f.env);const count=f.sent.length;await deliverPublication(f.sendCtx,f.tasks[0]);assert.equal(f.sent.length,count,'stale Create suppressed');await deliverPublication(f.sendCtx,f.tasks[2]);json=await f.sent.at(-1)[2].toJsonLd();assert.equal(json.type,'Delete');assert.equal(json.object.type,'Tombstone');assert.ok(!JSON.stringify(json).includes('非公開の新しい内容'));
 const gone=await f.federation.fetch(new Request(firstId,{headers:{accept:'application/activity+json'}}),{contextData:f.env});assert.equal(gone.status,410);
 const outbox=await f.federation.fetch(new Request(ORIGIN+ACTOR_PATH+'/outbox?cursor='+Number.MAX_SAFE_INTEGER,{headers:{accept:'application/activity+json'}}),{contextData:f.env});assert.ok(!JSON.stringify(await outbox.json()).includes('非公開の新しい内容'));
 f.update('published');await flushPublications(f.env);await deliverPublication(f.sendCtx,f.tasks.at(-1));json=await f.sent.at(-1)[2].toJsonLd();assert.equal(json.type,'Create');assert.notEqual(json.object.id,firstId);
});

test('durable events survive failed enqueue, transaction rollback, and exclude late followers',async()=>{
 const f=await fixture();await onFollow(f.sendCtx,f.follow());f.oldFollower();f.insert('published');
 const send=f.env.FEDERATION_QUEUE.sendBatch;f.env.FEDERATION_QUEUE.sendBatch=async()=>{throw new Error('Queue unavailable');};await assert.rejects(flushPublications(f.env));assert.equal(f.DB.db.prepare('SELECT queued_at FROM ap_events').get().queued_at,null);
 f.env.FEDERATION_QUEUE.sendBatch=send;await flushPublications(f.env);await flushPublications(f.env);assert.equal(f.tasks.length,1);
 f.DB.db.exec('BEGIN');f.insert('published','rolled-back');f.DB.db.exec('ROLLBACK');assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_events').get().n,1);
 f.DB.db.prepare("UPDATE ap_followers SET followed_at='2099-01-01T00:00:00.000Z'").run();const count=f.sent.length;await deliverPublication(f.sendCtx,f.tasks[0]);assert.equal(f.sent.length,count);
});

test('delivery retries individually and retains exhausted jobs for recovery',async()=>{
 const f=await fixture();let retries=0,acks=0;
 const prepare=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{if(sql.startsWith('SELECT'))throw new Error('Database unavailable');return prepare(sql);};
 const message={id:'failure-test',body:{type:'hiroba:publication',eventId:1,actor:remoteId.href},attempts:1,ack(){acks++;},retry({delaySeconds}){assert.equal(delaySeconds,60);retries++;}};
 await consumer.queue({messages:[message]},f.env);assert.equal(retries,1);assert.equal(acks,0);
 message.attempts=8;await consumer.queue({messages:[message]},f.env);assert.equal(acks,1);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_failures').get().n,1);
});

test('follow instructions integrate with existing page shell and anonymous admin statistics stay private',async()=>{
 const f=await fixture();const page=await worker.fetch(new Request(ORIGIN+'/follow/'),{DB:f.DB});assert.equal(page.status,200);assert.match(await page.text(),/@hiroba@monozukuri-hiroba-tomo.pages.dev/);
 assert.equal((await worker.fetch(new Request(ORIGIN+'/api/admin/federation'),f.env)).status,401);
 assert.equal((await worker.fetch(new Request('https://preview.pages.dev/api/admin/posts',{method:'POST'}),f.env)).status,403);
});

test('only authenticated CSRF-protected requests can retry failed jobs, without losing jobs on enqueue failure',async()=>{
 const f=await fixture(),session=await newSession(f.DB);
 const job={type:'hiroba:publication',eventId:1,actor:remoteId.href};
 f.DB.db.prepare('INSERT INTO ap_failures VALUES(?,?,?)').run('one',JSON.stringify(job),new Date().toISOString());
 const request=csrf=>worker.fetch(new Request(ORIGIN+'/api/admin/federation/retry',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json',cookie:`__Host-hiroba_session=${session.token}`,'x-csrf-token':csrf},body:'{}'}),f.env);
 assert.equal((await request('invalid')).status,403);
 const send=f.env.FEDERATION_QUEUE.send;f.env.FEDERATION_QUEUE.send=async()=>{throw new Error('Queue unavailable');};assert.equal((await request(session.csrf)).status,503);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_failures').get().n,1);
 f.env.FEDERATION_QUEUE.send=send;const r=await request(session.csrf);assert.equal(r.status,200);assert.deepEqual(await r.json(),{retried:1});assert.deepEqual(f.tasks,[job]);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_failures').get().n,0);
});

test('installing the schema leaves existing published works unannounced',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001_cms.sql','utf8'));db.exec(readFileSync('cms/generated/seed.sql','utf8'));
 const count=db.prepare('SELECT count(*) n FROM posts').get().n;db.exec(readFileSync('migrations/0003_federation.sql','utf8'));
 assert.equal(db.prepare('SELECT count(*) n FROM posts').get().n,count);assert.equal(db.prepare('SELECT count(*) n FROM ap_events').get().n,0);
 db.prepare("UPDATE posts SET title=title,version=version+1 WHERE status='published'").run();assert.equal(db.prepare('SELECT count(*) n FROM ap_events').get().n,0);db.close();
});
