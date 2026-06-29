import type { BriefKind, BriefSchemaDef } from "./types";

export const DELIBERATION_SCHEMA: BriefSchemaDef = {
  requiredSections: ["Situation", "Stakes", "Constraints", "Key Question"],
  optionalSections: ["Background", "Out of scope"],
  aliases: {},
};

export const EXECUTION_SCHEMA: BriefSchemaDef = {
  requiredSections: ["Feature / Vision", "Context", "Constraints", "Success Criteria"],
  optionalSections: ["Stakeholders", "Out of scope", "Open Questions"],
  aliases: {
    "Feature / Vision": ["Vision"],
  },
};

export function briefSchema(kind: BriefKind): BriefSchemaDef {
  return kind === "deliberation" ? DELIBERATION_SCHEMA : EXECUTION_SCHEMA;
}

export const DISCRIMINATING_HEADINGS: Record<BriefKind, string> = {
  deliberation: "Key Question",
  execution: "Success Criteria",
};
