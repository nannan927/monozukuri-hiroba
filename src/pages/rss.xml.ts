import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getWorks, categoryFor } from '../lib/content';
export async function GET(context: APIContext) {
  return rss({ title: 'ものづくり広場', description: '文章・仕事・絵画・音楽・映像・研究・開発の更新情報。', site: context.site!, customData: '<language>ja</language>', items: (await getWorks()).map(work => ({ title: `${work.data.sample ? '【見本】' : ''}${work.data.title}`, description: work.data.description, pubDate: work.data.date, link: `/works/${work.id}/`, categories: [categoryFor(work.data.category).name, ...work.data.tags] })) });
}
