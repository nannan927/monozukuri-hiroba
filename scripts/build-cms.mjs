import {readFileSync,writeFileSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {load} from 'cheerio';
import matter from 'gray-matter';
import {build} from 'esbuild';

mkdirSync('cms/generated',{recursive:true});
const read=path=>readFileSync(path,'utf8');
const homepage=load(read('dist/index.html'));
homepage('#main').text('__CMS_MAIN__');
homepage('.main-nav [aria-current]').removeAttr('aria-current');
homepage('.main-nav .active').removeClass('active');
homepage('.directory-list a').each((_,el)=>{const a=homepage(el),id=a.attr('href').split('/')[1];a.find('small').attr('data-count-for',id);});
homepage('.tag-cloud').text('__CMS_TAGS__');
const art=load(read('dist/works/autumn-dusk/index.html')),music=load(read('dist/works/afternoon-space/index.html'));
const included=new Set(homepage('link[href],script[src]').map((_,e)=>homepage(e).attr('href')||homepage(e).attr('src')).get());
for(const page of [art,music]){
 page('link[rel="stylesheet"],script[src]').each((_,el)=>{const url=page(el).attr('href')||page(el).attr('src');if(!included.has(url)){homepage('head').append(page.html(el));included.add(url);}});
}
const staticPages={};for(const path of ['about','now','creative']){const $=load(read(`dist/${path}/index.html`));staticPages[`/${path}/`]={title:$('h1').first().text(),main:$('#main').html()};}
// Data imports are bundled only into the server worker, never into public JSON.
await build({entryPoints:['src/data/external-links.ts'],outfile:'cms/generated/links.mjs',bundle:true,format:'esm',platform:'node'});
const {externalLinks}=await import('./../cms/generated/links.mjs');
const templates={shell:homepage.html(),widgets:{art:art('.artwork-viewer').toString(),music:music('.sonic-work').toString()},staticPages,links:externalLinks};
writeFileSync('cms/generated/templates.json',JSON.stringify(templates));

const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const seed=[];
for(const name of readdirSync('src/content/works').filter(n=>n.endsWith('.md'))){
 const {data,content}=matter(read(`src/content/works/${name}`));const slug=name.slice(0,-3);
 const built=load(read(`dist/works/${slug}/index.html`));
 const document={...data,slug,date:new Date(data.date).toISOString().slice(0,10),tags:data.tags||[],body:content,html:built('.article-body').html()||'',status:data.draft?'draft':'published'};
 const stamp=new Date().toISOString();
 seed.push(`INSERT OR IGNORE INTO posts(slug,title,category,date,status,document,version,updated_at) VALUES(${[slug,document.title,document.category,document.date,document.status,JSON.stringify(document)].map(quote).join(',')},1,${quote(stamp)});`);
}
writeFileSync('cms/generated/seed.sql',seed.join('\n')+'\n');
await build({entryPoints:['cms/worker.mjs'],outfile:'dist/_worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],minify:true});
// Database-backed pages must never fall back to an old, now private static post.
function clean(directory){for(const item of readdirSync(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory()){clean(path);}else if(item.name.endsWith('.html')&&path!=='dist/admin/index.html')rmSync(path);}}
clean('dist');rmSync('dist/rss.xml',{force:true});
writeFileSync('dist/index.html','<!doctype html><html lang="ja"><meta charset="utf-8"><title>ものづくり広場</title><p>ただいま準備中です。</p></html>');
writeFileSync('dist/404.html','<!doctype html><html lang="ja"><meta charset="utf-8"><title>ページが見つかりません</title><p>ページが見つかりません。</p></html>');
writeFileSync('dist/_routes.json',JSON.stringify({version:1,include:['/*'],exclude:['/_astro/*','/images/*','/audio/*','/artworks/*','/music/afternoon-space/*','/favicon.svg']}));
console.log(`CMS worker built. ${seed.length} seed posts prepared; remote data is not modified by builds.`);
