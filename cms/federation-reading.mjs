import {Accept,Article,Audio,Follow,Image,Note,Object as ActivityObject,Page,PUBLIC_COLLECTION,Reject,Undo,Video,isActor} from '@fedify/vocab';
import sanitizeHtml from 'sanitize-html';
import {InputError,esc} from './content.mjs';
import {ACTOR_PATH,IDENTIFIER,ORIGIN} from './federation-identity.mjs';

const now=()=>new Date().toISOString();
const localActor=()=>new URL(ACTOR_PATH,ORIGIN);
export const followUri=id=>new URL('/ap/follows/'+id,ORIGIN);
const undoUri=id=>new URL('/ap/unfollows/'+id,ORIGIN);
const remoteUrl=value=>{
 try{const u=value instanceof URL?value:new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.origin!==ORIGIN&&u.href.length<=2048?u:null;}catch{return null;}
};
// sanitize-html escapes text for HTML; these fields are rendered with textContent.
const plain=(value,max=300)=>sanitizeHtml(String(value??''),{allowedTags:[],allowedAttributes:{}})
 .replace(/&(amp|lt|gt|quot|#39);/g,(_all,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[key]).slice(0,max);
const actorProfile=actor=>({actor:actor.id.href,inbox:actor.inboxId.href,name:plain(actor.name||actor.preferredUsername||actor.id.hostname),profile_url:(remoteUrl(actor.url instanceof URL?actor.url:actor.url?.href)||actor.id).href});

export async function resolveActor(ctx,address){
 if(typeof address!=='string'||address.length>2048)throw new InputError('フォローするアドレスを入力してください。');
 const input=address.trim();
 if(!/^@?[^\s@/:]+@[^\s@/:]+$/.test(input)&&!remoteUrl(input))throw new InputError('@名前@サーバー または https のプロフィールURLを入力してください。');
 let actor;
 try{actor=await ctx.lookupObject(input,{documentLoader:await ctx.getDocumentLoader({identifier:IDENTIFIER}),signal:AbortSignal.timeout(15000)});}
 catch{throw new InputError('相手のプロフィールを取得できませんでした。アドレスを確認して再試行してください。');}
 if(!isActor(actor)||!remoteUrl(actor.id)||!remoteUrl(actor.inboxId))throw new InputError('フォローできる外部アカウントが見つかりませんでした。');
 return actorProfile(actor);
}

export function followFor(row){return new Follow({id:followUri(row.id),actor:localActor(),object:new URL(row.actor),to:new URL(row.actor)});}
const undoFor=row=>new Undo({id:undoUri(row.id),actor:localActor(),object:followFor(row),to:new URL(row.actor)});

export async function startFollowing(ctx,address){
 const profile=await resolveActor(ctx,address),db=ctx.data.DB,id=crypto.randomUUID(),stamp=now();
 await db.batch([
  db.prepare("UPDATE ap_subscriptions SET status='cancelled',changed_at=? WHERE actor=? AND status='rejected'").bind(stamp,profile.actor),
  db.prepare("INSERT OR IGNORE INTO ap_subscriptions VALUES(?,?,?,?,?,'pending',?,?)").bind(id,profile.actor,profile.inbox,profile.name,profile.profile_url,stamp,stamp),
  db.prepare("INSERT INTO ap_follow_jobs(id,subscription_id,kind) SELECT ?,id,'Follow' FROM ap_subscriptions WHERE id=?").bind(id+':follow',id)
 ]);
 return db.prepare("SELECT id,actor,name,profile_url,status,created_at FROM ap_subscriptions WHERE actor=? AND status IN ('pending','accepted','cancelling')").bind(profile.actor).first();
}

export async function stopFollowing(db,id){
 const stamp=now();
 await db.batch([
  db.prepare("UPDATE ap_subscriptions SET status='cancelling',changed_at=? WHERE id=? AND status IN ('pending','accepted','rejected')").bind(stamp,id),
  db.prepare("INSERT OR IGNORE INTO ap_follow_jobs(id,subscription_id,kind) SELECT ?,id,'Undo' FROM ap_subscriptions WHERE id=? AND status='cancelling'").bind(id+':undo',id),
  db.prepare('DELETE FROM ap_received WHERE subscription_id=?').bind(id)
 ]);
}

export async function flushFollowJobs(env){
 const rows=(await env.DB.prepare('SELECT id FROM ap_follow_jobs WHERE queued_at IS NULL AND completed_at IS NULL ORDER BY rowid LIMIT 20').all()).results;
 for(const row of rows){
  await env.FEDERATION_QUEUE.send({type:'hiroba:follow',jobId:row.id});
  await env.DB.prepare('UPDATE ap_follow_jobs SET queued_at=? WHERE id=?').bind(now(),row.id).run();
 }
}

export async function deliverFollowJob(ctx,message){
 const db=ctx.data.DB;
 const job=await db.prepare('SELECT j.kind,j.completed_at,s.* FROM ap_follow_jobs j JOIN ap_subscriptions s ON s.id=j.subscription_id WHERE j.id=?').bind(message.jobId).first();
 if(!job||job.completed_at)return;
 // D1 leases serialize Follow/Undo to the same actor across queue invocations.
 const token=crypto.randomUUID(),time=Date.now();
 const locked=await db.prepare(`INSERT INTO ap_follow_locks VALUES(?,?,?) ON CONFLICT(actor) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE ap_follow_locks.expires<? RETURNING token`).bind(job.actor,token,time+600000,time).all();
 if(!locked.results.length)throw new Error('Another follow delivery is in progress');
 try{
  const row=await db.prepare('SELECT * FROM ap_subscriptions WHERE id=?').bind(job.id).first();
  if((job.kind==='Follow'&&['pending','accepted'].includes(row.status))||(job.kind==='Undo'&&row.status==='cancelling')){
   await ctx.sendActivity({identifier:IDENTIFIER},{id:new URL(row.actor),inboxId:new URL(row.inbox)},job.kind==='Follow'?followFor(row):undoFor(row),{immediate:true});
  }
  await db.batch([
   db.prepare('UPDATE ap_follow_jobs SET completed_at=? WHERE id=?').bind(now(),message.jobId),
   db.prepare("UPDATE ap_subscriptions SET status='cancelled',changed_at=? WHERE id=? AND status='cancelling' AND ?='Undo'").bind(now(),row.id,job.kind)
  ]);
 }finally{await db.prepare('DELETE FROM ap_follow_locks WHERE actor=? AND token=?').bind(job.actor,token).run();}
}

export async function onFollowResponse(ctx,activity){
 if(!(activity instanceof Accept||activity instanceof Reject)||!activity.actorId||!activity.objectId)return;
 const prefix=ORIGIN+'/ap/follows/';if(!activity.objectId.href.startsWith(prefix))return;
 const id=activity.objectId.href.slice(prefix.length);
 // Match the exact actor and Follow ID; no fetching of an arbitrary response object.
 await ctx.data.DB.prepare("UPDATE ap_subscriptions SET status=?,changed_at=? WHERE id=? AND actor=? AND status='pending'")
  .bind(activity instanceof Accept?'accepted':'rejected',now(),id,activity.actorId.href).run();
}

export async function listFollowing(db){
 return (await db.prepare(`SELECT s.id,s.actor,s.name,s.profile_url,s.status,s.created_at,
  (SELECT count(*) FROM ap_follow_jobs j WHERE j.subscription_id=s.id AND j.completed_at IS NULL) delivery_pending
  FROM ap_subscriptions s WHERE s.status IN ('pending','accepted','rejected','cancelling') ORDER BY s.created_at DESC`).all()).results;
}

export async function readInbox(db,before){
 const cursor=before?Number(before):Number.MAX_SAFE_INTEGER;
 if(!Number.isSafeInteger(cursor)||cursor<1)throw new InputError('読込位置が正しくありません。');
 const rows=(await db.prepare(`SELECT r.seq,r.object_id,r.url,r.title,r.html,r.summary,r.sensitive,r.published,r.updated,r.received_at,s.name,s.actor,s.profile_url
  FROM ap_received r JOIN ap_subscriptions s ON s.id=r.subscription_id
  WHERE s.status='accepted' AND r.seq<? ORDER BY r.seq DESC LIMIT 21`).bind(cursor).all()).results;
 return {items:rows.slice(0,20),next:rows.length>20?String(rows[19].seq):null};
}

const publicObject=object=>[...object.toIds,...object.ccIds].some(id=>id.href===PUBLIC_COLLECTION.href);
const authoredBy=(object,actor)=>object.attributionIds.length===1&&object.attributionIds[0].href===actor;
const accepted=db=>actor=>db.prepare("SELECT * FROM ap_subscriptions WHERE actor=? AND status='accepted'").bind(actor).first();
const supported=object=>[Note,Article,Image,Audio,Video,Page].some(Type=>object instanceof Type);
const safeHtml=value=>sanitizeHtml(value,{allowedTags:['p','br','a','em','strong','b','i','u','s','blockquote','pre','code','ul','ol','li','h2','h3'],allowedAttributes:{a:['href','rel','target']},allowedSchemes:['https'],allowProtocolRelative:false,transformTags:{a:(_tag,attrs)=>({tagName:'a',attribs:{href:remoteUrl(attrs.href)?.href||'',rel:'nofollow noopener noreferrer',target:'_blank'}})}});

export async function onRemotePost(ctx,activity){
 const actor=activity.actorId?.href,objectId=remoteUrl(activity.objectId);
 if(!actor||!objectId||objectId.origin!==new URL(actor).origin)return;
 const db=ctx.data.DB,subscription=await accepted(db)(actor);
 if(!subscription){
  if(await db.prepare("SELECT 1 FROM ap_subscriptions WHERE actor=? AND status='pending'").bind(actor).first())throw new Error('Waiting for follow acceptance');
  return;
 }
 if(await db.prepare('SELECT 1 FROM ap_remote_deletions WHERE object_id=? AND actor=?').bind(objectId.href,actor).first())return;
 // Resolve at the canonical URL to verify ownership, including objects embedded
 // in signed activities. A followed actor cannot forge a neighbour's posts.
 const loader=await ctx.getDocumentLoader({identifier:IDENTIFIER});
 let document;
 try{document=await loader(objectId.href,{signal:AbortSignal.timeout(15000)});}
 catch(error){if(error?.status===410){await onRemoteDelete(ctx,activity);return;}throw error;}
 if(remoteUrl(document.documentUrl)?.origin!==objectId.origin)return;
 let object;
 try{object=await ActivityObject.fromJsonLd(document.document,{documentLoader:loader,contextLoader:ctx.contextLoader});}
 catch(error){if(error instanceof TypeError)return;throw error;}
 if(!object||object.id?.href!==objectId.href||!authoredBy(object,actor)||!supported(object))return;
 if(!publicObject(object)){
  await db.prepare('DELETE FROM ap_received WHERE object_id=? AND actor=?').bind(objectId.href,actor).run();return;
 }
 const stamp=now(),published=object.published?.toString()||null,updated=object.updated?.toString()||null;
 const revision=Number(object.updated?.epochMilliseconds??object.published?.epochMilliseconds??0);
 const content=String(object.content??'').slice(0,100000),html=safeHtml(object.mediaType==='text/plain'?esc(content).replaceAll('\n','<br>'):content);
 const url=remoteUrl(object.url instanceof URL?object.url:object.url?.href)||objectId;
 // Recheck subscription/tombstone inside the write: cancellation or Delete may
 // have arrived while the canonical object was being fetched.
 await db.prepare(`INSERT INTO ap_received(object_id,actor,subscription_id,url,title,html,summary,sensitive,published,updated,revision_ms,received_at)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ap_subscriptions WHERE id=? AND status='accepted')
  AND NOT EXISTS(SELECT 1 FROM ap_remote_deletions WHERE object_id=? AND actor=?)
  ON CONFLICT(object_id) DO UPDATE SET url=excluded.url,title=excluded.title,html=excluded.html,summary=excluded.summary,
  sensitive=excluded.sensitive,published=excluded.published,updated=excluded.updated,revision_ms=excluded.revision_ms
  WHERE ap_received.actor=excluded.actor AND excluded.revision_ms>=ap_received.revision_ms`)
  .bind(objectId.href,actor,subscription.id,url.href,plain(object.name,500),html,plain(object.summary,2000),object.sensitive?1:0,published,updated,revision,stamp,subscription.id,objectId.href,actor).run();
}

export async function onRemoteDelete(ctx,activity){
 const actor=activity.actorId?.href,id=remoteUrl(activity.objectId);if(!actor||!id||id.origin!==new URL(actor).origin)return;
 const db=ctx.data.DB;
 if(id.href===actor){
  await db.batch([
   db.prepare('DELETE FROM ap_followers WHERE actor=?').bind(actor),
   db.prepare("UPDATE ap_subscriptions SET status='deleted',changed_at=? WHERE actor=?").bind(now(),actor),
   db.prepare('DELETE FROM ap_received WHERE actor=?').bind(actor)
  ]);return;
 }
 if(!await accepted(db)(actor))return;
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO ap_remote_deletions VALUES(?,?)').bind(id.href,actor),
  db.prepare('DELETE FROM ap_received WHERE object_id=? AND actor=?').bind(id.href,actor)
 ]);
}
