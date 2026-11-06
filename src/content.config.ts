import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const works = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/works' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['writing', 'work', 'art', 'music', 'video', 'research', 'development']),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    audio: z.string().optional(),
    sketch: z.enum(['autumn-dusk']).optional(),
    sonicPi: z.enum(['afternoon-space']).optional(),
    duration: z.string().optional(),
    sample: z.boolean().default(false),
    draft: z.boolean().default(false),
    source: z.url().optional(),
    sourceOrder: z.number().int().optional(),
    sourceCategory: z.string().optional(),
    emptySource: z.boolean().default(false),
  }),
});
export const collections = { works };
