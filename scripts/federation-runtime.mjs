// Local workerd integration. All remote HTTP is simulated; no live posts/follows.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateCryptoKeyPair,signRequest,verifyRequest,getDocumentLoader} from '@fedify/fedify';
import {Accept,Create,CryptographicKey,Delete,Follow,Note,Person,PUBLIC_COLLECTION,Update} from '@fedify/vocab';
import {Temporal} from '@js-temporal/polyfill';
import {ORIGIN,ACTOR_PATH} from '../cms/federation.mjs';
import {newSession} from '../cms/auth.mjs';

const localKeys=await generateCryptoKeyPair('RSASSA-PKCS1-v1_5'),remoteKeys=await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
const remoteId=new URL('https://example.com/users/federation-test'),remoteInbox=new URL(remoteId+'/inbox');
const remote=new Person({id:remoteId,preferredUsername:'federation-test',inbox:remoteInbox,publicKey:new CryptographicKey({id:new URL(remoteId+'#main-key'),owner:remoteId,publicKey:remoteKeys.publicKey})});
const remoteDocument=await remote.toJsonLd(),received=[],remotePosts=new Map(),canonicalRequests=[];
const outbound=async request=>{
 const url=new URL(request.url);
 // Fedify checks public DNS before fetching an actor. Simulate it too so the
 // test is entirely offline while production retains the SSRF protection.
 if(url.hostname==='cloudflare-dns.com'&&url.searchParams.get('name')==='example.com')
  return Response.json({Status:0,Question:[{name:'example.com',type:url.searchParams.get('type')==='A'?1:28}],Answer:url.searchParams.get('type')==='A'?[{name:'example.com',type:1,TTL:60,data:'93.184.216.34'}]:[]});
 if(request.url===remoteInbox.href&&request.method==='POST'){
  const body=await request.text();received.push({body,headers:Object.fromEntries(request.headers)});
  return new Response('',{status:202});
 }
 if(request.url.split('#')[0]===remoteId.href)return Response.json(remoteDocument,{headers:{'content-type':'application/activity+json'}});
 if(remotePosts.has(request.url)){canonicalRequests.push(request);return Response.json(remotePosts.get(request.url),{headers:{'content-type':'application/activity+json'}});}
 throw new Error('Unexpected network request in isolated test: '+request.method+' '+request.url);
};
const bundled=await build({stdin:{contents:"import consumer from './cms/federation-consumer.mjs'; export default {...consumer, async fetch(_request,env){await consumer.scheduled(null,env);return new Response('ok')}}",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],write:false});
// Miniflare's loopback transport rewrites Host to 127.0.0.1. Restore the
// original HTTP host in the test adapter; production receives it directly.
const pagesBundle=await build({stdin:{contents:"import pages from './dist/_worker.js'; export default {fetch(r,...args){const headers=new Headers(r.headers);headers.set('host',new URL(r.url).host);return pages.fetch(new Request(r,{headers}),...args)}}",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],write:false});
const shared={compatibilityDate:'2026-11-05',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],kvNamespaces:{FEDERATION_KV:'test-kv'},d1Databases:{DB:'test-db'},queueProducers:{FEDERATION_QUEUE:'federation-test'},bindings:{FEDERATION_ENABLED:'true'},outboundService:outbound};
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
 {name:'pages',modules:true,script:pagesBundle.outputFiles[0].text,...shared,serviceBindings:{ASSETS:()=>new Response('static')}},
 {name:'consumer',modules:true,script:bundled.outputFiles[0].text,...shared,queueConsumers:{'federation-test':{maxBatchSize:1,maxBatchTimeout:1,maxRetries:0}}}
]}));
try{
 const db=await mf.getD1Database('DB','pages');
 for(const file of ['migrations/0001_cms.sql','migrations/0003_federation.sql','migrations/0004_federation_reading.sql']){
  const source=readFileSync(file,'utf8').replace(/^--.*$/gm,'');
  const triggers=source.match(/CREATE TRIGGER[\s\S]*?END;/g)||[];
  const statements=source.replace(/CREATE TRIGGER[\s\S]*?END;/g,'').split(';').map(s=>s.trim()).filter(Boolean);
  for(const sql of [...statements,...triggers])await db.prepare(sql).run();
 }
 await db.prepare('INSERT INTO ap_keys VALUES(1,?,?)').bind(JSON.stringify(await crypto.subtle.exportKey('jwk',localKeys.publicKey)),JSON.stringify(await crypto.subtle.exportKey('jwk',localKeys.privateKey))).run();
 const webfinger=await mf.dispatchFetch(ORIGIN+'/.well-known/webfinger?resource=acct:hiroba@monozukuri-hiroba-tomo.pages.dev');assert.equal(webfinger.status,200);
 const actorResponse=await mf.dispatchFetch(ORIGIN+ACTOR_PATH,{headers:{accept:'application/activity+json'}});assert.equal(actorResponse.status,200,await actorResponse.clone().text());const localActor=await actorResponse.json();
 assert.equal((await mf.dispatchFetch(ORIGIN+'/follow/')).status,200);
 const follow=new Follow({id:new URL('https://example.com/follows/phase-one-test'),actor:remoteId,object:new URL(ORIGIN+ACTOR_PATH)});
 const request=new Request(ORIGIN+ACTOR_PATH+'/inbox',{method:'POST',headers:{'content-type':'application/activity+json'},body:JSON.stringify(await follow.toJsonLd())});
 const signed=await signRequest(request,remoteKeys.privateKey,new URL(remoteId+'#main-key'));
 const pages=await mf.getWorker('pages');
 const inbox=await pages.fetch(signed.url,{method:signed.method,headers:Object.fromEntries(signed.headers),body:await signed.text()});assert.equal(inbox.status,202,await inbox.clone().text());
 async function waitFor(predicate){for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}console.log('Queue diagnostics:',await db.prepare('SELECT count(*) n FROM ap_followers').first(),await db.prepare('SELECT count(*) n FROM ap_failures').first(),received.length);throw new Error('Timed out waiting for local queue');}
 await waitFor(()=>received.some(r=>JSON.parse(r.body).type==='Accept'));
 assert.equal((await db.prepare('SELECT count(*) n FROM ap_followers').first()).n,1);
 await db.prepare("UPDATE ap_followers SET followed_at='2020-01-01T00:00:00.000Z'").run();
 const stamp=new Date().toISOString();
 await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,1,?)').bind('runtime-new-work','新しい作品','writing','2026-11-10','published',JSON.stringify({slug:'runtime-new-work',title:'新しい作品',description:'実行環境での配信テスト',category:'writing',date:'2026-11-10',tags:[],body:'本文',html:'<p>本文</p>'}),stamp).run();
 const consumer=await mf.getWorker('consumer');await consumer.fetch('https://test.invalid/sweep');
 await waitFor(()=>received.some(r=>JSON.parse(r.body).type==='Create'));
 const delivery=received.find(r=>JSON.parse(r.body).type==='Create');
 const signedDelivery=new Request(remoteInbox,{method:'POST',headers:delivery.headers,body:delivery.body});
 const verified=await verifyRequest(signedDelivery,{documentLoader:async()=>({document:localActor,documentUrl:ORIGIN+ACTOR_PATH,contextUrl:null}),contextLoader:getDocumentLoader()});assert.ok(verified,'outgoing HTTP signature verifies against public actor key');
 const note=JSON.parse(delivery.body).object;assert.match(note.content,/新しい作品/);assert.equal(note.url,ORIGIN+'/works/runtime-new-work/');
 await db.prepare("UPDATE posts SET status='draft',version=version+1 WHERE slug='runtime-new-work'").run();await consumer.fetch('https://test.invalid/sweep');await waitFor(()=>received.some(r=>JSON.parse(r.body).type==='Delete'));
 assert.equal((await mf.dispatchFetch(note.id,{headers:{accept:'application/activity+json'}})).status,410);
 // Exercise the owner API and the complete reverse direction through the same
 // queue/signature boundary that production uses.
 const session=await newSession(db);
 const admin=async(path,method='GET',data)=>{
  const response=await mf.dispatchFetch(ORIGIN+'/api/admin/reading/'+path,{method,headers:{origin:ORIGIN,cookie:`__Host-hiroba_session=${session.token}`,'x-csrf-token':session.csrf,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  assert.ok(response.ok,await response.clone().text());return response.json();
 };
 assert.equal((await mf.dispatchFetch(ORIGIN+'/api/admin/reading/inbox')).status,401);
 assert.equal((await admin('lookup','POST',{address:remoteId.href})).profile.actor,remoteId.href);
 const subscription=(await admin('follow','POST',{address:remoteId.href})).subscription;
 await waitFor(()=>received.some(r=>JSON.parse(r.body).type==='Follow'));
 const outgoingFollow=received.find(r=>JSON.parse(r.body).type==='Follow');
 assert.ok(await verifyRequest(new Request(remoteInbox,{method:'POST',headers:outgoingFollow.headers,body:outgoingFollow.body}),{documentLoader:async()=>({document:localActor,documentUrl:ORIGIN+ACTOR_PATH,contextUrl:null}),contextLoader:getDocumentLoader()}));
 const send=async activity=>{
  const request=new Request(ORIGIN+ACTOR_PATH+'/inbox',{method:'POST',headers:{'content-type':'application/activity+json'},body:JSON.stringify(await activity.toJsonLd())});
  const signed=await signRequest(request,remoteKeys.privateKey,new URL(remoteId+'#main-key'));
  const response=await pages.fetch(signed.url,{method:signed.method,headers:Object.fromEntries(signed.headers),body:await signed.text()});assert.equal(response.status,202,await response.clone().text());
 };
 const localFollow=await Follow.fromJsonLd(JSON.parse(outgoingFollow.body));
 await send(new Accept({id:new URL('https://example.com/accepts/reading'),actor:remoteId,object:localFollow,to:new URL(ORIGIN+ACTOR_PATH)}));
 await waitFor(async()=> (await db.prepare('SELECT status FROM ap_subscriptions WHERE id=?').bind(subscription.id).first()).status==='accepted');
 const remotePostId=new URL('https://example.com/notes/reading');
 const makePost=(extra={})=>new Note({id:remotePostId,attribution:remoteId,to:PUBLIC_COLLECTION,content:'<p>外部の新作</p><script>unsafe()</script>',published:Temporal.Instant.from('2026-11-10T00:00:00Z'),...extra});
 const event=(Type,object)=>new Type({id:new URL('https://example.com/events/'+crypto.randomUUID()),actor:remoteId,object,to:PUBLIC_COLLECTION});
 remotePosts.set(remotePostId.href,await makePost().toJsonLd());
 await send(event(Create,makePost({content:'偽の埋め込み'})));
 await waitFor(async()=> (await db.prepare('SELECT count(*) n FROM ap_received').first()).n===1);
 let feed=await admin('inbox');assert.equal(feed.items[0].html,'<p>外部の新作</p>');assert.equal(feed.items[0].actor,remoteId.href);
 assert.ok(canonicalRequests.length);assert.ok(canonicalRequests[0].headers.has('signature'),'canonical object is fetched with signed GET');
 remotePosts.set(remotePostId.href,await makePost({content:'<p>外部の改訂</p>',updated:Temporal.Instant.from('2026-11-10T01:00:00Z')}).toJsonLd());
 await send(event(Update,remotePostId));
 await waitFor(async()=> (await db.prepare('SELECT html FROM ap_received').first())?.html==='<p>外部の改訂</p>');
 await send(event(Delete,remotePostId));await waitFor(async()=> (await db.prepare('SELECT count(*) n FROM ap_received').first()).n===0);
 await admin('unfollow','POST',{id:subscription.id});
 await waitFor(()=>received.some(r=>JSON.parse(r.body).type==='Undo'));
 await waitFor(async()=> (await db.prepare('SELECT status FROM ap_subscriptions WHERE id=?').bind(subscription.id).first()).status==='cancelled');
 assert.deepEqual((await admin('following')).items,[]);assert.deepEqual((await admin('inbox')).items,[]);
 const undo=JSON.parse(received.find(r=>JSON.parse(r.body).type==='Undo').body);assert.equal(undo.object.id,localFollow.id.href);
 assert.equal((await db.prepare('SELECT count(*) n FROM ap_failures').first()).n,0);
 console.log('PASS: workerd + D1 + KV + Queue: signed federation in both directions, owner lookup/follow, Accept, canonical public Create/Update/Delete, private reading API, Undo, and original publication/retraction. No live network writes.');
}finally{await mf.dispose();}
