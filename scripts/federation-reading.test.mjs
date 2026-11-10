import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {getDocumentLoader} from '@fedify/fedify';
import {Accept,Create,Delete,Follow,Note,Person,PUBLIC_COLLECTION,Reject,Update} from '@fedify/vocab';
import {Temporal} from '@js-temporal/polyfill';
import {resolveActor,startFollowing,stopFollowing,flushFollowJobs,deliverFollowJob,onFollowResponse,onRemotePost,onRemoteDelete,listFollowing,readInbox,followFor} from '../cms/federation-reading.mjs';
import {ORIGIN} from '../cms/federation.mjs';
import {newSession} from '../cms/auth.mjs';
import worker from '../cms/worker.mjs';

class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');for(const name of ['0001_cms.sql','0003_federation.sql','0004_federation_reading.sql'])this.db.exec(readFileSync('migrations/'+name,'utf8'));}
 prepare(sql){let args=[];const db=this.db;const execute=()=>{const s=db.prepare(sql);if(/^\s*SELECT/i.test(sql)||/RETURNING/i.test(sql))return {results:s.all(...args)};const r=s.run(...args);return {results:[],meta:{changes:Number(r.changes)}};};return {bind(...v){args=v;return this;},async first(){return execute().results[0]||null;},async all(){return execute();},async run(){return execute();}};}
 async batch(statements){this.db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.all());this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
const actorId=new URL('https://remote.example/users/artist'),postId=new URL('https://remote.example/notes/one');
const artist=new Person({id:actorId,inbox:new URL(actorId+'/inbox'),url:new URL('https://remote.example/@artist'),name:'創作者',preferredUsername:'artist'});
const stamp=day=>Temporal.Instant.from(`2026-11-${day}T01:00:00Z`);
const note=(props={})=>new Note({id:postId,attribution:actorId,to:PUBLIC_COLLECTION,content:'<p>新作の詩</p>',published:stamp('10'),...props});
const activity=(Type=Create,object=note(),actor=actorId)=>new Type({id:new URL('https://remote.example/events/'+crypto.randomUUID()),actor,object});
function fixture(){
 const DB=new D1(),jobs=[],sent=[],documents=new Map();
 const env={DB,FEDERATION_ENABLED:'true',FEDERATION_KV:{},FEDERATION_QUEUE:{send:async job=>jobs.push(job)}};
 const ctx={data:env,contextLoader:getDocumentLoader(),lookupObject:async()=>artist,
  getDocumentLoader:async()=>async url=>{const value=documents.get(url);if(value instanceof Error)throw value;if(!value)throw new Error('No canonical document');return {document:await value.toJsonLd(),documentUrl:url,contextUrl:null};},sendActivity:async(...args)=>sent.push(args)};
 const approve=async row=>onFollowResponse(ctx,new Accept({actor:actorId,object:followFor(row)}));
 const status=id=>DB.db.prepare('SELECT status FROM ap_subscriptions WHERE id=?').get(id)?.status;
 const postCount=()=>DB.db.prepare('SELECT count(*) n FROM ap_received').get().n;
 const setPost=post=>documents.set(post.id.href,post);
 return {DB,env,ctx,jobs,sent,approve,status,postCount,setPost,documents};
}

test('lookup accepts handles/URLs and rejects local identities, non-actors and unsafe inputs',async()=>{
 const f=fixture();
 assert.equal((await resolveActor(f.ctx,'@artist@remote.example')).actor,actorId.href);
 for(const address of ['',null,'http://remote.example/u','javascript:alert(1)','https://user:pass@remote.example/u',ORIGIN+'/ap/actors/hiroba'])await assert.rejects(resolveActor(f.ctx,address));
 f.ctx.lookupObject=async()=>note();await assert.rejects(resolveActor(f.ctx,actorId.href));
 f.ctx.lookupObject=async()=>new Person({id:actorId,inbox:new URL('http://remote.example/inbox')});await assert.rejects(resolveActor(f.ctx,actorId.href));
 f.ctx.lookupObject=async()=>new Person({id:actorId,inbox:artist.inboxId,name:'詩 &amp; <em>絵</em>'});assert.equal((await resolveActor(f.ctx,actorId.href)).name,'詩 & 絵');
 f.DB.db.close();
});

