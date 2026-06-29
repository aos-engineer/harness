// ── A2aClient (Phase 3 — A2A egress) ─────────────────────────────
//
// A minimal Agent2Agent (A2A) v1.0 JSON-RPC client built on fetch, behind a
// small surface so a heavier SDK (@a2a-js/sdk) could be swapped in later. We
// build our own (mirroring McpClientV2) to keep the runtime dependency-light,
// reuse MeshEgressPolicy for SSRF protection on the card URL + endpoint + every
// redirect hop, and avoid the a2a v0.x↔v1.0 SDK split. Targets v1.0 JSON-RPC.
//
// Flow: resolve the Agent Card (/.well-known/agent-card.json) → POST
// `message/send` to the card's endpoint → if a Task comes back, drive it to a
// terminal state (poll `tasks/get`), surfacing status transitions; input/auth-
// required is returned as-is so the caller can continue the same task.

import type { KeyObject } from "node:crypto";
import { MeshEgressPolicy, egressFetch, readBoundedText } from "./egress-policy";
import { verifyAgentCard, type VerifyAgentCardResult } from "./agent-card-signer";
import { parseProtectedHeader, keysFromJwks } from "./jws";

export class A2aError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "A2aError";
  }
}

export type A2aTaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "auth-required"
  | "completed"
  | "canceled"
  | "failed"
  | "rejected"
  | "unknown";

export const A2A_TERMINAL_STATES: A2aTaskState[] = ["completed", "canceled", "failed", "rejected"];
export const A2A_PAUSE_STATES: A2aTaskState[] = ["input-required", "auth-required"];

export interface A2aPart {
  kind: "text" | "file" | "data";
  text?: string;
  data?: unknown;
  file?: { name?: string; mimeType?: string; uri?: string; bytes?: string };
}

export interface A2aMessage {
  role: "user" | "agent";
  parts: A2aPart[];
  messageId?: string;
  taskId?: string;
  contextId?: string;
  kind?: "message";
  /** Optional bag; skill-routed ingress reads metadata.skillId to pick a skill. */
  metadata?: Record<string, unknown>;
}

export interface A2aArtifact {
  artifactId: string;
  name?: string;
  parts: A2aPart[];
}

export interface A2aTaskStatus {
  state: A2aTaskState;
  message?: A2aMessage;
  timestamp?: string;
}

export interface A2aTask {
  id: string;
  contextId?: string;
  status: A2aTaskStatus;
  artifacts?: A2aArtifact[];
  history?: A2aMessage[];
  kind?: "task";
}

export interface AgentCard {
  name: string;
  description?: string;
  /** The JSON-RPC endpoint the client posts to. */
  url: string;
  version?: string;
  protocolVersion?: string;
  capabilities?: { streaming?: boolean; pushNotifications?: boolean };
  // AgentSkill: id/name/description/tags are required per the A2A spec.
  skills?: Array<{ id: string; name: string; description?: string; tags?: string[] }>;
  preferredTransport?: string;
  /** JWS detached signatures over the JCS-canonicalized card (sans this field). */
  signatures?: Array<{ protected: string; signature: string; header?: Record<string, unknown> }>;
}

export interface A2aClientOptions {
  egress?: MeshEgressPolicy;
  /** Extra headers (e.g. Authorization). Stripped on cross-origin redirects. */
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Max wall-clock to drive a task to terminal before giving up. */
  maxWaitMs?: number;
  /** Hard cap on any response body (default 8 MiB) — DoS guard vs hostile peers. */
  maxResponseBytes?: number;
  /**
   * When set, fetchAgentCard verifies the card's JWS signature. With trustedKeys
   * the signature must verify against a trust anchor (anti-spoofing); without,
   * it integrity-checks the embedded JWK. `require: true` rejects unsigned cards.
   *
   * `jku` opts into JWKS key discovery: when a signature header carries a `jku`
   * URL whose host is in `allowedHosts`, the JWKS is fetched (through the same
   * SSRF egress gate) and its keys become trust anchors for that card. The host
   * allowlist is the trust boundary — without it a card could point its own
   * `jku` at an attacker-controlled JWKS (key discovery ≠ identity by itself).
   */
  verifyCard?: { trustedKeys?: KeyObject[]; require?: boolean; jku?: { allowedHosts: string[] } };
  /**
   * Observe the card verification outcome. `mode:"integrity"` means the
   * signature only proved the card was not tampered with against its OWN
   * embedded key — it does NOT authenticate identity (a spoofer can embed their
   * own key). Use this to warn/audit when identity was not established.
   */
  onCardVerified?: (result: VerifyAgentCardResult) => void;
  /** Injectable clock/sleep for deterministic tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type A2aStatusListener = (state: A2aTaskState, task: A2aTask) => void;

const WELL_KNOWN = "/.well-known/agent-card.json";

function isTask(x: unknown): x is A2aTask {
  return !!x && typeof x === "object" && "status" in (x as any) && !!(x as any).status?.state;
}

export class A2aClient {
  private readonly egress: MeshEgressPolicy;
  private readonly requestTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly maxResponseBytes: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextId = 1;

  constructor(private readonly opts: A2aClientOptions = {}) {
    if (opts.verifyCard?.require && !opts.verifyCard.trustedKeys?.length) {
      throw new A2aError(
        "verifyCard.require needs trustedKeys — integrity mode cannot prove identity / prevent spoofing",
      );
    }
    this.egress = opts.egress ?? new MeshEgressPolicy();
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    this.maxWaitMs = opts.maxWaitMs ?? 600_000;
    this.maxResponseBytes = opts.maxResponseBytes ?? 8 * 1024 * 1024;
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Resolve `cardUrl` to a full well-known URL (append if a base was given). */
  private resolveCardUrl(cardUrl: string): string {
    if (cardUrl.endsWith(WELL_KNOWN)) return cardUrl;
    return cardUrl.replace(/\/+$/, "") + WELL_KNOWN;
  }

