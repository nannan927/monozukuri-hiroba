import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import redirects from './src/data/legacy-redirects.json' with { type: 'json' };

export default defineConfig({
  site: process.env.SITE_URL || 'https://monozukuri-hiroba-tomo.pages.dev',
  output: 'static',
  markdown: { processor: satteri({ features: { smartPunctuation: false } }) },
  trailingSlash: 'always',
  redirects,
  devToolbar: { enabled: false },
});
