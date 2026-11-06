import {categories,categoryName,esc} from './content.mjs';
const pathFor=p=>`/works/${p.slug}/`;
const tags=p=>`<div class="work-tags">${p.tags.map(t=>`<a href="/search/?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>`;
const date=p=>esc(p.date.replaceAll('-','.'));
const intro=(title,kicker='')=>`<header class="page-intro"><nav class="breadcrumb"><a href="/">ホーム</a><span>/</span><span>${esc(title)}</span></nav><p class="page-kicker">${kicker}</p><h1>${esc(title)}</h1></header>`;
const postList=posts=>`<div class="post-list">${posts.map(p=>`<article><h3><a href="${pathFor(p)}">${esc(p.title)}</a></h3><time datetime="${p.date}">${date(p)}</time>${tags(p)}</article>`).join('')}</div>`;
const cards=posts=>`<div class="works-grid">${posts.map(p=>`<article class="work-card" data-category="${p.category}"><a class="work-link" href="${pathFor(p)}"><div class="work-cover cover-${p.category}">${p.cover?`<img src="${esc(p.cover)}" alt="${esc(p.coverAlt)}" loading="lazy" width="600" height="380">`:p.category==='music'?'<img src="/images/cassette.svg" alt="" width="260" height="140">':`<span>${esc(categoryName(p.category))}</span>`}</div><div><div class="work-meta"><span class="category-label">${categoryName(p.category)}</span><time datetime="${p.date}">${date(p)}</time>${p.duration?`<span>${esc(p.duration)}</span>`:''}</div><h3>${esc(p.title)}</h3><div class="work-tags">${p.tags.map(t=>`<span>#${esc(t)}</span>`).join('')}</div></div></a></article>`).join('')||'<p class="empty-content">まだ投稿はありません。</p>'}</div>`;
const external=(links)=>`<ul class="external-links">${(links||[]).map(l=>`<li><a href="${esc(l.url)}">${esc(l.title)} ↗</a></li>`).join('')}</ul>`;

export function article(post,widgets,preview=false){
 return `<article class="article-wrap"><nav class="breadcrumb"><a href="/">ホーム</a><span>/</span><a href="/${post.category}/">${categoryName(post.category)}</a></nav><div class="work-meta"><a class="category-label" href="/${post.category}/">${categoryName(post.category)}</a><time datetime="${post.date}">${date(post)}</time></div><h1>${esc(post.title)}</h1>${post.source?'':`<p class="article-description">${esc(post.description)}</p>`}${tags(post)}${preview?'<p class="sample-banner">保存前のプレビューです。</p>':''}${post.cover&&!post.sketch?`<img class="article-image" src="${esc(post.cover)}" alt="${esc(post.coverAlt)}">`:''}${post.sketch==='autumn-dusk'?widgets.art:''}${post.sonicPi==='afternoon-space'?widgets.music:''}${post.audio?`<div class="audio-player"><p>${esc(post.title)}</p><audio controls preload="metadata" src="${esc(post.audio)}" aria-label="${esc(post.title)}を試聴"></audio><small>${esc(post.duration)} · 自動再生はしません</small></div>`:''}${post.emptySource&&!post.body.trim()?'<p class="empty-content">元サイトでも本文は空欄の投稿です。</p>':''}<div class="article-body">${post.html}</div>${post.source?`<p class="source-link"><a href="${esc(post.source)}">元の記事 ↗</a></p>`:''}<footer class="article-end"><a href="/${post.category}/">← ${categoryName(post.category)}の一覧へ</a><a href="/works/">ほかの作品も見てみる →</a></footer></article>`;
}

