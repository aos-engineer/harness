// The 1.0 docs are written once, in the repository's docs/1.0, where GitHub renders them next to the code.
// The site loads the same files, so the two can never disagree.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

export const collections = {
  docs: defineCollection({ loader: glob({ pattern: '*.md', base: '../docs/1.0' }) }),
};
