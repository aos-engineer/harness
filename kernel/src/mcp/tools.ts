// The MCP tool catalog. Descriptions are written for the agent, which acts on them. No tool approves,
// waives, lowers a tier, extends a budget, pauses, or cancels: those need a human at a real terminal.
// No schema has a provenance field and command is not an evidence kind, so nothing sent over MCP can
// become observed evidence.

export const TOOL_NAMES: readonly string[] = [
  "aos_run_start",
  "aos_status",
  "aos_gate_check",
  "aos_stage_advance",
  "aos_task_add",
  "aos_task_complete",
  "aos_evidence_record",
  "aos_request_approval",
];

type Schema = Record<string, unknown>;

const closed = (properties: Record<string, Schema>, required: string[]): Schema => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string): Schema => ({ type: "string", description });

const runId = str("The run id returned by aos_run_start.");
const onlyRun = closed({ runId }, ["runId"]);

const EVIDENCE_KINDS = ["artifact", "citation", "review", "skill"];
const evidenceFields = {
  path: str("artifact and citation: a file path inside the repository, outside .aos/."),
  line: { type: "integer", minimum: 1, description: "citation: the 1-based line number." },
  note: str("citation: optional. What the cited line shows."),
  status: { type: "string", enum: ["approved", "rejected", "needs-revision"], description: "review: the reviewer's verdict, reported honestly." },
  feedback: str("review: the reviewer's feedback, verbatim or faithfully summarized. Required, even for an approval."),
  reviewer: str("review: who reviewed the change, such as the reviewing subagent's name."),
  skill: str("skill: the skill's name, such as superpowers:brainstorming."),
};

export const TOOLS: ReadonlyArray<{ name: string; description: string; inputSchema: object }> = [
  {
    name: "aos_run_start",
    description: "Start an AOS run for one piece of work. Returns the run id, the proposed risk tier and why, the stages, and the first stage's instructions. Tell the human the tier and reason before you start.",
    inputSchema: closed({
      brief: str("The user's request for this piece of work, in their words. 1 to 8000 characters."),
      tier: { type: "string", enum: ["spike", "bounded", "architectural"], description: "Optional. Ask for a higher tier than AOS proposes. A request can raise the tier, never lower it." },
    }, ["brief"]),
  },
  {
    name: "aos_status",
    description: "Show a run's stage, gate state, open gaps, and iteration budget. Read-only.",
    inputSchema: onlyRun,
  },
  {
    name: "aos_gate_check",
    description: "Evaluate the current stage's gate now and list what is missing or stale.",
    inputSchema: onlyRun,
  },
  {
    name: "aos_stage_advance",
    description: "Pass the current gate and enter the next stage. Fails with the open gaps if the gate is not satisfied.",
    inputSchema: onlyRun,
  },
  {
    name: "aos_task_add",
    description: "Add a task to the current stage. All tasks must be completed before the stage's gate passes.",
    inputSchema: closed({ runId, title: str("What the task delivers, in one line.") }, ["runId", "title"]),
  },
  {
    name: "aos_task_complete",
    description: "Mark a task in the current stage completed.",
    inputSchema: closed({
      runId,
      task: str("The task id returned by aos_task_add, such as t1."),
      evidence: { type: "array", items: { type: "string" }, description: "Optional. Evidence ids from aos_evidence_record that back the task." },
    }, ["runId", "task"]),
  },
  {
    name: "aos_evidence_record",
    description: "Record claimed evidence: an artifact path, a file:line citation, a review result, or a skill you used. Test runs are observed automatically; you cannot record them here.",
    // Flat on purpose: some model APIs reject a top-level oneOf in a tool schema. The per-kind shapes are
    // enforced by EVIDENCE_ARGUMENTS below, which the server validates against before anything runs.
    inputSchema: closed({
      runId,
      kind: { type: "string", enum: EVIDENCE_KINDS, description: "artifact: a file you produced (path). citation: a file and line that supports a claim (path, line, note). review: a code review's result (status, feedback, reviewer). skill: a skill you used (skill)." },
      ...evidenceFields,
    }, ["runId", "kind"]),
  },
  {
    name: "aos_request_approval",
    description: "Ask the human to approve the current stage. Present your design or question first. The human approves from their own terminal; never run aos approve yourself.",
    inputSchema: closed({
      runId,
      summary: str("What the human is approving: the design, or the spike's question and probe. 1 to 4000 characters."),
    }, ["runId", "summary"]),
  },
];

// Each evidence kind admits exactly its own fields. The discriminator makes the validator report errors
// for the kind the caller chose, instead of one list per kind.
type Field = keyof typeof evidenceFields;
const kindOf = (kind: string, fields: Field[], optional: Field[] = []): Schema =>
  closed(
    { runId, kind: { const: kind }, ...Object.fromEntries([...fields, ...optional].map((f) => [f, evidenceFields[f]])) },
    ["runId", "kind", ...fields],
  );

const EVIDENCE_ARGUMENTS: Schema = {
  type: "object",
  required: ["kind"],
  discriminator: { propertyName: "kind" },
  oneOf: [
    kindOf("artifact", ["path"]),
    kindOf("citation", ["path", "line"], ["note"]),
    kindOf("review", ["status", "feedback", "reviewer"]),
    kindOf("skill", ["skill"]),
  ],
};

/** The schema each tool's arguments are validated against: the advertised one, or a stricter one. */
export const ARGUMENT_SCHEMAS: Readonly<Record<string, object>> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t.name === "aos_evidence_record" ? EVIDENCE_ARGUMENTS : t.inputSchema]),
);
