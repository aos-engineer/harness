// ── MeshEgressPolicy (Phase 1 — MCP-inside / future A2A egress) ───
//
// Outbound-URL authorization for AGENT-INITIATED egress: MCP http/sse servers
// now, A2A agent-card URLs later. This is deliberately STRICTER than the
// operator-telemetry guard in cli/src/utils.ts (validatePlatformUrl), and for
// a principled reason: a telemetry endpoint is configured by the operator, who
// may legitimately POST to a private collector (e.g. 10.0.0.5). An MCP/A2A
// endpoint URL, by contrast, may arrive from less-trusted config, so by default
// we block private / loopback / link-local / ULA / internal-suffix targets
// unless they are explicitly allowlisted. This closes the SSRF gap the plan
// flagged (the telemetry guard blocks only 169.254/16 and has a global bypass).
//
// SSRF caveat: hostname-based checks cannot stop DNS rebinding. This blocks
// IP-literal targets and known-internal name suffixes and offers an allowlist
// for legitimate private endpoints; a resolving/socket-layer guard is a future
// hardening and is out of scope for Phase 1.

import { lookup } from "node:dns/promises";

export class EgressBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressBlockedError";
  }
}

export interface MeshEgressPolicyOptions {
  /** Hostnames (or `host:port`) permitted even if they parse as private. */
  allowlist?: string[];
  /** Permit ALL private/loopback targets (e.g. local development). Default false. */
  allowPrivate?: boolean;
}

const INTERNAL_SUFFIXES = [".local", ".internal", ".lan", ".home", ".corp", ".intranet"];

function ipv4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts;
}

function isLoopbackIpv4(host: string): boolean {
  return ipv4Parts(host)?.[0] === 127;
}

