import {createFederationBuilder} from '@fedify/fedify';
import {WorkersKvStore,WorkersMessageQueue} from '@fedify/cfworkers';
import {Accept,Activity,Create,Delete,Endpoints,Follow,Image,Note,Person,PUBLIC_COLLECTION,Tombstone,Undo,Update} from '@fedify/vocab';
import {Temporal} from '@js-temporal/polyfill';
import {esc,fromRow} from './content.mjs';

export const IDENTIFIER='hiroba';
export const ORIGIN='https://monozukuri-hiroba-tomo.pages.dev';
export const ACTOR_PATH='/ap/actors/hiroba';
export const HANDLE='@hiroba@monozukuri-hiroba-tomo.pages.dev';
const instant=value=>Temporal.Instant.from(value);
const keys=new WeakMap();
const builder=createFederationBuilder();
const recipient=row=>({id:new URL(row.actor),inboxId:new URL(row.inbox)});
const safeRemote=value=>value?.protocol==='https:'&&!value.username&&!value.password&&value.origin!==ORIGIN;

// Provisioned once before deployment; never generate identity keys in a request.
async function keyPairs(db){
 if(!keys.has(db))keys.set(db,(async()=>{
  const row=await db.prepare('SELECT public_jwk,private_jwk FROM ap_keys WHERE id=1').first();
  if(!row)throw new Error('Federation keys have not been provisioned');
  const algorithm={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
  return [{publicKey:await crypto.subtle.importKey('jwk',JSON.parse(row.public_jwk),algorithm,true,['verify']),privateKey:await crypto.subtle.importKey('jwk',JSON.parse(row.private_jwk),algorithm,true,['sign'])}];
 })().catch(error=>{keys.delete(db);throw error;}));
 return keys.get(db);
}

builder.setActorDispatcher('/ap/actors/{identifier}',async(ctx,identifier)=>{
 if(identifier!==IDENTIFIER)return null;
 const [key]=await ctx.getActorKeyPairs(identifier);
 return new Person({id:ctx.getActorUri(identifier),preferredUsername:identifier,name:'ものづくり広場',
  summary:'<p>文章・仕事・絵画・音楽・映像・研究・開発。新しい作品のお知らせを届ける、ものづくり広場のアカウントです。</p>',
  url:new URL(ORIGIN+'/'),inbox:ctx.getInboxUri(identifier),outbox:ctx.getOutboxUri(identifier),
  followers:ctx.getFollowersUri(identifier),publicKey:key.cryptographicKey,assertionMethods:[key.multikey],
  endpoints:new Endpoints({sharedInbox:ctx.getInboxUri()}),
  manuallyApprovesFollowers:false});
}).setKeyPairsDispatcher((ctx,identifier)=>identifier===IDENTIFIER?keyPairs(ctx.data.DB):[])
 .mapHandle((_ctx,username)=>username===IDENTIFIER?IDENTIFIER:null);

// The collection is discoverable; individual followers are kept private.
builder.setFollowersDispatcher('/ap/actors/{identifier}/followers',(_ctx,id)=>id===IDENTIFIER?{items:[]}:null);

export async function onFollow(ctx,follow){
 if(!follow.id||follow.objectId?.href!==ctx.getActorUri(IDENTIFIER).href||!follow.actorId)return;
 // Delayed retries of a cancelled Follow need no network access. Keep the
 // same check in the INSERT as well, so a concurrent Undo still wins.
 if(await ctx.data.DB.prepare('SELECT 1 FROM ap_removed_follows WHERE follow_id=? AND actor=?').bind(follow.id.href,follow.actorId.href).first())return;
 const actor=await follow.getActor(ctx);
 if(actor?.id?.href!==follow.actorId.href||!safeRemote(actor.id)||!safeRemote(actor.inboxId))return;
 const saved=await ctx.data.DB.prepare(`INSERT INTO ap_followers(actor,inbox,follow_id)
  SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM ap_removed_follows WHERE follow_id=? AND actor=?)
  ON CONFLICT(actor) DO UPDATE SET inbox=excluded.inbox,follow_id=excluded.follow_id,
  followed_at=CASE WHEN ap_followers.follow_id=excluded.follow_id THEN ap_followers.followed_at ELSE excluded.followed_at END RETURNING actor`)
  .bind(actor.id.href,actor.inboxId.href,follow.id.href,follow.id.href,actor.id.href).all();
 if(!saved.results.length)return;
 // Stable Accept ID makes retries harmless to the receiving server.
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(follow.id.href));
 const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 await ctx.sendActivity({identifier:IDENTIFIER},actor,new Accept({id:new URL(`/ap/accepts/${id}`,ORIGIN),actor:ctx.getActorUri(IDENTIFIER),object:follow,to:actor.id}));
}

