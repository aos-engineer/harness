// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import rehypeRepoLinks from './src/lib/rehype-repo-links.mjs';

// AOS 1.0 took over the root of the site, and 0.11 moved whole under /0.11/. Its old URLs redirect there so
// existing links and search results keep working. /docs/getting-started/ now belongs to 1.0; its banner links
// to the 0.11 page of the same name.
const DOCS_0_11 = [
  'agent-mesh-security', 'creating-agents', 'creating-domains', 'creating-profiles', 'creating-skills',
  'creating-workflows', 'dev-execution', 'domain-enforcement', 'event-summarization',
  'hierarchical-delegation', 'mcp-toolsets', 'persistent-expertise', 'serving-over-a2a', 'session-resumption',
];
const redirects = {
  '/docs': '/docs/getting-started/',
  ...Object.fromEntries(DOCS_0_11.map((page) => [`/docs/${page}`, `/0.11/docs/${page}/`])),
  ...Object.fromEntries(['agents', 'profiles', 'domains', 'skills'].map((section) => [`/${section}`, `/0.11/${section}/`])),
  '/agents/[id]': '/0.11/agents/[id]',
  '/profiles/[id]': '/0.11/profiles/[id]',
};

export default defineConfig({
  site: 'https://harness.aos.engineer',
  output: 'static',
  compressHTML: true,
  redirects,
  integrations: [
    react(),
    mdx(),
  ],
  markdown: {
    // The site's own pre and code styles follow the light and dark theme; Shiki's inline colors would not.
    syntaxHighlight: false,
    rehypePlugins: [rehypeRepoLinks],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
