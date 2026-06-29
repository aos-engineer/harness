import type { BriefKind, BriefSections } from "./types";
import { briefSchema } from "./schema";

const SECTION_KEY_MAP: Record<BriefKind, Record<string, keyof BriefSections>> = {
  deliberation: {
    "Situation": "situation",
    "Stakes": "stakes",
    "Constraints": "constraints",
    "Background": "background",
    "Out of scope": "outOfScope",
    "Key Question": "keyQuestion",
  },
  execution: {
    "Feature / Vision": "featureVision",
    "Context": "context",
    "Constraints": "constraints",
    "Stakeholders": "stakeholders",
    "Out of scope": "outOfScope",
    "Open Questions": "openQuestions",
    "Success Criteria": "successCriteria",
  },
};

const PLACEHOLDER_TEXT: Record<string, string> = {
  "Situation": "Describe what is happening, who is involved, what triggered the decision.",
  "Stakes": "Spell out upside and downside for each path.",
  "Constraints": "List budget, timeline, technical, and regulatory constraints.",
  "Key Question": "State the single decision question for the council.",
  "Background": "Extended context (optional).",
  "Out of scope": "Things explicitly not on the table (optional).",
  "Feature / Vision": "What you're building and why.",
  "Context": "Environment, prior art, repo state.",
  "Success Criteria": "How will you know this is done?",
  "Stakeholders": "Who consumes this output (optional).",
  "Open Questions": "Known unknowns (optional).",
};

export interface RenderOpts {
  kind: BriefKind;
  title?: string;
  prefilled?: BriefSections;
  seedText?: string;
}

export function renderBriefTemplate(opts: RenderOpts): string {
  const lines: string[] = [`# Brief: ${opts.title ?? "TODO"}`, ""];

  if (opts.seedText) {
    lines.push("<!-- raw idea seed:");
    lines.push(...opts.seedText.split("\n"));
    lines.push("-->", "");
  }

  const schema = briefSchema(opts.kind);
  const ordered = [...schema.requiredSections];
  for (const optional of schema.optionalSections) {
    if (!ordered.includes(optional)) ordered.push(optional);
  }

  const keyMap = SECTION_KEY_MAP[opts.kind];
  for (const heading of ordered) {
    lines.push(`## ${heading}`, "");
    const key = keyMap[heading];
    const filled = key ? opts.prefilled?.[key] : undefined;
    if (filled && filled.trim()) {
      lines.push(filled.trim());
    } else {
      lines.push(`<!-- TODO: ${PLACEHOLDER_TEXT[heading] ?? `Describe ${heading.toLowerCase()}.`} -->`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
