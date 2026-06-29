import type { BriefKind, BriefSections } from "./types";

export interface LineReader {
  readLine(): Promise<string>;
}

export interface PromptLoopOpts {
  reader: LineReader;
  kind?: BriefKind;
  slug?: string;
  title?: string;
  seedText?: string;
  log?: (line: string) => void;
}

export interface PromptLoopResult {
  slug: string;
  kind: BriefKind;
  title: string;
  sections: BriefSections;
}

const SECTION_PROMPTS: Record<BriefKind, Array<{ key: keyof BriefSections; label: string }>> = {
  deliberation: [
    { key: "situation", label: "What's the situation? (multi-line, end with blank line)" },
    { key: "stakes", label: "What's at stake?" },
    { key: "constraints", label: "What constraints apply?" },
    { key: "keyQuestion", label: "What is the single key question for the council?" },
  ],
  execution: [
    { key: "featureVision", label: "What feature or vision are we building?" },
    { key: "context", label: "What context (environment, prior art, repo state)?" },
    { key: "constraints", label: "What constraints apply?" },
    { key: "successCriteria", label: "What success criteria define done?" },
  ],
};

export async function runBriefPromptLoop(opts: PromptLoopOpts): Promise<PromptLoopResult> {
  const log = opts.log ?? ((line: string) => console.log(line));

  if (opts.seedText) log(`\nYour seed: ${opts.seedText}\n`);

  const slug = opts.slug ?? (await ask(opts.reader, log, "Slug for this brief (kebab-case)?"));
  let kind: BriefKind;
  if (opts.kind) {
    kind = opts.kind;
  } else {
    log("\nKind?");
    log("  1. deliberation");
    log("  2. execution");
    kind = (await ask(opts.reader, log, "Enter number:")).trim() === "2" ? "execution" : "deliberation";
  }

  const title = opts.title ?? (await ask(opts.reader, log, "One-line title?"));
  const sections: BriefSections = {};
  for (const { key, label } of SECTION_PROMPTS[kind]) {
    sections[key] = await askMultiline(opts.reader, log, label);
  }

  return { slug, kind, title, sections };
}

async function ask(reader: LineReader, log: (line: string) => void, label: string): Promise<string> {
  log(`\n${label}`);
  return (await reader.readLine()).trim();
}

async function askMultiline(reader: LineReader, log: (line: string) => void, label: string): Promise<string> {
  log(`\n${label}`);
  const lines: string[] = [];
  while (true) {
    const line = await reader.readLine();
    if (line.trim() === "") break;
    lines.push(line);
  }
  return lines.join("\n");
}
