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
const sample=()=>({slug:'new-test-post',title:'秘密タイトル241',description:'説明',category:'work',date:'2026-11-05',tags:['秘密タグ241'],body:'## 本文\n\nテストの本文です。',cover:'',coverAlt:'',audio:'',duration:'',status:'draft'});

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
  for(const path of ['/','/work/','/works/','/search/?q=秘密','/rss.xml'])assert.ok(!(await (await f.request(path)).text()).includes(post.title),path);
  assert.equal((await f.request('/works/'+post.slug+'/')).status,404);
  post=(await (await f.request('/api/admin/posts/'+post.slug,'PUT',{...post,status:'published'})).json()).post;
  for(const path of ['/','/work/','/works/','/search/?q=秘密','/rss.xml'])assert.ok((await (await f.request(path)).text()).includes(post.title),path);
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

test('work, video and research can be published, filtered and chosen in the admin',async()=>{
 const f=await fixture();try{
  await f.login();
  const choices=[['work','仕事'],['video','映像'],['research','研究']];
  const admin=load(readFileSync('dist/admin/index.html','utf8'));
  const homepage=load(await (await f.request('/')).text());
  for(const [category,label] of choices){
   assert.equal(admin(`select[name="category"] option[value="${category}"]`).text(),label);
   assert.equal(homepage(`.main-nav a[href="/${category}/"]`).text(),label);
   assert.ok(homepage(`.directory-list a[href="/${category}/"]`).text().includes(label));
   const input={...sample(),slug:`category-${category}`,title:`${label}の公開テスト`,category,status:'published'};
   const created=await f.request('/api/admin/posts','POST',input);assert.equal(created.status,201,await created.clone().text());
   const listing=await f.request(`/${category}/`);assert.equal(listing.status,200);
   const $=load(await listing.text());assert.equal($('h1').text(),label);assert.ok($('.work-card').text().includes(input.title));
   const filtered=load(await (await f.request(`/works/?category=${category}`)).text());
   assert.equal(filtered('.work-card').length,1);assert.ok(filtered('.work-card').text().includes(input.title));
   const detail=load(await (await f.request(`/works/${input.slug}/`)).text());assert.equal(detail('.category-label').text(),label);
  }
  for(const retired of ['diary','study']){
   assert.equal(admin(`select[name="category"] option[value="${retired}"]`).length,0);
   assert.equal(homepage(`.main-nav a[href="/${retired}/"]`).length,0);
   assert.equal((await f.request('/api/admin/posts','POST',{...sample(),slug:`retired-${retired}`,category:retired})).status,400);
  }
  const sea='/works/2024-01-10-sea-on-the-map/';
  const article=load(await (await f.request(sea)).text());assert.equal(article('.category-label').text(),'文章');
  assert.ok(load(await (await f.request('/writing/')).text())(`.work-card a[href="${sea}"]`).length);
  assert.equal(load(await (await f.request('/work/')).text())(`.work-card a[href="${sea}"]`).length,0);
  for(const [old,next] of [['/diary/','/work/'],['/study/','/research/']]){
   const response=await f.request(old);assert.equal(response.status,301);assert.equal(response.headers.get('location'),origin+next);
  }
 }finally{f.close();}
});

test('category migration preserves content and history, rejects stale edits and is repeatable',async()=>{
 const f=await fixture();try{
  await f.login();
  const db=f.DB.db,sea='2024-01-10-sea-on-the-map';
  db.prepare("UPDATE posts SET category='diary',document=json_set(document,'$.category','diary','$.tags',json(?)) WHERE slug=?").run('["日記","残すタグ"]',sea);
  for(const [category,status] of [['diary','draft'],['study','trash']]){
   const document={...sample(),slug:`legacy-${category}`,title:`保存済みの${category}`,category,status,html:'<p>編集済みの本文</p>',body:'編集済みの本文'};
   db.prepare('INSERT INTO posts(slug,title,category,date,status,document,version,updated_at) VALUES(?,?,?,?,?,?,7,?)').run(document.slug,document.title,category,document.date,status,JSON.stringify(document),'before-migration');
  }
  const old=db.prepare('SELECT * FROM posts ORDER BY slug').all();
  const sql=readFileSync('migrations/0002_categories.sql','utf8');db.exec(sql);
  const migrated=db.prepare('SELECT * FROM posts ORDER BY slug').all();assert.equal(migrated.length,old.length);
  for(let i=0;i<old.length;i++){
   const before=old[i],after=migrated[i],a=JSON.parse(before.document),b=JSON.parse(after.document);
   if(!['diary','study'].includes(before.category)){assert.deepEqual(after,before);continue;}
   const expected=before.slug===sea?'writing':before.category==='diary'?'work':'research';
   assert.equal(after.category,expected);assert.equal(b.category,expected);assert.equal(after.version,before.version+1);assert.equal(after.status,before.status);
   assert.deepEqual(b,{...a,category:expected,tags:before.slug===sea?['残すタグ']:a.tags});
   const revision=db.prepare('SELECT document,status FROM revisions WHERE slug=? AND version=?').get(before.slug,before.version);
   assert.equal(revision.document,before.document);assert.equal(revision.status,before.status);
   const history=(await (await f.request(`/api/admin/posts/${before.slug}/revisions`)).json()).revisions;
   assert.equal(history[0].category,expected);assert.equal(history[0].body,a.body);
   assert.equal((await f.request(`/api/admin/posts/${before.slug}`,'PUT',{...history[0],version:before.version})).status,409);
  }
  const historyCount=db.prepare('SELECT COUNT(*) n FROM revisions').get().n;
  db.exec(sql);assert.deepEqual(db.prepare('SELECT * FROM posts ORDER BY slug').all(),migrated);assert.equal(db.prepare('SELECT COUNT(*) n FROM revisions').get().n,historyCount);
  const latest=(await (await f.request(`/api/admin/posts/${sea}`)).json()).post;
  const historical=(await (await f.request(`/api/admin/posts/${sea}/revisions`)).json()).revisions[0];
  assert.equal((await f.request(`/api/admin/posts/${sea}`,'PUT',{...latest,...historical,version:latest.version})).status,200);
 }finally{f.close();}
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