test('Follow is durable, idempotent, serialized and accepted only by the intended actor',async()=>{
 const f=fixture(),row=await startFollowing(f.ctx,actorId.href);
 assert.equal((await startFollowing(f.ctx,actorId.href)).id,row.id);
 const send=f.env.FEDERATION_QUEUE.send;f.env.FEDERATION_QUEUE.send=async()=>{throw new Error('Queue down');};
 await assert.rejects(flushFollowJobs(f.env));assert.equal(f.DB.db.prepare('SELECT queued_at FROM ap_follow_jobs').get().queued_at,null);
 f.env.FEDERATION_QUEUE.send=send;await flushFollowJobs(f.env);assert.equal(f.jobs.length,1);
 f.DB.db.prepare('INSERT INTO ap_follow_locks VALUES(?,?,?)').run(actorId.href,'busy',Date.now()+60000);
 await assert.rejects(deliverFollowJob(f.ctx,f.jobs[0]));assert.equal(f.sent.length,0);
 f.DB.db.exec('DELETE FROM ap_follow_locks');
 const deliver=f.ctx.sendActivity;f.ctx.sendActivity=async()=>{throw new Error('Remote unavailable');};await assert.rejects(deliverFollowJob(f.ctx,f.jobs[0]),/Remote unavailable/);
 assert.equal(f.DB.db.prepare('SELECT completed_at FROM ap_follow_jobs').get().completed_at,null);assert.equal(f.DB.db.prepare('SELECT count(*) n FROM ap_follow_locks').get().n,0);
 f.ctx.sendActivity=deliver;await deliverFollowJob(f.ctx,f.jobs[0]);await deliverFollowJob(f.ctx,f.jobs[0]);assert.equal(f.sent.length,1);
 const follow=f.sent[0][2];assert.ok(follow instanceof Follow);assert.equal(follow.objectId.href,actorId.href);assert.equal(f.sent[0][3].immediate,true);
 await onFollowResponse(f.ctx,new Accept({actor:new URL('https://evil.example/a'),object:follow}));assert.equal(f.status(row.id),'pending');
 await f.approve(row);assert.equal(f.status(row.id),'accepted');assert.equal((await listFollowing(f.DB))[0].delivery_pending,0);
 f.DB.db.close();
});

test('cancellation survives late Accept and queued Follow; re-follow uses a fresh identity',async()=>{
 const f=fixture(),first=await startFollowing(f.ctx,actorId.href);
 await flushFollowJobs(f.env);await stopFollowing(f.DB,first.id);await f.approve(first);assert.equal(f.status(first.id),'cancelling');
 assert.equal((await startFollowing(f.ctx,actorId.href)).id,first.id,'no new Follow while Undo is in flight');
 await deliverFollowJob(f.ctx,f.jobs[0]);assert.equal(f.sent.length,0,'cancelled unsent Follow is skipped');
 await flushFollowJobs(f.env);await deliverFollowJob(f.ctx,f.jobs[1]);assert.equal(f.sent[0][2].constructor.name,'Undo');assert.equal(f.sent[0][2].objectId.href,followFor(first).id.href);assert.equal(f.status(first.id),'cancelled');
 const second=await startFollowing(f.ctx,actorId.href);assert.notEqual(second.id,first.id);
 await f.approve(first);assert.equal(f.status(second.id),'pending');await f.approve(second);assert.equal(f.status(second.id),'accepted');
 f.setPost(note());await onRemotePost(f.ctx,activity());assert.equal(f.postCount(),1);await stopFollowing(f.DB,second.id);assert.equal(f.postCount(),0);assert.equal((await readInbox(f.DB)).items.length,0);
 f.DB.db.close();
});

test('rejected and unknown Follow responses do not grant access; pending posts are retried',async()=>{
 const f=fixture();f.setPost(note());await onRemotePost(f.ctx,activity());assert.equal(f.postCount(),0);
 const row=await startFollowing(f.ctx,actorId.href);await assert.rejects(onRemotePost(f.ctx,activity()),/acceptance/);
 await onFollowResponse(f.ctx,new Reject({actor:actorId,object:followFor(row)}));assert.equal(f.status(row.id),'rejected');await f.approve(row);assert.equal(f.status(row.id),'rejected');
 await onRemotePost(f.ctx,activity());assert.equal(f.postCount(),0);
 const second=await startFollowing(f.ctx,actorId.href);assert.notEqual(second.id,row.id);assert.equal(f.status(row.id),'cancelled');
 f.DB.db.close();
});

test('received posts are fetched canonically, sanitize HTML, and require public audience and matching author',async()=>{
 const f=fixture(),row=await startFollowing(f.ctx,actorId.href);await f.approve(row);
 f.setPost(note({content:'<p>本当の内容</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a><a href="https://remote.example/work">作品</a>',summary:'内容への注意',sensitive:true}));
 await onRemotePost(f.ctx,activity(Create,note({content:'偽の埋め込み内容'})));const post=(await readInbox(f.DB)).items[0];
 assert.match(post.html,/本当の内容/);assert.doesNotMatch(post.html,/script|onerror|javascript:|偽の埋め込み/);assert.match(post.html,/noopener noreferrer/);assert.equal(post.sensitive,1);
 f.setPost(note({attribution:new URL('https://remote.example/users/another')}));await onRemotePost(f.ctx,activity(Update));assert.equal(f.postCount(),1);assert.match((await readInbox(f.DB)).items[0].html,/本当/);
 f.setPost(note({to:new URL('https://remote.example/followers')}));await onRemotePost(f.ctx,activity(Update));assert.equal(f.postCount(),0,'visibility downgrade removes the cached public content');
 f.setPost(note());await onRemotePost(f.ctx,activity(Create,note(),new URL('https://evil.example/actor')));assert.equal(f.postCount(),0);
 f.DB.db.close();
});

