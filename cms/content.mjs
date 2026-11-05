import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export class InputError extends Error {}
export const categories = [
 ['writing','文章','WORDS'],['diary','日記','DIARY'],['art','絵画','ART'],
 ['music','音楽','MUSIC'],['study','学問','STUDY'],['development','開発','DEVELOPMENT']
];
export const esc = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const categoryName = id => categories.find(c=>c[0]===id)?.[1] || '';
export const safeUrl = value => !value || (/^\/(?!\/)/.test(value) && !/[\\\s\x00-\x1f]/.test(value)) || /^https:\/\/[^\s\\]+$/i.test(value);
export function markdown(body) {
 return sanitizeHtml(marked.parse(body, {gfm:true, breaks:false, async:false}), {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
  allowedAttributes: {a:['href','title'],img:['src','alt','title','width','height','loading'],code:['class'],th:['align'],td:['align']},
  allowedSchemes: ['http','https','mailto'], allowProtocolRelative:false,
  transformTags: {img: (_tag, attrs) => ({tagName:'img',attribs:{...attrs,loading:'lazy'}})},
 });
}
export function validatePost(input, existing) {
 if (!input || typeof input !== 'object') throw new InputError('投稿データが正しくありません。');
 const str=(key,max,required=false)=>{const value=input[key]??'';if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new InputError(`${key}を確認してください（最大${max}文字）。`);return value.trim();};
 const slug=str('slug',100,true);
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new InputError('URLには半角英小文字・数字・ハイフンを使ってください。');
 if(existing && slug!==existing.slug)throw new InputError('公開URLは変更できません。');
 const title=str('title',160,true), description=str('description',500), category=str('category',30,true), date=str('date',10,true);
 if(!categories.some(c=>c[0]===category))throw new InputError('分野を選んでください。');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new InputError('日付を確認してください。');
 if(!['draft','published','trash'].includes(input.status))throw new InputError('公開状態を確認してください。');
 if(typeof input.body!=='string'||input.body.length>200000)throw new InputError('本文は20万文字以内にしてください。');
 if(!Array.isArray(input.tags)||input.tags.length>20||input.tags.some(t=>typeof t!=='string'||t.length>40))throw new InputError('タグは40文字以内、20個までです。');
 const cover=str('cover',2048), coverAlt=str('coverAlt',300), audio=str('audio',2048), duration=str('duration',40);
 if(!safeUrl(cover)||!safeUrl(audio))throw new InputError('画像・音源はhttpsのURLまたはサイト内のパスを指定してください。');
 if(cover&&!coverAlt)throw new InputError('画像の説明を入力してください。');
 const retained={};
 for(const key of ['source','sourceOrder','sourceCategory','sketch','sonicPi','emptySource']) if(existing?.[key]!==undefined)retained[key]=existing[key];
 return {...retained,slug,title,description,category,date,status:input.status,tags:[...new Set(input.tags.map(t=>t.trim()).filter(Boolean))],cover,coverAlt,audio,duration,body:input.body,html:markdown(input.body)};
}
export const fromRow = row => ({...JSON.parse(row.document),slug:row.slug,status:row.status,version:row.version,updatedAt:row.updated_at});
export const sortPosts = posts => posts.sort((a,b)=>b.date.localeCompare(a.date)||(a.sourceOrder??999999)-(b.sourceOrder??999999)||a.slug.localeCompare(b.slug));
