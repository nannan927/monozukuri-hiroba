// API smoke test against the local workerd runtime. Never run against production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base='http://localhost:8788';
const {token}=JSON.parse(readFileSync('.admin-private/local-setup.json','utf8'));
let cookie='',csrf='';
async function call(path,method='GET',data){const r=await fetch(base+path,{method,headers:{origin:base,...(method!=='GET'?{'content-type':'application/json'}:{}),...(cookie?{cookie,'x-csrf-token':csrf}:{})},...(data?{body:JSON.stringify(data)}:{})});return r;}
assert.equal((await call('/admin/')).status,200);
assert.equal((await call('/api/admin/posts')).status,401);
const setup=await call('/api/admin/setup','POST',{token,password:'local-runtime-password-241'});assert.equal(setup.status,200,await setup.clone().text());cookie=setup.headers.get('set-cookie').split(';')[0];csrf=(await setup.json()).csrf;
assert.equal((await (await call('/api/admin/posts')).json()).posts.length,38);
const input={slug:'runtime-test',title:'Runtime test',description:'local only',category:'diary',date:'2026-11-05',tags:[],body:'## 動作確認\n\n**本文**です。',status:'draft',cover:'',coverAlt:'',audio:'',duration:''};
let r=await call('/api/admin/posts','POST',input);assert.equal(r.status,201,await r.clone().text());let post=(await r.json()).post;
assert.equal((await call('/works/runtime-test/')).status,404);
r=await call('/api/admin/preview','POST',post);assert.equal(r.status,200,await r.clone().text());assert.match((await r.json()).html,/<strong>本文<\/strong>/);
r=await call('/api/admin/posts/runtime-test','PUT',{...post,status:'published'});assert.equal(r.status,200,await r.clone().text());post=(await r.json()).post;
assert.equal((await call('/works/runtime-test/')).status,200);
r=await call('/api/admin/posts/runtime-test','PUT',{...post,status:'trash'});assert.equal(r.status,200,await r.clone().text());
assert.equal((await call('/works/runtime-test/')).status,404);
await call('/api/admin/logout','POST',{});assert.equal((await call('/api/admin/posts')).status,401);
console.log('PASS: workerd + D1 setup/login, protected API, create/preview/publish/trash/logout, SSR and Markdown.');