  async fetchAgentCard(cardUrl: string): Promise<AgentCard> {
    const url = this.resolveCardUrl(cardUrl);
    const res = await egressFetch(
      url,
      { method: "GET", headers: { accept: "application/json", ...(this.opts.headers ?? {}) } },
      this.egress,
      { timeoutMs: this.requestTimeoutMs },
    );
    if (!res.ok) throw new A2aError(`Agent Card fetch failed: HTTP ${res.status} from ${url}`);
    const cardText = await readBoundedText(res, this.maxResponseBytes);
    let card: AgentCard;
    try {
      card = JSON.parse(cardText) as AgentCard;
    } catch {
      throw new A2aError(`Agent Card is not valid JSON (from ${url})`);
    }
    if (!card || typeof card.url !== "string" || !card.url) {
      throw new A2aError("Agent Card is missing the 'url' JSON-RPC endpoint");
    }
    if (this.opts.verifyCard) {
      // Optionally discover trust keys from a signature's `jku` (JWKS URL),
      // gated by an operator host allowlist and the SSRF egress policy.
      const discovered = this.opts.verifyCard.jku
        ? await this.resolveJkuKeys(card, this.opts.verifyCard.jku.allowedHosts)
        : [];
      const trustedKeys = [...(this.opts.verifyCard.trustedKeys ?? []), ...discovered];
      // When jku discovery is configured the operator expects identity via the
      // JWKS — force trusted mode so a failed/blocked resolution fails closed
      // rather than downgrading to (spoofable) integrity mode.
      const result = verifyAgentCard(card, {
        trustedKeys: trustedKeys.length ? trustedKeys : undefined,
        requireTrusted: !!this.opts.verifyCard.jku,
      });
      this.opts.onCardVerified?.(result);
      if (!result.signed) {
        if (this.opts.verifyCard.require) {
          throw new A2aError(`Agent Card from ${url} is unsigned (signature required)`);
        }
      } else if (!result.valid) {
        throw new A2aError(`Agent Card signature verification failed (${result.reason})`);
      }
    }
    // The advertised endpoint must also pass the egress gate.
    this.egress.check(card.url);
    return card;
  }

