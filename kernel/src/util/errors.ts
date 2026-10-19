// Typed errors let hooks, MCP tools, and the CLI react to a failure class without parsing messages.
// Every constructor accepts ErrorOptions so a wrapped git, fs, or JSON failure keeps its cause.

export class NotImplementedError extends Error {
  constructor(owner: string) {
    super(`not implemented yet (${owner})`);
    this.name = "NotImplementedError";
  }
}

export class RunNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RunNotFoundError";
  }
}

export class LockTimeoutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LockTimeoutError";
  }
}

export class PackError extends Error {
  issues: string[];
  constructor(message: string, issues: string[], options?: ErrorOptions) {
    super(message, options);
    this.name = "PackError";
    this.issues = issues;
  }
}

export class OpError extends Error {
  code: "not_found" | "invalid" | "refused";
  constructor(code: "not_found" | "invalid" | "refused", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OpError";
    this.code = code;
  }
}

export class PayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PayloadError";
  }
}

export class TreeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TreeError";
  }
}

export class ChainError extends Error {
  badSeq: number | null;
  constructor(message: string, badSeq: number | null, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChainError";
    this.badSeq = badSeq;
  }
}

/** Placeholder body for a module whose implementation has not landed yet. */
export function notImplemented(owner: string): never {
  throw new NotImplementedError(owner);
}
