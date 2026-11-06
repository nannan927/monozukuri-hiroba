type ExternalLink = { title: string; url: string };

export const externalLinks: Record<'creative' | 'development' | 'work', ExternalLink[]> = {
  creative: [
    { title: 'note', url: 'https://note.com/nannan_2' },
  ],
  development: [
    { title: 'GitHub', url: 'https://github.com/nannan927' },
  ],
  work: [],
};
