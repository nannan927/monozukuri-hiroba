type Post={slug:string;title:string;description:string;category:string;date:string;tags:string[];body:string;cover:string;coverAlt:string;audio:string;duration:string;status:'draft'|'published'|'trash';version?:number;updatedAt?:string;sketch?:string;sonicPi?:string;savedAt?:string};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const form=$<HTMLFormElement>('post-form'), login=$<HTMLFormElement>('login-form');
const field=(name:string)=>form.elements.namedItem(name) as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
let csrf='',configured=true,posts:Post[]=[],current:Post|null=null,dirty=false,busy=false;
const names:Record<string,string>={writing:'文章',work:'仕事',art:'絵画',music:'音楽',video:'映像',research:'研究',development:'開発'};
const states={draft:'下書き',published:'公開中',trash:'ごみ箱'};
const notice=(text:string,error=false)=>{$('notice').textContent=text;$('notice').dataset.error=String(error);};
const saved=(text:string,error=false)=>{$('save-status').textContent=text;$('save-status').dataset.error=String(error);};
async function api(path:string,method='GET',data?:unknown){
 const response=await fetch('/api/admin/'+path,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'操作に失敗しました。');return result;
}
function lock(value:boolean){busy=value;form.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=value);}
function mayLeave(){return !dirty||confirm('保存していない変更があります。変更を破棄して移動しますか？');}
function today(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);}
function renderList(){
 const query=$<HTMLInputElement>('filter-search').value.normalize('NFKC').toLowerCase(),filter=$<HTMLSelectElement>('filter-status').value;
 const selected=posts.filter(p=>(filter==='all'||(filter==='active'?p.status!=='trash':p.status===filter))&&`${p.title} ${p.tags.join(' ')}`.normalize('NFKC').toLowerCase().includes(query));
 $('list-count').textContent=`${selected.length}件`;
 $('post-list').replaceChildren(...selected.map(p=>{const b=document.createElement('button');b.type='button';b.className='admin-post';b.setAttribute('aria-current',String(p.slug===current?.slug));const title=document.createElement('strong');title.textContent=p.title;const meta=document.createElement('small');meta.textContent=`${states[p.status]} · ${names[p.category]} · ${p.date}`;b.append(title,meta);b.onclick=()=>openPost(p.slug);return b;}));
}
async function refreshList(){posts=(await api('posts')).posts;renderList();}
function fill(post:Post,isDirty=false){
 current=post;for(const key of ['slug','title','description','category','date','body','cover','coverAlt','audio','duration'])field(key).value=String(post[key as keyof Post]??'');field('tags').value=post.tags.join(', ');
 (field('slug') as HTMLInputElement).readOnly=!!post.version;
 $('editor-empty').hidden=true;form.hidden=false;$('editor-title').textContent=post.version?'投稿を編集':'新しい投稿';$('post-state').textContent=states[post.status];
 const link=$<HTMLAnchorElement>('public-link');link.hidden=post.status!=='published'||!post.version;link.href='/works/'+post.slug+'/';
 $('publish-post').textContent=post.status==='published'?'公開して保存':'公開する';$('draft-post').textContent=post.status==='published'?'下書きに戻す':post.status==='trash'?'下書きとして復元':'下書き保存';
 $('trash-post').hidden=!post.version||post.status==='trash';$('history-panel').hidden=!post.version;$('history-list').replaceChildren();$('special-note').hidden=!post.sketch&&!post.sonicPi;
 dirty=isDirty;saved(isDirty?'履歴を読み込みました。保存するまで反映されません。':post.updatedAt?`最終保存：${new Date(post.updatedAt).toLocaleString('ja-JP')}`:'');renderList();
}
async function openPost(slug:string){if(busy||!mayLeave())return;try{fill((await api('posts/'+slug)).post);}catch(e){notice((e as Error).message,true);}}
function read(status:Post['status']):Post{return {...current!,slug:field('slug').value.trim(),title:field('title').value,description:field('description').value,category:field('category').value,date:field('date').value,tags:field('tags').value.split(/[,、]/).map(t=>t.trim()).filter(Boolean),body:field('body').value,cover:field('cover').value.trim(),coverAlt:field('coverAlt').value,audio:field('audio').value.trim(),duration:field('duration').value,status};}
async function save(status:Post['status']){
 if(busy||!form.reportValidity())return;
 if(status==='trash'&&!confirm('この投稿をごみ箱に移します。公開ページからは非表示になります。よろしいですか？'))return;
 if(status==='draft'&&current?.status==='published'&&!confirm('公開を取り下げて下書きに戻します。よろしいですか？'))return;
 lock(true);saved('保存中…');
 try{const post=read(status),result=await api(current?.version?'posts/'+current.slug:'posts',current?.version?'PUT':'POST',post);fill(result.post);await refreshList();saved(status==='published'?'公開しました。サイトに反映されています。':status==='trash'?'ごみ箱に移しました。':'下書きを保存しました。');notice('');}catch(e){saved((e as Error).message,true);}finally{lock(false);}
}
async function init(){
 try{const s=await api('session');configured=s.configured;
  if(s.authenticated){csrf=s.csrf;$('login-panel').hidden=true;$('workspace').hidden=false;await refreshList();notice('');void refreshFederation();}
  else{$('workspace').hidden=true;$('login-panel').hidden=false;$('login-title').textContent=configured?'ログイン':'初回設定';$('login-description').textContent=configured?'管理者のパスワードを入力してください。':'初期設定コードと、14文字以上のパスワードを入力してください。';$('setup-token-label').hidden=configured;$('password-confirm-label').hidden=configured;$<HTMLInputElement>('password-confirm').required=!configured;$<HTMLInputElement>('setup-token').required=!configured;$<HTMLInputElement>('login-password').autocomplete=configured?'current-password':'new-password';$('login-submit').textContent=configured?'ログイン':'管理者を設定';notice('');}
 }catch(e){notice((e as Error).message,true);}
}
async function refreshFederation(){
 const el=$('federation-status');
 try{const status=await api('federation');el.hidden=!status.enabled;$('reading-panel').hidden=!status.enabled;$('retry-federation').hidden=!status.failed;if(status.enabled)el.textContent=`外部フォロワー ${status.followers}人。新作の公開時に、見出し・説明・表紙画像・作品へのリンクを届けます。${status.pending?` 配信の準備待ち ${status.pending}件。`:''}${status.failed?` 送受信に失敗した通信が${status.failed}件あります。`:''}`;}
 catch{el.hidden=false;el.textContent='外部への配信状況を取得できませんでした。ページを開き直すと再確認できます。';}
}
type FollowProfile={actor:string;name:string;profile_url:string};
type Subscription=FollowProfile&{id:string;status:'pending'|'accepted'|'rejected'|'cancelling';delivery_pending:number};
type Received=FollowProfile&{seq:number;url:string;title:string;html:string;summary:string;sensitive:number;published:string|null;received_at:string};
let followPreview:FollowProfile|null=null,readingNext:string|null=null,readingBusy=false;
const readingNotice=(text:string,error=false)=>{$('reading-notice').textContent=text;$('reading-notice').dataset.error=String(error);};
function externalLink(label:string,url:string){const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function showFollowing(items:Subscription[]){
 const labels={pending:'承認待ち',accepted:'フォロー中',rejected:'申請が承認されませんでした',cancelling:'解除の送信待ち'};
 $('following-list').replaceChildren(...items.map(item=>{const row=document.createElement('div');row.className='following-item';row.append(externalLink(item.name,item.profile_url));const actor=document.createElement('small');actor.textContent=item.actor;const state=document.createElement('p');state.textContent=item.status==='pending'&&item.delivery_pending?'申請の送信待ち':labels[item.status];const button=document.createElement('button');button.type='button';button.textContent=item.status==='pending'?'申請を取り消す':item.status==='rejected'?'一覧から外す':'フォローを解除';button.disabled=item.status==='cancelling';button.onclick=async()=>{button.disabled=true;try{await api('reading/unfollow','POST',{id:item.id});readingNotice('解除を受け付けました。相手への通知を順次送信します。');await refreshReading();}catch(e){readingNotice((e as Error).message,true);button.disabled=false;}};row.append(actor,state,button);return row;}));
 if(!items.length)$('following-list').textContent='まだフォロー先がありません。';
}
function showReceived(items:Received[],append=false){
 if(!append)$('reading-inbox').replaceChildren();
 for(const item of items){
  const article=document.createElement('article');article.className='reading-item';article.append(externalLink(item.name,item.profile_url));
  const time=document.createElement('small');const date=new Date(item.published||item.received_at);time.textContent=Number.isNaN(date.getTime())?'':date.toLocaleString('ja-JP');article.append(time);
  if(item.title){const title=document.createElement('h3');title.textContent=item.title;article.append(title);}
  const content=document.createElement('div');content.className='reading-body';content.innerHTML=item.html;
  if(item.summary||item.sensitive){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=item.summary||'内容を表示する';details.append(summary,content);article.append(details);}else article.append(content);
  article.append(externalLink('元の投稿を開く ↗',item.url));$('reading-inbox').append(article);
 }
 if(!$('reading-inbox').children.length)$('reading-inbox').textContent='受信した新作はまだありません。';
}
async function refreshReading(more=false){
 if(readingBusy)return;readingBusy=true;$<HTMLButtonElement>('refresh-reading').disabled=true;$<HTMLButtonElement>('more-reading').disabled=true;
 try{
  const feed=await api('reading/inbox'+(more&&readingNext?'?before='+encodeURIComponent(readingNext):''));
  if(!more)showFollowing((await api('reading/following')).items);
  showReceived(feed.items,more);readingNext=feed.next;$('more-reading').hidden=!readingNext;
 }catch(e){readingNotice((e as Error).message,true);}finally{readingBusy=false;$<HTMLButtonElement>('refresh-reading').disabled=false;$<HTMLButtonElement>('more-reading').disabled=false;}
}
$('reading-panel').addEventListener('toggle',()=>{if($<HTMLDetailsElement>('reading-panel').open)void refreshReading();});
$('refresh-reading').onclick=()=>{void refreshReading();void refreshFederation();};
$('more-reading').onclick=()=>void refreshReading(true);
$<HTMLInputElement>('follow-address').addEventListener('input',()=>{followPreview=null;$('follow-preview').hidden=true;});
$<HTMLFormElement>('follow-search-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=$<HTMLButtonElement>('lookup-follow');button.disabled=true;followPreview=null;$('follow-preview').hidden=true;readingNotice('相手を確認しています…');
 const address=$<HTMLInputElement>('follow-address').value.trim();
 try{const result=await api('reading/lookup','POST',{address});if($<HTMLInputElement>('follow-address').value.trim()!==address)return;followPreview=result.profile;$('follow-preview-name').textContent=followPreview!.name;const link=$<HTMLAnchorElement>('follow-preview-link');link.href=followPreview!.profile_url;link.textContent=followPreview!.actor;$('follow-preview').hidden=false;readingNotice('相手を確認して、フォローボタンを押してください。');}catch(e){readingNotice((e as Error).message,true);}finally{button.disabled=false;}
});
$('confirm-follow').onclick=async()=>{
 if(!followPreview)return;const button=$<HTMLButtonElement>('confirm-follow');button.disabled=true;
 try{const result=await api('reading/follow','POST',{address:followPreview.actor});readingNotice(result.subscription.status==='accepted'?'すでにフォローしています。':result.subscription.status==='cancelling'?'解除の送信待ちです。完了後にもう一度フォローできます。':'フォロー申請を受け付けました。承認後に届く新作をここで読めます。');followPreview=null;$('follow-preview').hidden=true;await refreshReading();}catch(e){readingNotice((e as Error).message,true);}finally{button.disabled=false;}
};
$<HTMLButtonElement>('retry-federation').onclick=async()=>{const button=$<HTMLButtonElement>('retry-federation');button.disabled=true;try{const result=await api('federation/retry','POST',{});notice(`${result.retried}件の通信を再試行の待ち行列に戻しました。`);await refreshFederation();}catch(e){notice((e as Error).message,true);}finally{button.disabled=false;}};
// The one-time setup code stays in the fragment and is removed from browser history.
const token=new URLSearchParams(location.hash.slice(1)).get('setup');if(token){$<HTMLInputElement>('setup-token').value=token;history.replaceState(null,'',location.pathname);}
login.addEventListener('submit',async event=>{event.preventDefault();const password=$<HTMLInputElement>('login-password').value;if(!configured&&password!==$<HTMLInputElement>('password-confirm').value){notice('確認用のパスワードが一致しません。',true);return;}$<HTMLButtonElement>('login-submit').disabled=true;try{await api(configured?'login':'setup','POST',{password,token:$<HTMLInputElement>('setup-token').value});login.reset();await init();}catch(e){notice((e as Error).message,true);}finally{$<HTMLButtonElement>('login-submit').disabled=false;}});
$('new-post').onclick=()=>{if(busy||!mayLeave())return;fill({slug:`post-${today()}-${crypto.randomUUID().slice(0,6)}`,title:'',description:'',category:'writing',date:today(),tags:[],body:'',cover:'',coverAlt:'',audio:'',duration:'',status:'draft'});field('title').focus();};
form.addEventListener('input',()=>{dirty=true;saved('未保存の変更があります。');});form.addEventListener('change',()=>{dirty=true;});
form.addEventListener('submit',event=>{event.preventDefault();save('published');});$('draft-post').onclick=()=>save('draft');$('trash-post').onclick=()=>save('trash');
$('filter-search').addEventListener('input',renderList);$('filter-status').addEventListener('change',renderList);
$('logout').onclick=async()=>{if(busy||!mayLeave())return;try{await api('logout','POST',{});dirty=false;location.reload();}catch(e){notice((e as Error).message,true);}};
$('preview-post').onclick=async()=>{if(busy||!form.reportValidity())return;lock(true);try{const result=await api('preview','POST',read(current?.status||'draft'));$<HTMLDialogElement>('preview-dialog').querySelector('iframe')!.srcdoc=result.html;$<HTMLDialogElement>('preview-dialog').showModal();}catch(e){saved((e as Error).message,true);}finally{lock(false);}};
$('close-preview').onclick=()=>$<HTMLDialogElement>('preview-dialog').close();
$('export-posts').onclick=async()=>{try{const data=await api('export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`hiroba-posts-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice((e as Error).message,true);}};
$('load-history').onclick=async()=>{if(!current?.version)return;try{const result=await api('posts/'+current.slug+'/revisions');$('history-list').replaceChildren(...result.revisions.map((r:Post)=>{const b=document.createElement('button');b.type='button';b.className='history-item';b.textContent=`版 ${r.version} · ${r.savedAt?new Date(r.savedAt).toLocaleString('ja-JP'):''} · ${r.title}`;b.onclick=()=>{if(!mayLeave())return;fill({...current!,...r,slug:current!.slug,version:current!.version,status:current!.status},true);};return b;}));if(!result.revisions.length)$('history-list').textContent='過去の保存内容はまだありません。';}catch(e){saved((e as Error).message,true);}};
$<HTMLFormElement>('password-form').addEventListener('submit',async event=>{event.preventDefault();if(!mayLeave())return;const f=event.currentTarget as HTMLFormElement,data=new FormData(f);if(data.get('password')!==data.get('confirm')){notice('確認用のパスワードが一致しません。',true);return;}try{await api('password','POST',{current:data.get('current'),password:data.get('password')});dirty=false;location.reload();}catch(e){notice((e as Error).message,true);}});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();}});
init();
