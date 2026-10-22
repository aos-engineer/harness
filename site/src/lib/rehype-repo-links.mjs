// The 1.0 docs link to each other as sibling .md files and to source files as ../../<path>, which is right
// on GitHub. On the site, a sibling page lives at /docs/<name>/ and source files are not published, so
// those links are rewritten: pages to site routes, everything else to the file on GitHub.
const REPO = 'https://github.com/aos-engineer/harness';
const SIBLING = /^([a-z0-9-]+)\.md(#.*)?$/;
const REPO_PATH = /^\.\.\/\.\.\/(.+)$/;

export function rewriteHref(href) {
  const page = SIBLING.exec(href);
  if (page) return `/docs/${page[1]}/${page[2] ?? ''}`;
  const repo = REPO_PATH.exec(href);
  if (repo) return `${REPO}/${repo[1].endsWith('/') ? 'tree' : 'blob'}/main/${repo[1]}`;
  return href;
}

export default function rehypeRepoLinks() {
  const visit = (node) => {
    if (node.type === 'element' && node.tagName === 'a' && typeof node.properties?.href === 'string') {
      node.properties.href = rewriteHref(node.properties.href);
    }
    for (const child of node.children ?? []) visit(child);
  };
  return (tree) => visit(tree);
}