function isPrivateIpv4(host: string): boolean {
  const p = ipv4Parts(host);
  if (!p) return false;
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8 ("this host")
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

/**
 * Expand an IPv6 literal (bracket-stripped, lowercased; may carry an embedded
 * dotted-quad tail) into its 8 16-bit groups, or null if it doesn't parse.
 * Handles `::` compression so non-canonical forms can't slip a prefix check.
 */
function expandIpv6Groups(h: string): number[] | null {
  if (!h.includes(":")) return null;
  let str = h;
  // Fold a trailing embedded dotted-quad (e.g. ::ffff:127.0.0.1) into two hex
  // groups so it parses uniformly. The WHATWG URL parser usually pre-normalizes
  // these, but direct callers (and resolved addresses) may pass the dotted form.
  const dot = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(str);
  if (dot) {
    const v4 = ipv4Parts(dot[2]!);
    if (!v4) return null;
    str = `${dot[1]}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = str.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array(missing).fill(0), ...tail];
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("fe80")) return true; // link-local fe80::/10
  const g = expandIpv6Groups(h);
  if (!g) return false;
  // Embedded-IPv4 helper: render two 16-bit groups as a dotted quad.
  const v4 = (hi: number, lo: number) =>
    `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  // ULA / link-local by numeric prefix (catches non-compressed spellings too).
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10
  // NAT64 well-known prefix 64:ff9b::/96 (and 64:ff9b:1::/48) — embedded v4 in
  // the low 32 bits. [64:ff9b::a9fe:a9fe] == 169.254.169.254.
  if (g[0] === 0x0064 && g[1] === 0xff9b) return isPrivateIpv4(v4(g[6]!, g[7]!));
  // 6to4 2002:V4HI:V4LO::/48 — embedded v4 in groups 1-2. [2002:7f00:1::] == 127.0.0.1.
  if (g[0] === 0x2002) return isPrivateIpv4(v4(g[1]!, g[2]!));
  // IPv4-mapped (::ffff:v4), IPv4-compatible (::v4), and IPv4-translated
  // (::ffff:0:v4): high 96 bits are zero or ::ffff:, embedded v4 in low 32 bits.
  if (
    g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 &&
    (g[4] === 0 || g[4] === 0xffff) && (g[5] === 0 || g[5] === 0xffff) &&
    !(g[6] === 0 && (g[7] === 0 || g[7] === 1)) // not :: / ::1 (handled above)
  ) {
    return isPrivateIpv4(v4(g[6]!, g[7]!));
  }
  return false;
}

function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // Strip a single FQDN trailing dot so "localhost." / "foo.local." are not a
  // bypass of the exact-match and suffix checks.
  if (h.length > 1 && h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

/** True if the host is loopback, RFC1918/ULA/link-local, CGNAT, or an internal name. */
export function isPrivateHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (isPrivateIpv4(h)) return true;
  if (h.includes(":") && isPrivateIpv6(h)) return true;
  if (INTERNAL_SUFFIXES.some((s) => h.endsWith(s))) return true;
  return false;
}

export class MeshEgressPolicy {
  private readonly allowlist: Set<string>;
  private readonly allowPrivate: boolean;

  constructor(opts: MeshEgressPolicyOptions = {}) {
    this.allowlist = new Set((opts.allowlist ?? []).map((h) => h.toLowerCase()));
    this.allowPrivate = opts.allowPrivate ?? false;
  }

  allowsPrivate(): boolean {
    return this.allowPrivate;
  }

  /** Is this exact host (or host:port) on the allowlist? */
  isAllowlisted(hostOrHostPort: string): boolean {
    return this.allowlist.has(hostOrHostPort.toLowerCase());
  }

  /** Validate an outbound URL. Returns the parsed URL or throws EgressBlockedError. */
  check(raw: string): URL {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new EgressBlockedError(`egress rejected: unparseable URL "${raw}"`);
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new EgressBlockedError(
        `egress rejected: scheme "${u.protocol.replace(":", "")}" not allowed (http/https only)`,
      );
    }

    const host = normalizeHost(u.hostname);
    const hostPort = u.port ? `${host}:${u.port}` : host;
    const allowed = this.allowlist.has(host) || this.allowlist.has(hostPort);

    if (isPrivateHost(host) && !allowed && !this.allowPrivate) {
      throw new EgressBlockedError(
        `egress rejected: private/loopback/internal host "${host}" not in egress allowlist`,
      );
    }

    // Plain http only to loopback or explicitly allowlisted hosts (https preferred).
    if (u.protocol === "http:") {
      const isLoopback = host === "localhost" || host === "::1" || isLoopbackIpv4(host);
      if (!allowed && !isLoopback && !this.allowPrivate) {
        throw new EgressBlockedError(
          `egress rejected: plain http to non-loopback host "${host}" (use https or allowlist it)`,
        );
      }
    }

    return u;
  }
}

/** Convenience one-shot validation with no allowlist (strict). */
export function validateEgressUrl(raw: string, opts?: MeshEgressPolicyOptions): URL {
  return new MeshEgressPolicy(opts).check(raw);
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/**
 * fetch() that re-validates every redirect hop through the egress policy and
 * strips credentials on cross-origin hops — closing the redirect-SSRF gap that
 * fetch's default redirect:"follow" would otherwise open. Used by the A2A
 * client (McpClientV2's HTTP transport has its own equivalent inline).
 */
const SENSITIVE_HEADERS = ["authorization", "cookie", "proxy-authorization", "x-api-key"];

function stripCrossOriginCredentials(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.includes(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/**
 * Best-effort DNS-rebinding guard: resolve the hostname and reject if any
 * address is private. Skipped for IP literals (already checked by policy.check),
 * allowlisted hosts, and allowPrivate. Not fully TOCTOU-proof — the name could
 * re-resolve at connect time; a socket-layer IP pin is a future hardening.
 */
export async function assertResolvedHostSafe(url: string, policy: MeshEgressPolicy): Promise<void> {
  if (policy.allowsPrivate()) return;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const hostPort = u.port ? `${host}:${u.port}` : host;
  if (policy.isAllowlisted(host) || policy.isAllowlisted(hostPort)) return;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return; // IP literal
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return; // resolution failure → let fetch surface it naturally
  }
  for (const a of addrs) {
    if (isPrivateIpv4(a.address) || isPrivateIpv6(a.address)) {
      throw new EgressBlockedError(`egress rejected: "${host}" resolves to a private address (${a.address})`);
    }
  }
}

export async function egressFetch(
  url: string,
  init: RequestInit,
  policy: MeshEgressPolicy,
  opts: { maxRedirects?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const initialOrigin = safeOrigin(url);
  const baseHeaders = { ...((init.headers as Record<string, string>) ?? {}) };
  let current = policy.check(url).toString();

  for (let hop = 0; ; hop++) {
    const headers =
      safeOrigin(current) !== initialOrigin
        ? stripCrossOriginCredentials(baseHeaders)
        : { ...baseHeaders };
    await assertResolvedHostSafe(current, policy);
    const ctrl = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
    let res: Response;
    try {
      res = await fetch(current, { ...init, headers, redirect: "manual", signal: ctrl.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= maxRedirects) {
      throw new EgressBlockedError(`exceeded ${maxRedirects} redirects from ${url}`);
    }
    current = policy.check(new URL(location, current).toString()).toString();
  }
}

/**
 * Read a Response body to text with a hard byte cap. Rejects both an over-large
 * Content-Length and an actual over-cap stream (so a lying/absent Content-Length
 * is caught too) — prevents a hostile peer from OOM-ing the process.
 */
export async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  const declared = res.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    throw new EgressBlockedError(`response body exceeds ${maxBytes} bytes (Content-Length ${declared})`);
  }
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new EgressBlockedError(`response body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
