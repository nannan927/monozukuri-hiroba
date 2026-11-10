import templates from './generated/templates.json' with { type: 'json' };
import redirects from '../src/data/legacy-redirects.json' with { type: 'json' };
import {validatePost,fromRow,sortPosts,InputError,normalizeLegacyPost} from './content.mjs';
import {session,newSession,cookie,digest,equal,passwordHash,validPassword,randomToken,rateLimit} from './auth.mjs';
import {publicPage,rss,article,shell} from './render.mjs';
import {federationPath,federationFetch,federationEnabled,flushPublications,ORIGIN} from './federation.mjs';

const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{...noStore,'Content-Type':'application/json; charset=utf-8',...headers}});
const html=(body,status=200,privatePage=false)=>new Response(body,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',...(privatePage?{'X-Robots-Tag':'noindex, nofollow'}:{})}});
const getPost=(db,slug)=>db.prepare('SELECT * FROM posts WHERE slug=?').bind(slug).first();
const published=async db=>sortPosts((await db.prepare("SELECT * FROM posts WHERE status='published' ORDER BY date DESC").all()).results.map(fromRow));

async function body(request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new InputError('JSON形式で送信してください。');
 const reader=request.body?.getReader();if(!reader)throw new InputError('内容がありません。');
 let size=0;const chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw new InputError('送信内容が大きすぎます。');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}

async function api(request,env,url){
 const db=env.DB,path=url.pathname,now=Math.floor(Date.now()/1000),method=request.method;
 if(!db)return json({error:'管理機能の準備中です。'},503);
 if(!['GET','POST','PUT'].includes(method))return json({error:'この操作は使えません。'},405);
 if(method!=='GET'&&request.headers.get('origin')!==url.origin)return json({error:'送信元を確認できません。ページを開き直してください。'},403);
 const auth=await session(request,db);
 if(path==='/api/admin/session'&&method==='GET'){
  const owner=await db.prepare('SELECT password_hash FROM admin WHERE id=1').first();
  return json({authenticated:!!auth,configured:!!owner?.password_hash,...(auth?{csrf:auth.csrf}:{})});
 }
 if((path==='/api/admin/login'||path==='/api/admin/setup')&&method==='POST'){
  if(!await rateLimit(request,db))return json({error:'試行回数が多いため、15分ほど待ってからお試しください。'},429,{'Retry-After':'900'});
  const input=await body(request),owner=await db.prepare('SELECT * FROM admin WHERE id=1').first();
  if(!owner)return json({error:'初期設定がまだ準備されていません。'},503);
  if(path.endsWith('/setup')){
   if(owner.password_hash||!owner.setup_hash||owner.setup_expires<now||typeof input.token!=='string'||!equal(await digest(input.token),owner.setup_hash))return json({error:'初期設定リンクが無効か、期限切れです。'},403);
   if(!validPassword(input.password))return json({error:'パスワードは14〜256文字で設定してください。'},400);
   const salt=randomToken(),hash=await passwordHash(input.password,salt);
   const result=await db.prepare('UPDATE admin SET password_hash=?,salt=?,setup_hash=NULL,setup_expires=NULL,updated_at=? WHERE id=1 AND password_hash IS NULL AND setup_hash=? AND setup_expires>=?').bind(hash,salt,now,owner.setup_hash,now).run();
   if(result.meta.changes!==1)return json({error:'この初期設定リンクはすでに使われています。'},409);
  }else{
   if(typeof input.password!=='string'||input.password.length>256||!owner.password_hash||!equal(await passwordHash(input.password,owner.salt),owner.password_hash))return json({error:'パスワードが違います。'},401);
  }
  const created=await newSession(db);return json({csrf:created.csrf},200,{'Set-Cookie':cookie(created.token)});
 }
 if(!auth)return json({error:'ログインしてください。'},401);
 if(method!=='GET'&&!equal(request.headers.get('x-csrf-token'),auth.csrf))return json({error:'認証の有効期限を確認してください。ページを開き直してください。'},403);
 if(path==='/api/admin/federation'&&method==='GET'){
  if(!federationEnabled(env))return json({enabled:false});
  const counts=await db.prepare(`SELECT (SELECT count(*) FROM ap_followers) followers,
   (SELECT count(*) FROM ap_events WHERE queued_at IS NULL) pending,
   (SELECT count(*) FROM ap_failures) failed`).first();
  return json({enabled:true,...counts});
 }
 if(path==='/api/admin/federation/retry'&&method==='POST'){
  if(!federationEnabled(env))return json({error:'外部配信は無効です。'},503);
  const failed=(await db.prepare('SELECT id,message FROM ap_failures ORDER BY failed_at LIMIT 20').all()).results;
  for(const job of failed){await env.FEDERATION_QUEUE.send(JSON.parse(job.message));await db.prepare('DELETE FROM ap_failures WHERE id=?').bind(job.id).run();}
  return json({retried:failed.length});
 }
 if(path==='/api/admin/logout'&&method==='POST'){
  await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(auth.token_hash).run();return json({ok:true},200,{'Set-Cookie':cookie('',0)});
 }
 if(path==='/api/admin/password'&&method==='POST'){
  if(!await rateLimit(request,db))return json({error:'15分ほど待ってからお試しください。'},429);
  const input=await body(request),owner=await db.prepare('SELECT * FROM admin WHERE id=1').first();
  if(typeof input.current!=='string'||input.current.length>256||!equal(await passwordHash(input.current,owner.salt),owner.password_hash))return json({error:'現在のパスワードが違います。'},400);
  if(!validPassword(input.password))return json({error:'新しいパスワードは14〜256文字で設定してください。'},400);
  const salt=randomToken(),hash=await passwordHash(input.password,salt);
  await db.batch([db.prepare('UPDATE admin SET password_hash=?,salt=?,updated_at=? WHERE id=1').bind(hash,salt,now),db.prepare('DELETE FROM sessions')]);
  return json({ok:true},200,{'Set-Cookie':cookie('',0)});
 }
 if(path==='/api/admin/export'&&method==='GET'){
  const rows=(await db.prepare('SELECT * FROM posts ORDER BY date DESC').all()).results;
  return json({format:'hiroba-posts-v1',exportedAt:new Date().toISOString(),posts:rows.map(fromRow)},200,{'Content-Disposition':'attachment; filename="hiroba-posts.json"'});
 }
 if(path==='/api/admin/posts'&&method==='GET'){
  const posts=sortPosts((await db.prepare('SELECT * FROM posts').all()).results.map(fromRow));
  return json({posts:posts.map(({body,html,...p})=>p)});
 }
 const match=path.match(/^\/api\/admin\/posts\/([a-z0-9-]+)(\/revisions)?$/);
 if(match&&method==='GET'){
  const row=await getPost(db,match[1]);if(!row)return json({error:'投稿が見つかりません。'},404);
  if(match[2])return json({revisions:(await db.prepare('SELECT version,document,status,saved_at FROM revisions WHERE slug=? ORDER BY version DESC LIMIT 30').bind(match[1]).all()).results.map(r=>({...normalizeLegacyPost({...JSON.parse(r.document),slug:match[1]}),version:r.version,status:r.status,savedAt:r.saved_at}))});
  return json({post:fromRow(row)});
 }
 if(path==='/api/admin/preview'&&method==='POST'){
  const input=await body(request),row=input.slug?await getPost(db,input.slug):null;
  const p=validatePost(input,row?fromRow(row):undefined),posts=await published(db);
  return json({html:shell(templates.shell,article(p,templates.widgets,true),posts,{title:p.title,description:p.description,path:`/works/${p.slug}/`,origin:url.origin})});
 }
 if((path==='/api/admin/posts'&&method==='POST')||(match&&!match[2]&&method==='PUT')){
  const input=await body(request),row=match?await getPost(db,match[1]):null;
  if(match&&!row)return json({error:'投稿が見つかりません。'},404);
  if(match&&input.slug!==match[1])return json({error:'URLは変更できません。'},400);
  const post=validatePost(input,row?fromRow(row):undefined),stamp=new Date().toISOString();
  if(!row){
   const saved=await db.prepare('INSERT INTO posts(slug,title,category,date,status,document,version,updated_at) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(slug) DO NOTHING RETURNING *').bind(post.slug,post.title,post.category,post.date,post.status,JSON.stringify(post),stamp).all();
   if(!saved.results.length)return json({error:'同じURLの投稿がすでにあります。URLを変えてください。'},409);
   return json({post:fromRow(saved.results[0])},201);
  }
  if(!Number.isInteger(input.version)||input.version!==row.version)return json({error:'別の画面で更新されています。本文を控えてから、一覧より開き直してください。'},409);
  const results=await db.batch([
   db.prepare('INSERT OR IGNORE INTO revisions(slug,version,document,status,saved_at) SELECT slug,version,document,status,? FROM posts WHERE slug=? AND version=?').bind(stamp,post.slug,input.version),
   db.prepare('UPDATE posts SET title=?,category=?,date=?,status=?,document=?,version=version+1,updated_at=? WHERE slug=? AND version=? RETURNING *').bind(post.title,post.category,post.date,post.status,JSON.stringify(post),stamp,post.slug,input.version),
  ]);
  if(!results[1].results.length)return json({error:'別の画面で更新されています。本文を控えてから開き直してください。'},409);
  return json({post:fromRow(results[1].results[0])});
 }
 return json({error:'操作が見つかりません。'},404);
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);let path;
  try{path=decodeURIComponent(url.pathname);}catch{return new Response('Bad Request',{status:400});}
  try{
   if(federationPath(path))return await federationFetch(request,env);
   if(path.startsWith('/api/')){
    // Sharing the production database with a preview must not permit publishing.
    if(federationEnabled(env)&&url.origin!==ORIGIN&&request.method!=='GET')return json({error:'本番サイトの管理画面から操作してください。'},403);
    try{
     const response=await api(request,env,url);
     if(response.ok&&['POST','PUT'].includes(request.method)&&/^\/api\/admin\/posts(?:\/|$)/.test(path)&&federationEnabled(env)){
      const task=flushPublications(env).catch(error=>console.error('Federation enqueue deferred to scheduled recovery',error?.name));
      if(ctx)ctx.waitUntil(task);else await task;
     }
     return response;
    }catch(e){if(e instanceof SyntaxError||e instanceof InputError)return json({error:e.message},400);throw e;}
   }
   if(!['GET','HEAD'].includes(request.method))return new Response('Method Not Allowed',{status:405});
   if(path==='/admin'||path==='/admin/index.html')return Response.redirect(url.origin+'/admin/',302);
   if(path==='/admin/'){
    const response=await env.ASSETS.fetch(request);
    const headers=new Headers(response.headers);Object.entries(noStore).forEach(([k,v])=>headers.set(k,v));headers.set('X-Frame-Options','DENY');
    return new Response(response.body,{status:response.status,headers});
   }
   if(path.startsWith('/admin/')||path.startsWith('/_cms')||path.startsWith('/.'))return new Response('Not Found',{status:404});
   if(path.startsWith('/_astro/')||path.startsWith('/images/')||path.startsWith('/audio/')||path.startsWith('/artworks/')||path.startsWith('/music/afternoon-space/')||path==='/favicon.svg')return env.ASSETS.fetch(request);
   if(redirects[path])return Response.redirect(url.origin+encodeURI(redirects[path])+url.search,301);
   if(path.endsWith('/index.html'))return Response.redirect(url.origin+encodeURI(path.slice(0,-10))+url.search,301);
   if(path.endsWith('.html')&&path!=='/404.html')return Response.redirect(url.origin+encodeURI(path.slice(0,-5))+'/'+url.search,301);
   if(!path.endsWith('/')&&!path.includes('.'))return Response.redirect(url.origin+encodeURI(path)+'/'+url.search,301);
   if(path==='/works/'){
    const filter=url.searchParams.get('category');
    if(filter==='diary'||filter==='study'){
     url.searchParams.set('category',filter==='diary'?'work':'research');
     return Response.redirect(url.href,301);
    }
   }
   if(!env.DB)return html('<h1>ただいま準備中です</h1><p>しばらくしてからお試しください。</p>',503);
   const posts=await published(env.DB);
   if(path==='/rss.xml')return new Response(request.method==='HEAD'?null:rss(posts,url.origin),{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'no-store'}});
   const page=publicPage(path,url,posts,templates);
   if(page)return html(request.method==='HEAD'?null:page);
   const notFound=shell(templates.shell,'<header class="page-intro"><h1>ページが見つかりません</h1><p><a href="/">ホームに戻る</a></p></header>',posts,{title:'ページが見つかりません',path,origin:url.origin});
   return html(request.method==='HEAD'?null:notFound,404);
  }catch(error){console.error('CMS request failed',error?.name);return path.startsWith('/api/')?json({error:'保存先に接続できませんでした。入力を残したまま、しばらくして再試行してください。'},503):html('<h1>一時的に表示できません</h1><p>しばらくしてからお試しください。</p>',503);}
 }
};
