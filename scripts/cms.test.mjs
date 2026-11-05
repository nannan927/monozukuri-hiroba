import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import worker from '../cms/worker.mjs';
import {digest,randomToken} from '../cms/auth.mjs';
import {markdown,validatePost} from '../cms/content.mjs';
const origin='https://monozukuri-hiroba-tomo.pages.dev';
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync('migrations/0001_cms.sql','utf8'));this.db.exec(readFileSync('cms/generated/seed.sql','utf8'));}
 prepare(sql){let args=[];const db=this.db;const result=()=>{const stmt=db.prepare(sql);if(/^\s*(SELECT|PRAGMA)/i.test(sql)||/\bRETURNING\b/i.test(sql)){const results=stmt.all(...args);return {results,meta:{changes:db.prepare('SELECT changes() n').get().n}};}const r=stmt.run(...args);return {results:[],meta:{changes:Number(r.changes)}};};return {bind(...values){args=values;return this;},async first(){return result().results[0]||null;},async all(){return result();},async run(){return result();}};}
 async batch(statements){this.db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());this.db.exec('COMMIT');return results;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
async function fixture(){
 const DB=new D1(),token=randomToken();DB.db.prepare('INSERT INTO admin(id,setup_hash,setup_expires,updated_at) VALUES(1,?,?,?)').run(await digest(token),Math.floor(Date.now()/1000)+3600,0);
 const env={DB,ASSETS:{fetch:async()=>new Response('static asset')}};let authCookie='',csrf='';
 const request=(path,method='GET',data,extra={})=>worker.fetch(new Request(origin+path,{method,headers:{...(method==='GET'?{}:{origin,'content-type':'application/json'}),...(authCookie?{cookie:authCookie,'x-csrf-token':csrf}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
 async function login(){const r=await request('/api/admin/setup','POST',{token,password:'test-password-very-long-241'});assert.equal(r.status,200,await r.clone().text());authCookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf;return authCookie;}
 return {DB,request,login,token,close:()=>DB.db.close()};
}
const sample=()=>({slug:'new-test-post',title:'秘密タイトル241',description:'説明',category:'diary',date:'2026-11-05',tags:['秘密タグ241'],body:'## 本文\n\nテストの本文です。',cover:'',coverAlt:'',audio:'',duration:'',status:'draft'});

test('owner setup, session, CSRF and logout guard every admin write',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('/api/admin/posts')).status,401);
  assert.equal((await f.request('/api/admin/export')).status,401);
  assert.equal((await f.request('/api/admin/setup','POST',{token:'wrong',password:'test-password-very-long'})).status,403);
  const cookie=await f.login();assert.match(cookie,/^__Host-hiroba_session=/);
  assert.equal((await f.request('/api/admin/setup','POST',{token:f.token,password:'test-password-very-long'})).status,403);
  assert.equal((await f.request('/api/admin/posts','POST',sample(),{origin:'https://evil.invalid'})).status,403);
  assert.equal((await f.request('/api/admin/posts','POST',sample(),{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await f.request('/api/admin/posts','POST',sample())).status,201);
  const logout=await f.request('/api/admin/logout','POST',{});assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await f.request('/api/admin/posts')).status,401);
  const bad=await f.request('/api/admin/login','POST',{password:'incorrect'});assert.equal(bad.status,401);
  const good=await f.request('/api/admin/login','POST',{password:'test-password-very-long-241'});assert.equal(good.status,200);assert.match(good.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 }finally{f.close();}
});

test('draft, publish, edit conflict, revisions, trash and restore reach public pages atomically',async()=>{
 const f=await fixture();try{
  await f.login();let post=(await (await f.request('/api/admin/posts','POST',sample())).json()).post;
  for(const path of ['/','/diary/','/works/','/search/?q=秘密','/rss.xml'])assert.ok(!(await (await f.request(path)).text()).includes(post.title),path);
  assert.equal((await f.request('/works/'+post.slug+'/')).status,404);
  post=(await (await f.request('/api/admin/posts/'+post.slug,'PUT',{...post,status:'published'})).json()).post;
  for(const path of ['/','/diary/','/works/','/search/?q=秘密','/rss.xml'])assert.ok((await (await f.request(path)).text()).includes(post.title),path);
  const old={...post};post=(await (await f.request('/api/admin/posts/'+post.slug,'PUT',{...post,title:'編集後のタイトル'})).json()).post;
  assert.equal((await f.request('/api/admin/posts/'+post.slug,'PUT',old)).status,409);
  const history=await (await f.request('/api/admin/posts/'+post.slug+'/revisions')).json();assert.equal(history.revisions.length,2);
  post=(await (await f.request('/api/admin/posts/'+post.slug,'PUT',{...post,status:'trash'})).json()).post;
  assert.equal((await f.request('/works/'+post.slug+'/')).status,404);
  for(const alias of ['/works/'+post.slug+'/index.html','/works/'+post.slug+'.html'])assert.equal((await f.request(alias)).status,301);
  post=(await (await f.request('/api/admin/posts/'+post.slug,'PUT',{...post,status:'draft'})).json()).post;assert.equal(post.status,'draft');
  const exported=await (await f.request('/api/admin/export')).json();assert.equal(exported.posts.length,39);assert.equal(exported.format,'hiroba-posts-v1');assert.ok(!JSON.stringify(exported).includes('password_hash'));
 }finally{f.close();}
});

test('all 36 migrated article bodies remain intact, widgets and legacy links survive',async()=>{
 const f=await fixture();try{
  const migration=JSON.parse(readFileSync('migration/tomooooo.json','utf8'));
  for(const record of migration.articles){const response=await f.request(record.destination);assert.equal(response.status,200);const $=load(await response.text());const text=$('.article-body').text().replace(/\s/g,'');assert.equal(createHash('sha256').update(text).digest('hex'),record.normalizedTextSha256,record.title);assert.equal($('h1').first().text(),record.title);}
  const art=await (await f.request('/works/autumn-dusk/')).text();assert.match(art,/data-art-canvas/);assert.match(art,/type="module" src=/);
  assert.match(await (await f.request('/works/afternoon-space/')).text(),/data-sonic-source/);
  const redirects=JSON.parse(readFileSync('src/data/legacy-redirects.json','utf8'));for(const [old,next] of Object.entries(redirects)){const r=await f.request(encodeURI(old));assert.equal(r.status,301);assert.equal(decodeURI(r.headers.get('location')),origin+next);}
  await f.login();const target=migration.articles[0].destination.split('/')[2];let p=(await (await f.request('/api/admin/posts/'+target)).json()).post;await f.request('/api/admin/posts/'+target,'PUT',{...p,status:'draft'});assert.equal((await f.request('/works/'+target+'/')).status,404);assert.ok(!(await (await f.request('/rss.xml')).text()).includes('/works/'+target+'/'));
  assert.ok(!existsSync('dist/works/'+target+'/index.html'),'no old static copy can bypass private status');
 }finally{f.close();}
});

test('input validation and Markdown block stored XSS and invalid publication URLs',()=>{
 const safe=markdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[link](javascript:alert(1))');assert.ok(!/<script|onerror=|href="javascript:/i.test(safe));
 assert.throws(()=>validatePost({...sample(),cover:'javascript:alert(1)',coverAlt:'x'}));
 assert.throws(()=>validatePost({...sample(),slug:'../admin'}));
 assert.throws(()=>validatePost({...sample(),date:'2026-02-30'}));
 assert.throws(()=>validatePost({...sample(),status:'scheduled'}));
 const p=validatePost({...sample(),sketch:'autumn-dusk'});assert.equal(p.sketch,undefined);
});

test('login throttling and expired setup prevent guessing',async()=>{
 const f=await fixture();try{
  f.DB.db.prepare('UPDATE admin SET setup_expires=0').run();assert.equal((await f.request('/api/admin/setup','POST',{token:f.token,password:'test-password-very-long'})).status,403);
  let response;for(let i=0;i<11;i++)response=await f.request('/api/admin/login','POST',{password:'wrong'});assert.equal(response.status,429);
 }finally{f.close();}
});

test('password change revokes the current session',async()=>{
 const f=await fixture();try{await f.login();assert.equal((await f.request('/api/admin/password','POST',{current:'test-password-very-long-241',password:'a-new-long-test-password'})).status,200);assert.equal((await f.request('/api/admin/posts')).status,401);assert.equal((await f.request('/api/admin/login','POST',{password:'test-password-very-long-241'})).status,401);assert.equal((await f.request('/api/admin/login','POST',{password:'a-new-long-test-password'})).status,200);}finally{f.close();}
});