export async function onUndo(ctx,undo){
 if(!undo.actorId)return;
 const follow=await undo.getObject(ctx);
 if(!(follow instanceof Follow)||follow.actorId?.href!==undo.actorId.href||follow.objectId?.href!==ctx.getActorUri(IDENTIFIER).href||!follow.id)return;
 // An old Undo must not remove a later re-follow.
 await ctx.data.DB.batch([
  ctx.data.DB.prepare('INSERT OR IGNORE INTO ap_removed_follows(follow_id,actor) VALUES(?,?)').bind(follow.id.href,undo.actorId.href),
  ctx.data.DB.prepare('DELETE FROM ap_followers WHERE actor=? AND follow_id=?').bind(undo.actorId.href,follow.id.href)
 ]);
}

builder.setInboxListeners('/ap/actors/{identifier}/inbox','/ap/inbox')
 .on(Follow,onFollow).on(Undo,onUndo)
 .on(Delete,async(ctx,activity)=>{
  if(activity.actorId&&activity.objectId?.href===activity.actorId.href)
   await ctx.data.DB.prepare('DELETE FROM ap_followers WHERE actor=?').bind(activity.actorId.href).run();
 }).setSharedKeyDispatcher(()=>({identifier:IDENTIFIER}));

export async function publication(db,id){
 return db.prepare(`SELECT a.id AS publication_id,a.published_at,a.deleted_at,p.*
  FROM ap_publications a LEFT JOIN posts p ON p.slug=a.slug WHERE a.id=?`).bind(id).first();
}

export function noteFor(ctx,row){
 const id=ctx.getObjectUri(Note,{id:row.publication_id});
 if(row.deleted_at||row.status!=='published')return new Tombstone({id,formerType:Note,deleted:row.deleted_at?instant(row.deleted_at):undefined});
 const post=fromRow(row),url=new URL(`/works/${post.slug}/`,ORIGIN);
 const attachment=post.cover?new Image({url:new URL(post.cover,ORIGIN),name:post.coverAlt||post.title}):null;
 return new Note({id,attribution:ctx.getActorUri(IDENTIFIER),url,
  content:`<p>${esc(post.title)}</p>${post.description?`<p>${esc(post.description)}</p>`:''}<p><a href="${url.href}">${url.href}</a></p>`,
  published:instant(row.published_at),updated:instant(row.updated_at),
  to:PUBLIC_COLLECTION,cc:ctx.getFollowersUri(IDENTIFIER),attachments:attachment?[attachment]:[],mediaType:'text/html'});
}

export function activityFor(ctx,event,row){
 const Kind={Create,Update,Delete}[event.kind];
 return new Kind({id:new URL(`/ap/activities/${event.id}`,ORIGIN),actor:ctx.getActorUri(IDENTIFIER),
  object:noteFor(ctx,row),published:instant(event.created_at),to:PUBLIC_COLLECTION,cc:ctx.getFollowersUri(IDENTIFIER)});
}

