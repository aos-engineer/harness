export type BriefKind = "deliberation" | "execution";

export type BriefIssueKind =
  | "missing-required"
  | "empty-section"
  | "missing-title"
  | "title-format"
  | "auto-detect-failed"
  | "shape-mismatch-hint";

export interface BriefIssue {
  kind: BriefIssueKind;
  section?: string;
  message: string;
}

export interface BriefValidation {
  ok: boolean;
  detectedKind: BriefKind | null;
  errors: BriefIssue[];
  warnings: BriefIssue[];
}

export interface BriefSchemaDef {
  requiredSections: string[];
  optionalSections: string[];
  aliases: Record<string, string[]>;
}

export interface BriefSections {
  title?: string;
  contextFiles?: string;
  situation?: string;
  stakes?: string;
  background?: string;
  outOfScope?: string;
  keyQuestion?: string;
  featureVision?: string;
  context?: string;
  stakeholders?: string;
  openQuestions?: string;
  successCriteria?: string;
  constraints?: string;
}
