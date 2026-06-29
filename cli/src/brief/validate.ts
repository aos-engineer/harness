import type { BriefKind, BriefIssue, BriefValidation } from "./types";
import { briefSchema, DISCRIMINATING_HEADINGS } from "./schema";
import { findSection, isBodyEmpty, parseSections, parseTitle, type ParsedSection } from "./parse";

export interface ValidateOptions {
  expectedKind?: BriefKind;
  strict?: boolean;
}

export function validateBrief(markdown: string, opts: ValidateOptions = {}): BriefValidation {
  const errors: BriefIssue[] = [];
  const warnings: BriefIssue[] = [];

  if (!parseTitle(markdown)) {
    errors.push({
      kind: "missing-title",
      message: "Title must be a H1 line starting with `Brief: ` (e.g. `# Brief: API Platform Decision`).",
    });
  }

  const sections = parseSections(markdown);
  const kind = opts.expectedKind ?? autoDetectKind(sections, errors);
  if (!kind) {
    return { ok: false, detectedKind: null, errors, warnings };
  }

  const schema = briefSchema(kind);
  for (const required of schema.requiredSections) {
    const aliases = schema.aliases[required] ?? [];
    const found = findSection(sections, required, aliases);
    if (!found) {
      errors.push({
        kind: "missing-required",
        section: required,
        message: `Missing required section: \`## ${required}\`.`,
      });
      continue;
    }

    if (isBodyEmpty(found.body)) {
      const issue: BriefIssue = {
        kind: "empty-section",
        section: required,
        message: `Section \`## ${required}\` is empty.`,
      };
      if (opts.strict) errors.push(issue);
      else warnings.push(issue);
    }
  }

  if (opts.expectedKind) {
    const missingCount = errors.filter((issue) => issue.kind === "missing-required").length;
    if (missingCount >= 2) {
      const otherKind: BriefKind = opts.expectedKind === "deliberation" ? "execution" : "deliberation";
      if (findSection(sections, DISCRIMINATING_HEADINGS[otherKind])) {
        errors.push({
          kind: "shape-mismatch-hint",
          message: `This brief looks shaped for \`${otherKind}\`. Either run a \`${otherKind}\` profile or re-author with \`aos create brief --kind ${opts.expectedKind}\`.`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    detectedKind: kind,
    errors,
    warnings,
  };
}

function autoDetectKind(sections: ParsedSection[], errors: BriefIssue[]): BriefKind | null {
  const deliberationScore = scoreKind("deliberation", sections);
  const executionScore = scoreKind("execution", sections);
  const best = Math.max(deliberationScore, executionScore);

  if (best < 2 || deliberationScore === executionScore && best < 4) {
    errors.push({
      kind: "auto-detect-failed",
      message:
        "Brief is missing too many required sections to determine kind. Specify `--kind deliberation` or `--kind execution`, or author from scratch with `aos create brief`.",
    });
    return null;
  }

  if (deliberationScore === executionScore) {
    return "execution";
  }
  return deliberationScore > executionScore ? "deliberation" : "execution";
}

function scoreKind(kind: BriefKind, sections: ParsedSection[]): number {
  const schema = briefSchema(kind);
  return schema.requiredSections.filter((required) =>
    findSection(sections, required, schema.aliases[required] ?? []),
  ).length;
}
