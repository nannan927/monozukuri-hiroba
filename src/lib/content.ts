import { getCollection } from 'astro:content';

export const categories = [
  { id: 'writing', name: '文章', english: 'WORDS', description: '日々のこと、心に留まったこと。', icon: 'pen', color: 'pink' },
  { id: 'diary', name: '日記', english: 'DIARY', description: '日記。', icon: 'calendar', color: 'blue' },
  { id: 'art', name: '絵画', english: 'ART', description: '言葉にならないものを、色と線に。', icon: 'palette', color: 'yellow' },
  { id: 'music', name: '音楽', english: 'MUSIC', description: '暮らしのすきまに、小さな音を。', icon: 'music', color: 'green' },
  { id: 'study', name: '学問', english: 'STUDY', description: '「なぜ？」からはじまる探検。', icon: 'book', color: 'blue' },
  { id: 'development', name: '開発', english: 'DEVELOPMENT', description: '開発・制作物。', icon: 'code', color: 'green' },
] as const;

export const categoryFor = (id: string) => categories.find((category) => category.id === id)!;
export const getWorks = async () => (await getCollection('works', ({ data }) => !data.draft))
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || (a.data.sourceOrder ?? 999999) - (b.data.sourceOrder ?? 999999) || a.id.localeCompare(b.id));
export const formatDate = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '.');
