// ── CompositeRuntime (L1) — dispatch-by-handle ───────────────────
//
// Phase 2 keystone of the interop plan. The engine holds a SINGLE
// AgentRuntimeAdapter (engine.ts: `private adapter`) and broadcasts a round via
// a SINGLE dispatchParallel call — which itself fans out to sendMessage per
// handle. So a mixed local+remote roster cannot be served by branching
// spawnAgent in scattered places; the partition needs one clean home.
//
// CompositeRuntime IS that home. It implements the full AgentRuntimeAdapter and
// is injected exactly where today's runtime is. It keeps a registry of
// Connectors keyed by `handle.connectorKind`, assigns the kind at spawn time,
// and routes every handle-bearing call to the owning connector. With only the
// "local" connector registered (Phase 2), every handle is local and behavior is
// byte-identical — DelegationRouter, ChildAgentManager, ConstraintEngine and the
// engine round loop are untouched (they are all name-keyed and kind-agnostic).
// Phase 3 registers an A2aConnector and supplies a resolveKind that maps an
// aos/remote-agent/v1-backed config to its kind; nothing else changes.

import type {
  AgentRuntimeAdapter,
  Connector,
  AgentConfig,
  ChildAgentConfig,
  AgentHandle,
  AgentResponse,
  MessageOpts,
  AuthMode,
  ModelCost,
  ModelTier,
  ThinkingMode,
  ContextUsage,
} from "@aos-harness/runtime/types";
import { UnsupportedError } from "@aos-harness/runtime/types";

export const LOCAL_CONNECTOR_KIND = "local";

/** Decide which connector kind should own an agent, from its config. */
export type ConnectorResolver = (config: AgentConfig) => string;

export interface CompositeRuntimeOptions {
  /** Additional connectors beyond "local", keyed by connectorKind. */
  connectors?: Record<string, Connector>;
  /** Maps a spawn config to a connector kind. Default: always "local". */
  resolveKind?: ConnectorResolver;
}

export class CompositeRuntime implements AgentRuntimeAdapter {
  private readonly connectors = new Map<string, Connector>();
  private readonly resolveKind: ConnectorResolver;

  constructor(local: Connector, opts: CompositeRuntimeOptions = {}) {
    this.connectors.set(LOCAL_CONNECTOR_KIND, local);
    for (const [kind, connector] of Object.entries(opts.connectors ?? {})) {
      this.connectors.set(kind, connector);
    }
    this.resolveKind = opts.resolveKind ?? (() => LOCAL_CONNECTOR_KIND);
  }

  /** Register a connector after construction (e.g. Phase 3 A2A). */
  registerConnector(kind: string, connector: Connector): void {
    this.connectors.set(kind, connector);
  }

  hasConnector(kind: string): boolean {
    return this.connectors.has(kind);
  }

  private byKind(kind: string): Connector {
    const connector = this.connectors.get(kind);
    if (!connector) {
      throw new Error(`CompositeRuntime: no connector registered for kind "${kind}"`);
    }
    return connector;
  }

  private byHandle(handle: AgentHandle): Connector {
    return this.byKind(handle.connectorKind ?? LOCAL_CONNECTOR_KIND);
  }

  private get localConnector(): Connector {
    return this.byKind(LOCAL_CONNECTOR_KIND);
  }

  // ── Per-handle routing ─────────────────────────────────────────

  async spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle> {
    const kind = this.resolveKind(config);
    const handle = await this.byKind(kind).spawnAgent(config, sessionId);
    // Mutate in place so the connector's own reference keeps identity.
    handle.connectorKind = kind;
    return handle;
  }

  // async so a routing error surfaces as a rejection (catchable by
  // dispatchParallel's Promise.allSettled), not a synchronous throw.
  async sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse> {
    return this.byHandle(handle).sendMessage(handle, message, opts);
  }

  async destroyAgent(handle: AgentHandle): Promise<void> {
    return this.byHandle(handle).destroyAgent(handle);
  }

  async injectContext(handle: AgentHandle, files: string[]): Promise<void> {
    const connector = this.byHandle(handle);
    if (!connector.injectContext) {
      throw new UnsupportedError(
        "injectContext",
        `connector "${handle.connectorKind ?? LOCAL_CONNECTOR_KIND}" does not support context injection`,
      );
    }
    return connector.injectContext(handle, files);
  }

  getContextUsage(handle: AgentHandle): ContextUsage {
    const connector = this.byHandle(handle);
    if (!connector.getContextUsage) {
      throw new UnsupportedError(
        "getContextUsage",
        `connector "${handle.connectorKind ?? LOCAL_CONNECTOR_KIND}" does not report context usage`,
      );
    }
    return connector.getContextUsage(handle);
  }

  setModel(handle: AgentHandle, modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void {
    const connector = this.byHandle(handle);
    if (!connector.setModel) {
      throw new UnsupportedError(
        "setModel",
        `connector "${handle.connectorKind ?? LOCAL_CONNECTOR_KIND}" does not support setModel`,
      );
    }
    connector.setModel(handle, modelConfig);
  }

  // ── Hierarchy (Phase 2: local-only; remote hierarchy is deferred) ──

  async spawnSubAgent(
    parentId: string,
    config: ChildAgentConfig,
    sessionId: string,
  ): Promise<AgentHandle> {
    const connector = this.localConnector;
    if (!connector.spawnSubAgent) {
      throw new UnsupportedError("spawnSubAgent", "local connector does not support sub-agents");
    }
    const handle = await connector.spawnSubAgent(parentId, config, sessionId);
    handle.connectorKind = LOCAL_CONNECTOR_KIND;
    return handle;
  }

  async destroySubAgent(parentId: string, childId: string): Promise<void> {
    const connector = this.localConnector;
    if (!connector.destroySubAgent) {
      throw new UnsupportedError("destroySubAgent", "local connector does not support sub-agents");
    }
    return connector.destroySubAgent(parentId, childId);
  }

  // ── Session-global (delegated to the local connector) ──────────

  setOrchestratorPrompt(prompt: string): void {
    this.localConnector.setOrchestratorPrompt?.(prompt);
  }

  getAuthMode(): AuthMode {
    return this.localConnector.getAuthMode();
  }

  getModelCost(tier: ModelTier): ModelCost {
    return this.localConnector.getModelCost(tier);
  }

  abort(): void {
    for (const connector of this.connectors.values()) connector.abort?.();
  }
}
