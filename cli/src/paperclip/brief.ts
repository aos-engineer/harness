// Builds the AOS brief for a worker pass.
//
// The brief is assembled from the Paperclip issue (title + definition of done)
// and must contain every heading the profile requires (## Task, ## Definition of
// Done, ## Constraints) or validateBrief rejects it.

import type { Issue } from "./types";

export interface BriefInput {
  issue: Issue;
  date: string; // YYYY-MM-DD
}

export function buildBrief(input: BriefInput): string {
  const { issue, date } = input;
  const title = issue.title ?? issue.id;
  const dod = (issue.definitionOfDone ?? issue.body ?? "").trim();

  return `# Work Item — ${date}

## Task
${title}

## Definition of Done
${dod || "(No explicit definition of done was provided on the issue; satisfy the task title above.)"}

## Constraints
- Produce a clear, review-ready work product. Leave the result for a human to
  review: do not mark the issue done and do not publish.
- Voice: plain, precise, and honest about uncertainty. State assumptions
  explicitly; do not fill gaps from memory.
`;
}
