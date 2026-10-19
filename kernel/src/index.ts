// Public surface of @aos-harness/kernel. The MCP server lives behind the "./mcp" subpath so
// hosts that load the kernel in-process do not pull in the MCP SDK.

// Contract and utilities
export * from "./types.ts";
export * from "./util/ulid.ts";
export * from "./util/hash.ts";
export * from "./util/errors.ts";

// Storage: run log, lock, state snapshot, artifacts, session bindings
export * from "./store/paths.ts";
export * from "./store/lock.ts";
export * from "./store/log.ts";
export * from "./store/store.ts";
export * from "./store/artifacts.ts";
export * from "./store/sessions.ts";

// Projection and gate evaluation
export * from "./projection.ts";
export * from "./gates/evaluate.ts";
export * from "./gates/format.ts";

// Packs and tier classification
export * from "./pack/load.ts";
export * from "./pack/classify.ts";
export * from "./pack/integrity.ts";

// Shell command semantics, redaction, and tree fingerprints
export * from "./shell/split.ts";
export * from "./shell/match.ts";
export * from "./shell/redact.ts";
export * from "./tree/fingerprint.ts";

// Operations for agents (MCP) and humans (CLI)
export * from "./ops/context.ts";
export * from "./ops/agent.ts";
export * from "./ops/human.ts";

// Host-agnostic hook handling
export * from "./hooks/handle.ts";
export * from "./hooks/failsafe.ts";