test('updates are deduplicated, old revisions cannot overwrite newer ones, and Delete wins before or during fetch',async()=>{
 const f=fixture(),row=await startFollowing(f.ctx,actorId.href);await f.approve(row);
 f.setPost(note());await onRemotePost(f.ctx,activity());await onRemotePost(f.ctx,activity());assert.equal(f.postCount(),1);
 f.setPost(note({content:'<p>改訂</p>',updated:stamp('11')}));await onRemotePost(f.ctx,activity(Update));
 f.setPost(note());await onRemotePost(f.ctx,activity());assert.match((await readInbox(f.DB)).items[0].html,/改訂/);
 await onRemoteDelete(f.ctx,activity(Delete));await onRemotePost(f.ctx,activity());assert.equal(f.postCount(),0);
 const other=note({id:new URL('https://remote.example/notes/two')});f.setPost(other);await onRemoteDelete(f.ctx,activity(Delete,other));await onRemotePost(f.ctx,activity(Create,other));assert.equal(f.postCount(),0);
 const third=note({id:new URL('https://remote.example/notes/three')});f.setPost(third);
 const original=f.ctx.getDocumentLoader;f.ctx.getDocumentLoader=async()=>async(...args)=>{await onRemoteDelete(f.ctx,activity(Delete,third));return (await original())(...args);};
 await onRemotePost(f.ctx,activity(Create,third));assert.equal(f.postCount(),0);
 f.DB.db.close();
});

test('network failure is retried and unfollow during canonical retrieval prevents storage',async()=>{
 const f=fixture(),row=await startFollowing(f.ctx,actorId.href);await f.approve(row);
 f.documents.set(postId.href,new Error('Network down'));await assert.rejects(onRemotePost(f.ctx,activity()),/Network down/);
 f.setPost(note());const original=f.ctx.getDocumentLoader;f.ctx.getDocumentLoader=async()=>async(...args)=>{await stopFollowing(f.DB,row.id);return (await original())(...args);};
 await onRemotePost(f.ctx,activity());assert.equal(f.postCount(),0);f.DB.db.close();
});

test('inbox pagination is private and actor deletion clears the subscription and received content',async()=>{
 const f=fixture(),row=await startFollowing(f.ctx,actorId.href);await f.approve(row);
 for(let i=0;i<22;i++){const post=note({id:new URL('https://remote.example/notes/'+i)});f.setPost(post);await onRemotePost(f.ctx,activity(Create,post));}
 const first=await readInbox(f.DB),second=await readInbox(f.DB,first.next);assert.equal(first.items.length,20);assert.equal(second.items.length,2);assert.equal(second.next,null);assert.notEqual(first.items[0].seq,second.items[0].seq);
 await assert.rejects(readInbox(f.DB,'garbage'));
 await onRemoteDelete(f.ctx,new Delete({actor:actorId,object:actorId}));assert.equal(f.status(row.id),'deleted');assert.equal(f.postCount(),0);assert.equal((await listFollowing(f.DB)).length,0);f.DB.db.close();
});

test('reading APIs require the owner session, origin, and CSRF for mutations',async()=>{
 const f=fixture(),session=await newSession(f.DB);
 const request=(path,method='GET',headers={},data={})=>worker.fetch(new Request(ORIGIN+'/api/admin/reading/'+path,{method,headers:{origin:ORIGIN,'content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(data)})}),f.env);
 for(const path of ['following','inbox'])assert.equal((await request(path)).status,401);
 const auth={cookie:`__Host-hiroba_session=${session.token}`,'x-csrf-token':session.csrf};
 assert.equal((await request('following','GET',auth)).status,200);
 for(const path of ['lookup','follow','unfollow']){
  assert.equal((await request(path,'POST')).status,401);
  assert.equal((await request(path,'POST',{...auth,origin:'https://evil.example'})).status,403);
  assert.equal((await request(path,'POST',{...auth,'x-csrf-token':'wrong'})).status,403);
 }
 assert.equal((await request('inbox?before=bad','GET',auth)).status,400);
 f.DB.db.close();
});