builder.setObjectDispatcher(Note,'/ap/notes/{id}',async(ctx,{id})=>{
 const row=await publication(ctx.data.DB,id);return row?noteFor(ctx,row):null;
});
builder.setObjectDispatcher(Activity,'/ap/activities/{id}',async(ctx,{id})=>{
 if(!/^\d+$/.test(id))return null;
 const event=await ctx.data.DB.prepare('SELECT * FROM ap_events WHERE id=?').bind(Number(id)).first();
 if(!event)return null;
 const row=await publication(ctx.data.DB,event.publication_id);
 if(!row||((row.deleted_at||row.status!=='published')&&event.kind!=='Delete'))return null;
 return activityFor(ctx,event,row);
});
builder.setOutboxDispatcher('/ap/actors/{identifier}/outbox',async(ctx,id,cursor)=>{
 if(id!==IDENTIFIER)return null;
 const before=cursor?Number(cursor):Number.MAX_SAFE_INTEGER;if(!Number.isSafeInteger(before)||before<1)return null;
 const rows=(await ctx.data.DB.prepare(`SELECT e.* FROM ap_events e JOIN ap_publications a ON a.id=e.publication_id
  JOIN posts p ON p.slug=a.slug WHERE e.kind='Create' AND a.deleted_at IS NULL AND p.status='published' AND e.id<? ORDER BY e.id DESC LIMIT 21`).bind(before).all()).results;
 const selected=rows.slice(0,20),items=[];
 for(const event of selected)items.push(activityFor(ctx,event,await publication(ctx.data.DB,event.publication_id)));
 return {items,nextCursor:rows.length>20?String(selected.at(-1).id):null};
}).setFirstCursor(()=>String(Number.MAX_SAFE_INTEGER));

export function buildFederation(env,overrides={}){
 return builder.build({kv:new WorkersKvStore(env.FEDERATION_KV),queue:new WorkersMessageQueue(env.FEDERATION_QUEUE),
  manuallyStartQueue:true,origin:ORIGIN,...overrides});
}

export function federationEnabled(env){return env.FEDERATION_ENABLED==='true'&&!!env.FEDERATION_KV&&!!env.FEDERATION_QUEUE;}
export function federationPath(path){return path.startsWith('/ap/')||path==='/.well-known/webfinger'||path==='/.well-known/nodeinfo';}

export async function federationFetch(request,env){
 // Preview deployments cannot impersonate the production actor or accept follows.
 if(!federationEnabled(env)||new URL(request.url).origin!==ORIGIN)return new Response('Not Found',{status:404});
 if(new URL(request.url).pathname===ACTOR_PATH&&request.method==='GET'&&request.headers.get('accept')?.includes('text/html'))return Response.redirect(ORIGIN+'/follow/',302);
 if(request.method==='POST'){
  if(Number(request.headers.get('content-length')||0)>262144)return new Response('Payload Too Large',{status:413});
  const reader=request.body?.getReader();let total=0;const parts=[];
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>262144){await reader.cancel();return new Response('Payload Too Large',{status:413});}parts.push(value);}
  request=new Request(request,{body:new Blob(parts),duplex:'half'});
 }
 const federation=await buildFederation(env);
 return federation.fetch(request,{contextData:env});
}

// Called after a successful CMS write and by the scheduled recovery sweep.
// At-least-once enqueue is intentional: Activity IDs stay unchanged on retries.
export async function flushPublications(env){
 if(!federationEnabled(env))return;
 const events=(await env.DB.prepare('SELECT * FROM ap_events WHERE queued_at IS NULL ORDER BY id LIMIT 20').all()).results;
 for(const event of events){
  const followers=(await env.DB.prepare('SELECT actor FROM ap_followers WHERE followed_at<=?').bind(event.created_at).all()).results;
  for(let i=0;i<followers.length;i+=100)
   await env.FEDERATION_QUEUE.sendBatch(followers.slice(i,i+100).map(row=>({body:{type:'hiroba:publication',eventId:event.id,actor:row.actor}})));
  await env.DB.prepare("UPDATE ap_events SET queued_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(event.id).run();
 }
}

export async function deliverPublication(ctx,message){
 const event=await ctx.data.DB.prepare('SELECT * FROM ap_events WHERE id=?').bind(message.eventId).first();
 if(!event)return;
 const row=await publication(ctx.data.DB,event.publication_id);
 if(!row||((row.deleted_at||row.status!=='published')&&event.kind!=='Delete'))return;
 const follower=await ctx.data.DB.prepare('SELECT * FROM ap_followers WHERE actor=? AND followed_at<=?').bind(message.actor,event.created_at).first();
 if(!follower)return;
 await ctx.sendActivity({identifier:IDENTIFIER},recipient(follower),activityFor(ctx,event,row),{immediate:true});
}
