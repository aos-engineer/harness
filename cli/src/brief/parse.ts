export interface ParsedSection {
  heading: string;
  level: 1 | 2 | 3;
  body: string;
  startLine: number;
}

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;
const TITLE_RE = /^#\s+Brief:\s+(.+?)\s*$/;

export function parseTitle(markdown: string): string | null {
  for (const line of markdown.split("\n")) {
    const match = line.match(TITLE_RE);
    if (match) return match[1];
  }
  return null;
}

export function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(HEADING_RE);
    if (match) {
      const level = match[1].length as 1 | 2 | 3;
      if (level === 1) {
        if (current) {
          sections.push(current);
          current = null;
        }
        continue;
      }
      if (current) sections.push(current);
      current = { heading: match[2], level, body: "", startLine: i };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }

  if (current) sections.push(current);
  return sections;
}

export function isBodyEmpty(body: string): boolean {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim().length === 0;
}

export function findSection(
  sections: ParsedSection[],
  canonical: string,
  aliases: string[] = [],
): ParsedSection | null {
  const candidates = [canonical, ...aliases].map((candidate) => candidate.toLowerCase());
  return sections.find((section) => candidates.includes(section.heading.toLowerCase())) ?? null;
}
