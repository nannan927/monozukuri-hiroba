"""Import the owner's saved Jimdo pages without rewriting article text.
Usage: python scripts/import-tomooooo.py ../migration-source-tomooooo
Requires beautifulsoup4 and markdownify (migration-only dependencies).
"""
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
from bs4 import BeautifulSoup
from markdownify import markdownify

project = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]).resolve()
pages = json.loads((source / 'pages.json').read_text())
assert len(pages) == 43 and not any('error' in page for page in pages), 'Incomplete source crawl'
slugs = {
 '書くことについて': 'writing-about-writing', '文と農': 'words-and-farming', '文とdj': 'words-and-dj',
 '雨の日': 'rainy-day', '新年度': 'new-year', '地面が割れた日': 'the-day-the-ground-split',
 '幸せである': 'being-happy', '地図上の海': 'sea-on-the-map', '休み': 'rest', '働くこと': 'working',
 '推し活文化': 'fan-culture', '海民': 'sea-people', '怪物': 'monster', '郊外の鳥たち': 'suburban-birds',
 '言葉と力': 'words-and-power', 'アクターネットワーク': 'actor-network', '権威とは': 'authority',
 '5月の雨': 'may-rain', '空': 'sky', '環境への': 'toward-environment', 'ドジ': 'clumsy',
 '初出社': 'first-day-at-work', '事始': 'beginnings', '永遠の未完成': 'forever-unfinished',
 '4月': 'april', '禅道': 'zen', '反時代的な': 'untimely', '花見': 'cherry-blossoms',
 '数と音楽について': 'numbers-and-music', '明日に向けて': 'toward-tomorrow', 'ポジとネガ': 'positive-and-negative',
 '採血': 'blood-test', '好日': 'good-day', '晴れやかに': 'brightly', '初め': 'beginning', '伏見': 'fushimi',
}
article_pages = [p for p in pages if re.search(r'/\d{4}/\d{2}/\d{2}/', p['url'])]
assert len(article_pages) == 36
redirects = {
 '/ブログ/日記/': '/diary/', '/ブログ/日記-1/': '/diary/', '/ブログ/文学/': '/literature/',
 '/創作/': '/creative/', '/開発/': '/development/', '/rss/blog': '/rss.xml',
}
for page in article_pages:
 path = unquote(urlsplit(page['url']).path)
 parts = path.strip('/').split('/')
 page['date'] = '-'.join(parts[:3])
 page['id'] = page['date'] + '-' + slugs[parts[3]]
 page['destination'] = '/works/' + page['id'] + '/'
 redirects[path] = page['destination']

out = project / 'src/content/works'
archive = project / 'archive/sample-works'
archive.mkdir(parents=True, exist_ok=True)
for file in out.glob('*.md'):
 if re.search(r'^sample: true$', file.read_text(), re.M):
  shutil.move(str(file), str(archive / file.name))

records = []
for page in article_pages:
 raw = (source / page['file']).read_text()
 soup = BeautifulSoup(raw, 'html.parser')
 title = soup.select_one('.j-blog-post--headline').get_text(' ', strip=True)
 content = soup.select_one('.j-blog-content')
 assert content is not None, page['url']
 for tag in content.select('script, style, noscript, .cc-m-hgrid-overlay, [data-display="cms-only"]'):
  tag.decompose()
 media = content.select('img, iframe, audio, video, object, embed')
 assert not media, 'Media requires separate handling: ' + page['url']
 original_text = content.get_text('', strip=False)
 normalized_text = re.sub(r'\s+', '', original_text)
 categories = [tag.get_text(' ', strip=True) for tag in soup.select('.j-blog-post--category')]
 category = 'diary' if '日記' in categories else 'writing'
 original_links = []
 for link in content.select('a[href]'):
  original = urljoin(page['url'], link['href'])
  original_links.append(original)
  path = unquote(urlsplit(original).path)
  link['href'] = redirects.get(path, original) if urlsplit(original).hostname in ['www.tomooooo.com', 'tomooooo.com'] else original
  if not link['href'].startswith(('/', 'https://', 'http://', 'mailto:', '#')):
   del link['href']
 for empty in content.select('p'):
  if not empty.get_text(strip=True) and not empty.find(['img', 'audio', 'video']): empty.decompose()
 body = markdownify(str(content), heading_style='ATX', bullets='-', newline_style='SPACES', escape_misc=True).strip()
 body = re.sub(r'\n{3,}', '\n\n', body)
 paragraphs = [p.get_text(' ', strip=True) for p in content.select('p') if p.get_text(strip=True)]
 excerpt = (paragraphs[0] if paragraphs else content.get_text(' ', strip=True))[:120]
 data = {'title': title, 'description': excerpt, 'category': category, 'date': page['date'], 'tags': categories, 'source': page['url'], 'sourceOrder': len(records), 'sourceCategory': categories[0] if categories else '', 'emptySource': not normalized_text}
 frontmatter = '\n'.join(key + ': ' + json.dumps(value, ensure_ascii=False) for key, value in data.items())
 (out / (page['id'] + '.md')).write_text('---\n' + frontmatter + '\n---\n\n' + body + '\n')
 records.append({'title': title, 'date': page['date'], 'source': page['url'], 'sourcePath': unquote(urlsplit(page['url']).path), 'destination': page['destination'], 'id': page['id'], 'category': category, 'originalCategories': categories, 'empty': not normalized_text, 'normalizedTextSha256': hashlib.sha256(normalized_text.encode()).hexdigest(), 'sourceHtmlSha256': hashlib.sha256(raw.encode()).hexdigest(), 'sourceFile': page['file'], 'links': original_links})
(project / 'src/data/legacy-redirects.json').write_text(json.dumps(redirects, ensure_ascii=False, indent=2) + '\n')
report = {'source': 'https://www.tomooooo.com/', 'importedOn': '2026-11-05', 'sourcePages': len(pages), 'articleCount': len(records), 'contentMediaCount': 0, 'articles': records, 'externalLinks': {'diary': ['https://blog.goo.ne.jp/takuzou5599'], 'creative': ['https://note.com/nannan_2', 'https://novelup.plus/user/514612793/profile'], 'development': ['https://github.com/sunadatomohiro?tab=repositories']}, 'excluded': [{'url': 'https://www.tomooooo.com/about/', 'reason': 'Unedited Jimdo boilerplate and provider advertising; not personal content.'}], 'notes': ['Article text and original dates preserved; whitespace-only paragraphs collapsed.', 'Original diary and literature categories preserved; uncategorized articles remain under writing.', 'External platform contents are represented by their original links; external articles and repositories were not copied.', 'No article images, audio, or video were present in the 36 source articles.']}
(project / 'migration/tomooooo.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'articles': len(records), 'writing': sum(r['category']=='writing' for r in records), 'diary': sum(r['category']=='diary' for r in records), 'empty': [r['title'] for r in records if r['empty']], 'redirects':len(redirects)}, ensure_ascii=False))
