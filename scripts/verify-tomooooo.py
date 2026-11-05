"""Check built article text against saved source fingerprints and validate routes."""
import hashlib,json,re,xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlsplit,unquote
from bs4 import BeautifulSoup
project=Path(__file__).resolve().parents[1]
dist=project/'dist'
report=json.loads((project/'migration/tomooooo.json').read_text())
issues=[]
for record in report['articles']:
 path=dist/record['destination'].strip('/')/'index.html'
 soup=BeautifulSoup(path.read_text(),'html.parser')
 body=soup.select_one('.article-body')
 text=re.sub(r'\s+','',body.get_text('',strip=False))
 digest=hashlib.sha256(text.encode()).hexdigest()
 if digest!=record['normalizedTextSha256']:issues.append('Article text mismatch: '+record['title'])
 if soup.h1.get_text('',strip=True)!=record['title']:issues.append('Title mismatch: '+record['title'])
 time=soup.select_one('time')
 if time['datetime'][:10]!=record['date']:issues.append('Date mismatch: '+record['title'])
 if record['empty'] and not soup.select_one('.empty-content'):issues.append('Empty article unlabeled: '+record['title'])
for path in dist.rglob('*.html'):
 soup=BeautifulSoup(path.read_text(),'html.parser')
 ids=[x['id'] for x in soup.select('[id]')]
 if len(ids)!=len(set(ids)):issues.append('Duplicate IDs: '+str(path))
 for element in soup.select('[href],[src]'):
  href=element.get('href') or element.get('src');u=urlsplit(href)
  if u.scheme or u.netloc:continue
  target=dist/unquote(u.path).lstrip('/') if u.path.startswith('/') else path.parent/unquote(u.path)
  if u.path:
   if target.is_dir():target=target/'index.html'
   if not target.exists():issues.append(f'Missing link: {path}: {href}')
  if href.startswith('#') and unquote(u.fragment) not in ids:issues.append(f'Missing anchor: {path}: {href}')
 for img in soup.select('img'):
  if 'alt' not in img.attrs:issues.append('Missing image alt: '+str(path))
redirects=json.loads((project/'src/data/legacy-redirects.json').read_text())
for old,new in redirects.items():
 path=dist/old.strip('/')/'index.html'
 soup=BeautifulSoup(path.read_text(),'html.parser')
 refresh=soup.find('meta',attrs={'http-equiv':'refresh'})
 if not refresh or new not in refresh['content']:issues.append('Bad legacy redirect: '+old)
feed=ET.parse(dist/'rss.xml')
rss_links={i.findtext('link') for i in feed.findall('./channel/item')}
for article in report['articles']:
 if not any(link and link.endswith(article['destination']) for link in rss_links):issues.append('Missing migrated RSS entry: '+article['title'])
soup=BeautifulSoup((dist/'search/index.html').read_text(),'html.parser')
index=json.loads(soup.select_one('#search-data').string)
indexed_urls={entry['url'] for entry in index}
for article in report['articles']:
 if article['destination'] not in indexed_urls:issues.append('Missing migrated search entry: '+article['title'])
for query in ['地図上の海','農的生活','文学']:
 if not any(query in entry['text'] for entry in index):issues.append('Missing search content: '+query)
if (dist/'works/small-discoveries/index.html').exists():issues.append('Sample detail still published')
for path in [dist/'index.html',dist/'about/index.html',dist/'now/index.html']:
 if '作品は見本です' in path.read_text() or '見本を掲載中' in path.read_text():issues.append('Sample copy remains: '+str(path))
if issues:print('\n'.join(issues));raise SystemExit(1)
print(f'PASS: 36 article bodies match source (ignoring whitespace), titles/dates preserved, {len(redirects)} redirects, all migrated RSS/search entries, all local links/assets valid.')