  /**
   * Resolve trust keys from the `jku` (JWKS URL) of the card's signatures. A
   * jku is only honored when its host is in `allowedHosts` (the trust gate —
   * a card must not be able to point at an attacker-chosen JWKS) and the URL
   * passes the SSRF egress policy. Keys are filtered to the signature's `kid`.
   * Best-effort: a fetch/parse failure yields no keys (verification then fails
   * closed on "no signature from a trusted key").
   */
  private async resolveJkuKeys(card: AgentCard, allowedHosts: string[]): Promise<KeyObject[]> {
    const sigs = Array.isArray(card.signatures) ? card.signatures.slice(0, 8) : [];
    const allow = new Set(allowedHosts.map((h) => h.toLowerCase()));
    const seenUrls = new Set<string>();
    const keys: KeyObject[] = [];

    for (const sig of sigs) {
      const header = parseProtectedHeader(sig.protected);
      const jku = header?.jku;
      if (!jku || typeof jku !== "string") continue;

      let host: string;
      try {
        const u = new URL(jku);
        host = u.hostname.toLowerCase();
        // Key material must not be fetched in cleartext (MITM key substitution).
        // Require https; permit http only for loopback (local dev/testing).
        const isLoopback = host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host);
        if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopback)) continue;
      } catch {
        continue;
      }
      // The operator allowlist is the trust gate; they should list https hosts
      // in production. The egress policy below is the SSRF gate.
      if (!allow.has(host)) continue;
      if (seenUrls.has(jku)) continue;
      seenUrls.add(jku);

      try {
        this.egress.check(jku); // SSRF gate (defense in depth over the allowlist)
        const res = await egressFetch(
          jku,
          { method: "GET", headers: { accept: "application/json" } },
          this.egress,
          // maxRedirects:0 — a JWKS endpoint must not redirect. Following a 3xx
          // would let an open redirect on an allowlisted host pivot key discovery
          // to an attacker-hosted JWKS (the host-allowlist trust gate is enforced
          // only on the initial URL), forging the card's identity. Fail closed.
          { timeoutMs: this.requestTimeoutMs, maxRedirects: 0 },
        );
        if (!res.ok) continue;
        const text = await readBoundedText(res, this.maxResponseBytes);
        keys.push(...keysFromJwks(text, header?.kid));
      } catch {
        /* unreachable / blocked / malformed JWKS → contributes no keys */
      }
    }
    return keys;
  }

  private async rpc(endpoint: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const res = await egressFetch(
      endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(this.opts.headers ?? {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      },
      this.egress,
      { timeoutMs: this.requestTimeoutMs },
    );
    const text = await readBoundedText(res, this.maxResponseBytes);
    if (!text.trim()) throw new A2aError(`Empty response from ${method} (HTTP ${res.status})`);
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new A2aError(`Invalid JSON from ${method} (HTTP ${res.status})`);
    }
    if (!json || typeof json !== "object") {
      throw new A2aError(`Non-object JSON-RPC response from ${method} (HTTP ${res.status})`);
    }
    if (json.error) throw new A2aError(`${method} failed: ${json.error.message ?? "unknown error"}`);
    return json.result;
  }

  /**
   * Send a text message to a peer endpoint and drive the resulting Task to a
   * terminal (or pause) state. Returns the final Task, or a bare Message if the
   * peer answered synchronously without creating a Task.
   */
  async sendMessage(
    endpoint: string,
    text: string,
    ctx: { contextId?: string; taskId?: string; metadata?: Record<string, unknown> } = {},
    onStatus?: A2aStatusListener,
  ): Promise<A2aTask | A2aMessage> {
    const message: A2aMessage = {
      role: "user",
      parts: [{ kind: "text", text }],
      messageId: crypto.randomUUID(),
      ...(ctx.contextId ? { contextId: ctx.contextId } : {}),
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      ...(ctx.metadata ? { metadata: ctx.metadata } : {}),
    };
    const result = await this.rpc(endpoint, "message/send", { message });
    if (!isTask(result)) return result as A2aMessage;
    onStatus?.(result.status.state, result);
    return this.driveToTerminal(endpoint, result, onStatus);
  }

  private async driveToTerminal(
    endpoint: string,
    task: A2aTask,
    onStatus?: A2aStatusListener,
  ): Promise<A2aTask> {
    let current = task;
    const started = this.now();
    // Stop on terminal, pause (input/auth-required), OR "unknown" — only
    // submitted/working are pollable. Without the "unknown" stop the loop would
    // poll-storm for maxWaitMs and then throw (fatal in the non-allSettled path).
    const isPollable = (s: A2aTaskState) =>
      !A2A_TERMINAL_STATES.includes(s) && !A2A_PAUSE_STATES.includes(s) && s !== "unknown";
    while (isPollable(current.status.state)) {
      if (this.now() - started > this.maxWaitMs) {
        throw new A2aError(`A2A task ${current.id} timed out in state "${current.status.state}"`);
      }
      await this.sleep(this.pollIntervalMs);
      const next = await this.rpc(endpoint, "tasks/get", { id: current.id });
      if (!isTask(next)) {
        throw new A2aError(`tasks/get for ${current.id} returned a non-Task result`);
      }
      current = next;
      onStatus?.(current.status.state, current);
    }
    return current;
  }

  /** Best-effort cancellation of a task (ignored if the peer doesn't support it). */
  async cancelTask(endpoint: string, taskId: string): Promise<void> {
    try {
      await this.rpc(endpoint, "tasks/cancel", { id: taskId });
    } catch {
      /* cancellation is best-effort */
    }
  }
}
