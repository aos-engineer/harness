// Checks the built site in dist/ so a broken link or redirect fails CI instead of the deploy: every
// internal link and redirect target resolves to a built page, and every file in the repository's docs/1.0
// is rendered with its release banner and no repository-relative link left unrewritten.
//
//   bun run scripts/check-built-site.ts   (after bun run build, from site/)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SITE = join(import.meta.dirname, "..");
const DIST = join(SITE, "dist");
const DOCS = join(SITE, "..", "docs", "1.0");

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    return name.endsWith(".html") ? [p] : [];
  });
}

function resolves(href: string): boolean {
  const path = href.split("#")[0]!.split("?")[0]!;
  if (path === "") return true;
  const target = join(DIST, path);
  return existsSync(join(target, "index.html")) || (existsSync(target) && statSync(target).isFile());
}

const problems: string[] = [];
const pages = htmlFiles(DIST);
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const where = relative(DIST, page);
  const refresh = /http-equiv="refresh" content="\d+;url=([^"]+)"/.exec(html);
  if (refresh) {
    if (!resolves(refresh[1]!)) problems.push(`${where}: redirects to ${refresh[1]}, which was not built`);
    continue;
  }
  for (const m of html.matchAll(/href="(\/[^"/][^"]*|\/)"/g)) {
    if (!resolves(m[1]!)) problems.push(`${where}: links to ${m[1]}, which was not built`);
  }
}

for (const file of readdirSync(DOCS).filter((f) => f.endsWith(".md"))) {
  const slug = file.slice(0, -3);
  const page = join(DIST, "docs", slug, "index.html");
  if (!existsSync(page)) {
    problems.push(`docs/1.0/${file} has no page at /docs/${slug}/`);
    continue;
  }
  const html = readFileSync(page, "utf8");
  if (!html.includes('data-version="1.0"')) problems.push(`/docs/${slug}/ has no 1.0 release banner`);
  for (const m of html.matchAll(/href="([^"]*)"/g)) {
    if (/^[a-z0-9-]+\.md(#|$)/.test(m[1]!) || m[1]!.startsWith("../")) problems.push(`/docs/${slug}/ keeps a repository link: ${m[1]}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`check-built-site: ${pages.length} pages; every link and redirect resolves, and every 1.0 doc is rendered`);