export function shell(template,main,posts,{title='',description='文章・仕事・絵画・音楽・映像・研究・開発の個人サイト。',path='/',origin}={}){
 const pageTitle=title?`${title} | ものづくり広場`:'ものづくり広場';
 let html=template.replace('__CMS_MAIN__',()=>main)
  .replace(/<title>[\s\S]*?<\/title>/,()=>`<title>${esc(pageTitle)}</title>`)
  .replace(/(<meta name="description" content=")[^"]*/,(_,p)=>p+esc(description))
  .replace(/(<meta property="og:description" content=")[^"]*/,(_,p)=>p+esc(description))
  .replace(/(<meta property="og:title" content=")[^"]*/,(_,p)=>p+esc(pageTitle))
  .replace(/(<link rel="canonical" href=")[^"]*/,(_,p)=>p+esc(origin+path))
  .replace(/(<meta property="og:url" content=")[^"]*/,(_,p)=>p+esc(origin+path))
  .replace(/<small data-count-for="([a-z]+)">[\s\S]*?<\/small>/g,(_,c)=>`<small>${String(posts.filter(p=>p.category===c).length).padStart(2,'0')}</small>`);
 const allTags=[...new Set(posts.flatMap(p=>p.tags))].slice(0,7);
 html=html.replace('__CMS_TAGS__',()=>allTags.map(t=>`<a href="/search/?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(''));
 return html;
}

export function publicPage(path,url,posts,t){
 let main,title='',description;const by=c=>posts.filter(p=>p.category===c);
 if(path==='/'){
  const art=by('art')[0],music=by('music');
  main=`<header class="home-heading"><h1>最近の更新<span class="cursor" aria-hidden="true">_</span></h1><a class="sample-label" href="/works/">全${posts.length}件 →</a></header><div class="updates-grid"><section class="update-column"><h2><a href="/writing/">文章</a></h2>${postList(by('writing').slice(0,5))}<a class="section-more" href="/writing/">文章の一覧 →</a></section><section class="update-column"><h2><a href="/work/">仕事</a></h2>${postList(by('work').slice(0,4))}${external(t.links.work)}<a class="section-more" href="/work/">仕事の一覧 →</a><div class="subsection"><h2><a href="/video/">映像</a></h2>${postList(by('video').slice(0,3))}<a class="section-more" href="/video/">映像の一覧 →</a></div></section><section class="update-column"><h2><a href="/development/">開発</a></h2>${postList(by('development').slice(0,3))}${external(t.links.development)}${art?`<div class="subsection"><h2><a href="/art/">絵画</a></h2>${art.cover?`<a class="painting-preview" href="${pathFor(art)}"><img src="${esc(art.cover)}" alt="${esc(art.coverAlt)}" width="1200" height="800"></a>`:''}${postList([art])}</div>`:''}${music.length?`<div class="subsection"><h2><a href="/music/">音楽</a></h2>${postList(music.slice(0,3))}<a class="section-more" href="/music/">音楽の一覧 →</a></div>`:''}<div class="subsection"><h2><a href="/creative/">創作</a></h2>${external(t.links.creative)}</div></section></div><div class="lower-grid"><section><h2>アーカイブ</h2><nav class="archive-links">${categories.map(c=>`<a href="/${c[0]}/">${c[1]}<span>${by(c[0]).length}</span></a>`).join('')}</nav><a class="section-more" href="/literature/">文学 →</a></section><section><h2>新しい投稿</h2>${postList(posts.slice(0,3))}</section></div>`;
 }else if(path==='/works/'||path==='/literature/'||categories.some(c=>path===`/${c[0]}/`)){
  const category=categories.find(c=>path===`/${c[0]}/`);
  let selected=category?by(category[0]):path==='/literature/'?posts.filter(p=>p.tags.includes('文学')):posts;
  title=category?category[1]:path==='/literature/'?'文学':'作品一覧';
  const filter=url.searchParams.get('category');if(path==='/works/'&&categories.some(c=>c[0]===filter))selected=by(filter);
  main=intro(title,category?.[2]||'WORKS')+(path==='/works/'?`<nav class="category-tabs"><a href="/works/">すべて</a>${categories.map(c=>`<a href="/works/?category=${c[0]}" ${filter===c[0]?'aria-current="page"':''}>${c[1]}</a>`).join('')}</nav>`:'')+`<p class="sample-note">${selected.length}件</p>`+cards(selected)+(category?external(t.links[category[0]]):'');
 }else if(path==='/search/'){
  title='検索';const q=(url.searchParams.get('q')||'').slice(0,200),terms=q.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  const found=posts.filter(p=>{const text=`${p.title} ${p.description} ${p.body} ${p.tags.join(' ')} ${categoryName(p.category)}`.normalize('NFKC').toLowerCase();return terms.every(term=>text.includes(term));});
  main=intro('検索','SEARCH')+`<form class="search-form" action="/search/" role="search"><label class="search-field"><span class="sr-only">検索する言葉</span><input type="search" name="q" value="${esc(q)}" placeholder="検索する言葉"></label><button class="search-submit" type="submit">検索</button></form><p class="search-count">${q?`「${esc(q)}」に見つかった作品`:'すべての作品'} ${found.length}件</p>${cards(found)}`;
 }else if(path.startsWith('/works/')){
  const post=posts.find(p=>path===pathFor(p));if(!post)return null;
  title=post.title;description=post.description;main=article(post,t.widgets);
 }else if(t.staticPages[path]){
  ({main,title}=t.staticPages[path]);
 }else return null;
 return shell(t.shell,main,posts,{title,description,path,origin:url.origin});
}

export function rss(posts,origin){return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>ものづくり広場</title><description>文章・仕事・絵画・音楽・映像・研究・開発の更新情報。</description><link>${esc(origin)}/</link><language>ja</language>${posts.map(p=>`<item><title>${esc(p.title)}</title><description>${esc(p.description)}</description><link>${esc(origin+pathFor(p))}</link><guid isPermaLink="true">${esc(origin+pathFor(p))}</guid><pubDate>${new Date(p.date).toUTCString()}</pubDate><category>${categoryName(p.category)}</category></item>`).join('')}</channel></rss>`;}
