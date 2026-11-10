// Local workerd integration. All remote HTTP is simulated; no live posts/follows.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateCryptoKeyPair,signRequest,verifyRequest,getDocumentLoader} from '@fedify/fedify';
import {CryptographicKey,Follow,Person} from '@fedify/vocab';
import {ORIGIN,ACTOR_PATH} from '../cms/federation.mjs';

const localKeys=await generateCryptoKeyPair('RSASSA-PKCS1-v1_5'),remoteKeys=await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
const remoteId=new URL('https://example.com/users/federation-test'),remoteInbox=new URL(remoteId+'/inbox');
const remote=new Person({id:remoteId,preferredUsername:'federation-test',inbox:remoteInbox,publicKey:new CryptographicKey({id:new URL(remoteId+'#main-key'),owner:remoteId,publicKey:remoteKeys.publicKey})});
const remoteDocument=await remote.toJsonLd(),received=[];
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
 throw new Error('Unexpected network request in isolated test: '+request.method+' '+request.url);
};
const bundled=await build({stdin:{contents:"import consumer from './cms/federation-consumer.mjs'; export default {...consumer, async fetch(_request,env){await consumer.scheduled(null,env);return new Response('ok')}}",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],write:false});
// Miniflare's loopback transport rewrites Host to 127.0.0.1. Restore the
// original HTTP host in the test adapter; production receives it directly.
const pagesBundle=await build({stdin:{contents:"import pages from './dist/_worker.js'; export default {fetch(r,...args){const headers=new Headers(r.headers);headers.set('host',new URL(r.url).host);return pages.fetch(new Request(r,{headers}),...args)}}",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],write:false});
const shared={compatibilityDate:'2026-11-05',compatibilityFlags:['nodejs_compat'],kvNamespaces:{FEDERATION_KV:'test-kv'},d1Databases:{DB:'test-db'},queueProducers:{FEDERATION_QUEUE:'federation-test'},bindings:{FEDERATION_ENABLED:'true'},outboundService:outbound};
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
 {name:'pages',modules:true,script:pagesBundle.outputFiles[0].text,...shared,serviceBindings:{ASSETS:()=>new Response('static')}},
 {name:'consumer',modules:true,script:bundled.outputFiles[0].text,...shared,queueConsumers:{'federation-test':{maxBatchSize:1,maxBatchTimeout:1,maxRetries:0}}}
]}));
try{
 const db=await mf.getD1Database('DB','pages');
 for(const file of ['migrations/0001_cms.sql','migrations/0003_federation.sql']){
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
 console.log('PASS: workerd + D1 + KV + Queue: WebFinger, signed Follow, Accept, signed Create delivery, retraction/410. No live network writes.');
}finally{await mf.dispose();}
