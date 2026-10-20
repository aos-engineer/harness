// The kernel's shared contract: run state, events, packs, evidence, gates, and the host-agnostic hook
// interface. Every module codes against these types; changes here ripple to every host.

export type Tier = "spike" | "bounded" | "architectural";
export const TIER_RANK: Readonly<Record<Tier, number>> = { spike: 0, bounded: 1, architectural: 2 };
export type Provenance = "claimed" | "observed" | "attested";
export const PROVENANCE_RANK: Readonly<Record<Provenance, number>> = { claimed: 0, observed: 1, attested: 2 };
export type ActorKind = "agent" | "hook" | "human" | "kernel";
export interface Actor { kind: ActorKind; id: string; agent: string | null }

// ---- Pack (pack.yaml after validation and defaulting) ----
export type ActionName = "commit" | "push" | "pr_create" | "deploy";
export const ACTION_PRIORITY: readonly ActionName[] = ["deploy", "pr_create", "push", "commit"];
export type ActionPolicy =
  | { allow: "always" } | { allow: "never" }
  | { allow: "in_stages"; stages: string[] }
  | { allow: "after_gate"; gate: string };
export interface ActionDef { patterns: string[]; policy: Partial<Record<Tier, ActionPolicy>> }
export type Requirement =
  | { kind: "command"; role: string; result: "exit_zero"; provenance: Provenance; fresh: boolean }
  | { kind: "review"; status: "approved"; provenance: Provenance; fresh: boolean }
  | { kind: "artifact" | "citation" | "skill"; provenance: Provenance; fresh: boolean; match: string | null };
export interface GateDef { decider: "rule" | "human"; requires: Requirement[]; tasks: "all" | "none" }
export type ModelHint = "reasoning" | "fast" | "script";
export interface StageDef { name: string; writes: "any" | string[]; gate: GateDef; bind: string[]; model: ModelHint | null }
export interface TierDef { stages: StageDef[] }
export interface ClassifyRule { tier: Tier; any: string[] }
export interface PackDocument {
  name: string; version: string;
  roles: Record<string, string[]>;
  classify: { rules: ClassifyRule[]; default: Tier };
  tiers: Partial<Record<Tier, TierDef>>;
  actions: Record<ActionName, ActionDef>;
  budget: { iterations: number };
}
export interface ResolvedPack extends PackDocument {
  integrity: string;                      // "sha256:<hex>" over the pack directory
  instructions: Record<string, string>;   // key "<tier>/<stage>", markdown
}

// ---- Evidence ----
export type EvidenceKind = "artifact" | "command" | "review" | "citation" | "skill"; // test-report and decision evidence come in a later release
interface EvidenceBase { id: string; provenance: Provenance; fingerprint: string; changes: number; stage: string; agent: string | null }
export interface CommandEvidence extends EvidenceBase { kind: "command"; role: string; command: string; exitCode: number | null; masked: boolean; outputSha256: string; tail: string }
export interface ArtifactEvidence extends EvidenceBase { kind: "artifact"; path: string; sha256: string }
export interface ReviewEvidence extends EvidenceBase { kind: "review"; status: "approved" | "rejected" | "needs-revision"; feedback: string; reviewer: string }
export interface CitationEvidence extends EvidenceBase { kind: "citation"; path: string; line: number; note: string }
export interface SkillEvidence extends EvidenceBase { kind: "skill"; skill: string }
export type Evidence = CommandEvidence | ArtifactEvidence | ReviewEvidence | CitationEvidence | SkillEvidence;
export type StoredEvidence = Evidence & { seq: number };

// ---- Gates ----
export type GapKind = "missing" | "stale" | "failed";
export interface Gap { kind: GapKind; who: "agent" | "human"; requirement: string; text: string }
export type GateVerdict = "pending" | "pass" | "fail";
export interface GateResult { stage: string; verdict: GateVerdict; gaps: Gap[]; fingerprint: string; weakFreshness: boolean }
export interface TreeState { fingerprint: string; weak: boolean }

