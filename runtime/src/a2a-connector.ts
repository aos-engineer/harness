// ── A2aConnector (Phase 3 — A2A egress) ──────────────────────────
//
// A Connector (the Phase 2 narrowed member contract) backed by A2A. Registered
// into the CompositeRuntime so a remote member (an aos/agent/v1 with a
// remote_ref) is addressed exactly like a local one — DelegationRouter,
// bias/speaks-last accounting, and the engine round loop are unchanged. An ADK
// 2.0 graph exposed via to_a2a() is just one such peer.
//
//   spawnAgent  → resolve + cache the Agent Card (endpoint)
//   sendMessage → drive the A2A Task to terminal, collapse via task-mapper;
//                 cost is 0/unmetered so budget gating stays sound
//   destroyAgent→ best-effort task cancel
//   extended methods are absent → CompositeRuntime throws UnsupportedError
//   (remote hierarchy / context injection / setModel are deferred by design)

import type {
  Connector,
  AgentConfig,
  AgentHandle,
  AgentResponse,
  MessageOpts,
  AuthMode,
  ModelCost,
  ModelTier,
  RemoteAgentConfig,
} from "./types";
import { A2aClient, A2aError, type AgentCard, type A2aTask, type A2aTaskState } from "./a2a-client";
import { a2aToAgentResponse } from "./task-mapper";
import { MeshEgressPolicy } from "./egress-policy";

/** The CompositeRuntime connectorKind under which A2A peers are registered. */
export const A2A_CONNECTOR_KIND = "a2a";

export type A2aEventType =
  | "a2a_task_created"
  | "a2a_task_status"
  | "a2a_artifact_received"
  | "a2a_task_failed";

export interface A2aConnectorOptions {
  egress?: MeshEgressPolicy;
  onEvent?: (type: A2aEventType, detail: Record<string, unknown>) => void;
  /** Env source for auth_ref resolution. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Inject a client (tests). When set, the same client is used for all remotes. */
  client?: A2aClient;
}

interface RemoteHandleState {
  remote: RemoteAgentConfig;
  card?: AgentCard;
  endpoint?: string;
  contextId?: string;
  taskId?: string;
}

export class A2aConnector implements Connector {
  private readonly remotes = new Map<string, RemoteAgentConfig>();
  private readonly states = new Map<string, RemoteHandleState>();
  private readonly env: Record<string, string | undefined>;

  constructor(remotes: RemoteAgentConfig[], private readonly opts: A2aConnectorOptions = {}) {
    for (const r of remotes) this.remotes.set(r.id, r);
    this.env = opts.env ?? process.env;
  }

  /** Whether this connector serves the given remote_ref (drives resolveKind). */
  handles(remoteRef: string | undefined): boolean {
    return !!remoteRef && this.remotes.has(remoteRef);
  }

  private emit(type: A2aEventType, detail: Record<string, unknown>): void {
    this.opts.onEvent?.(type, detail);
  }

  private clientFor(remote: RemoteAgentConfig): A2aClient {
    if (this.opts.client) return this.opts.client;
    const headers: Record<string, string> = {};
    if (remote.auth_ref) {
      const token = this.env[remote.auth_ref];
      if (token) headers.authorization = `Bearer ${token}`;
    }
    return new A2aClient({ egress: this.opts.egress, headers });
  }

  async spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle> {
    const remote = config.remote_ref ? this.remotes.get(config.remote_ref) : undefined;
    if (!remote) {
      throw new A2aError(
        `A2aConnector cannot spawn "${config.id}": no remote agent for remote_ref "${config.remote_ref}"`,
      );
    }
    const handleId = `a2a-${config.id}-${sessionId}`;
    const card = await this.clientFor(remote).fetchAgentCard(remote.agent_card_url);
    this.states.set(handleId, { remote, card, endpoint: card.url });
    this.emit("a2a_task_created", { handle: config.id, remote: remote.id, endpoint: card.url });
    return { id: handleId, agentId: config.id, sessionId };
  }

  async sendMessage(handle: AgentHandle, message: string, _opts?: MessageOpts): Promise<AgentResponse> {
    const state = this.states.get(handle.id);
    if (!state || !state.endpoint) {
      throw new A2aError(`A2aConnector: no resolved endpoint for handle "${handle.id}"`);
    }
    const client = this.clientFor(state.remote);
    const onStatus = (s: A2aTaskState, task: A2aTask) => {
      // Record the in-flight task id so destroyAgent/abort can cancel it even
      // if a later poll throws (orphan cleanup).
      state.taskId = task.id;
      this.emit("a2a_task_status", { handle: handle.agentId, taskId: task.id, state: s });
    };
    const result = await client.sendMessage(
      state.endpoint,
      message,
      { contextId: state.contextId, taskId: state.taskId },
      onStatus,
    );

    const mapped = a2aToAgentResponse(result, `a2a:${state.remote.id}`);
    if (mapped.a2aContextId) state.contextId = mapped.a2aContextId;
    // Keep the taskId only while paused (continue same task); clear on a true
    // terminal so destroyAgent won't try to cancel an already-finished task.
    state.taskId = mapped.a2aPaused ? mapped.a2aTaskId : undefined;

    if ((result as A2aTask).artifacts?.length) {
      this.emit("a2a_artifact_received", {
        handle: handle.agentId,
        count: (result as A2aTask).artifacts!.length,
      });
    }
    if (mapped.status === "failed") {
      this.emit("a2a_task_failed", { handle: handle.agentId, error: mapped.error });
    }
    return mapped;
  }

  async destroyAgent(handle: AgentHandle): Promise<void> {
    const state = this.states.get(handle.id);
    if (state?.endpoint && state.taskId) {
      await this.clientFor(state.remote).cancelTask(state.endpoint, state.taskId);
    }
    this.states.delete(handle.id);
  }

  /**
   * Cancel any in-flight remote tasks and drop all state. Called at session
   * teardown (and on engine abort via CompositeRuntime). Best-effort / non-fatal.
   */
  async abort(): Promise<void> {
    await Promise.all(
      [...this.states.values()].map((st) =>
        st.endpoint && st.taskId
          ? this.clientFor(st.remote).cancelTask(st.endpoint, st.taskId).catch(() => {})
          : Promise.resolve(),
      ),
    );
    this.states.clear();
  }

  getAuthMode(): AuthMode {
    // Never consulted by the engine (CompositeRuntime uses the local connector's
    // auth mode globally); present to satisfy the contract. Remote spend is
    // unmetered, so it is excluded from local budget gating.
    return { type: "unknown", metered: false };
  }

  getModelCost(_tier: ModelTier): ModelCost {
    return { inputPerMillionTokens: 0, outputPerMillionTokens: 0, currency: "USD" };
  }
}