// ---- Run state (projection) ----
export interface TaskState { id: string; stage: string; title: string; done: boolean; evidence: string[] }
export interface ApprovalState {
  request: string; stage: string; summary: string; requestedSeq: number;
  decision: null | { granted: boolean; reason: string | null; actor: Actor; seq: number };
}
export type RunStatus = "active" | "completed" | "cancelled";
export interface RunState {
  run: string; status: RunStatus; tier: Tier; tierReason: string; brief: string;
  root: string; git: boolean; host: string; pack: ResolvedPack;
  stages: string[];                                   // stage names for the tier, in order
  current: { stage: string; index: number; enteredSeq: number };
  tasks: TaskState[]; evidence: StoredEvidence[]; approvals: ApprovalState[];
  lastGate: Record<string, GateResult>;
  budget: { iterations: { used: number; limit: number; warned: boolean; exceeded: boolean } };
  changes: number;                                    // count of worktree.changed events
  stop: { lastGapKey: string | null };
  sessions: Array<{ host: string; session: string }>;
  startedAt: string; updatedAt: string; seq: number;
}
export interface StateFile { v: 1; seq: number; head: string; state: RunState }

// ---- Events ----
export interface EventDataMap {
  "run.started": { brief: string; tier: Tier; tierReason: string; root: string; git: boolean; host: string; pack: ResolvedPack };
  "run.completed": { stage: string };
  "run.cancelled": { reason: string };
  "stage.entered": { stage: string; index: number };
  "task.added": { task: string; stage: string; title: string };
  "task.completed": { task: string; evidence: string[] };
  "evidence.recorded": Evidence;
  "gate.evaluated": GateResult;
  "approval.requested": { request: string; stage: string; summary: string };
  "approval.granted": { request: string; stage: string; reason: string | null };
  "approval.denied": { request: string; stage: string; reason: string };
  "budget.charged": { dimension: "iterations"; amount: number; gapKey: string | null };
  "budget.warning": { dimension: "iterations"; used: number; limit: number };
  "budget.exceeded": { dimension: "iterations"; used: number; limit: number };
  "action.blocked": { action: ActionName | "write" | "human-only" | "aos-dir"; tool: string; reason: string };
  "action.allowed": { action: ActionName; tool: string; gate: string | null };
  "worktree.changed": { path: string; tool: string };
  "session.bound": { host: string; session: string };
  "log.repaired": { droppedBytes: number; droppedSha256: string };
}
export type EventType = keyof EventDataMap;
interface EventEnvelopeOf<T extends EventType> {
  v: 1; seq: number; id: string; run: string; ts: string; actor: Actor; type: T; data: EventDataMap[T]; prev: string;
}
interface EventDraftOf<T extends EventType> { type: T; actor: Actor; data: EventDataMap[T] }
// Distributing over T makes each event a union member keyed by `type`, so a draft's data must match its
// type and `if (e.type === ...)` narrows `e.data`. A conditional type would break generic draft factories.
export type EventEnvelope<T extends EventType = EventType> = { [K in T]: EventEnvelopeOf<K> }[T];
export type EventDraft<T extends EventType = EventType> = { [K in T]: EventDraftOf<K> }[T];
export const GENESIS_PREV = "sha256:" + "0".repeat(64);
export interface RunLocation { root: string; run: string }
export interface Projector { apply(state: RunState | null, event: EventEnvelope): RunState }

// ---- Host-agnostic hook contract ----
export type HookEvent = "pre-tool" | "post-tool" | "post-tool-failure" | "session-start" | "stop";
export type ToolKind = "bash" | "write" | "skill" | "aos-mcp" | "other";
export interface HookTool {
  name: string; kind: ToolKind; input: Record<string, unknown>;
  command: string | null; path: string | null; skill: string | null; aosTool: string | null;
}
export interface HookInput {
  host: string; event: HookEvent; session: string; promptId: string | null; cwd: string; agent: string | null;
  tool: HookTool | null;
  result: { exitCode: number | null; output: string; raw: unknown } | null;
  source: string | null;          // session-start: startup | resume | clear | compact
  stopHookActive: boolean;
}
export type HookDecision =
  | { kind: "allow"; notice: string | null }   // notice: text for the model (post-tool, session-start) or the user (stop)
  | { kind: "deny"; reason: string }           // pre-tool only
  | { kind: "block-stop"; reason: string };    // stop only
export interface Binding { host: string; session: string; run: string; root: string; boundAt: string }
