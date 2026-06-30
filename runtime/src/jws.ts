// ── JWS + JCS primitives (Phase 4 — signed Agent Cards) ──────────
//
// Just enough JSON Web Signature (RFC 7515) + JSON Canonicalization Scheme
// (RFC 8785) to sign and verify Agent Cards, built on node:crypto (no new dep).
// Detached payload: the JWS payload is the JCS canonicalization of the card
// (sans `signatures`); only the protected header + signature are stored.
//
// Algorithms are allowlisted to ES256 (ECDSA P-256) and EdDSA (Ed25519). The
// "none" alg and anything else are rejected — closing the classic JWS
// algorithm-confusion / unsigned-token attacks.

import {
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  createHash,
  type KeyObject,
} from "node:crypto";

export type JwsAlg = "ES256" | "EdDSA";
const ALLOWED_ALGS: JwsAlg[] = ["ES256", "EdDSA"];

export interface JwsDetachedSignature {
  protected: string;
  signature: string;
  header?: Record<string, unknown>;
}

export function b64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}
export function b64urlDecodeToString(s: string): string {
  return Buffer.from(s, "base64url").toString("utf-8");
}

/**
 * JCS canonicalization (RFC 8785), sufficient for Agent Cards: recursively sort
 * object keys by UTF-16 code unit (JS default string sort), drop undefined,
 * minimal separators. Strings/booleans/null serialize via JSON.stringify (which
 * matches JCS for typical card content). NOTE: JCS mandates a specific number
 * format; Agent Cards carry no numeric values in the signed content, so this is
 * exact for cards — but it is NOT a general-purpose JCS for arbitrary numbers.
 */
export function jcsCanonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => jcsCanonicalize(v === undefined ? null : v)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + jcsCanonicalize(obj[k])).join(",") +
    "}"
  );
}

/**
 * Recursively drop empty strings, empty arrays, empty objects, and null —
 * mirroring a2a-python's `_clean_empty`, which runs BEFORE canonicalization.
 * Booleans and numbers (incl. false/0) are preserved. Without this, an
 * AOS-signed card with an empty field (e.g. default skills:[]) would not verify
 * against a spec-compliant a2a-sdk / ADK client.
 */
export function cleanEmpty(value: unknown): unknown {
  if (value === "" || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const arr = value.map(cleanEmpty).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object)) {
      const cleaned = cleanEmpty((value as any)[k]);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value; // number / boolean
}

// String escaping matching Python json.dumps(ensure_ascii=True): escape ", \,
// control chars, and every non-ASCII code point (surrogate pairs for astral).
function asciiJsonString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp > 0x7f) {
      if (cp > 0xffff) {
        const hi = 0xd800 + ((cp - 0x10000) >> 10);
        const lo = 0xdc00 + ((cp - 0x10000) & 0x3ff);
        out += "\\u" + hi.toString(16).padStart(4, "0") + "\\u" + lo.toString(16).padStart(4, "0");
      } else {
        out += "\\u" + cp.toString(16).padStart(4, "0");
      }
    } else out += ch;
  }
  return out + '"';
}

/** Sorted-key, compact, ensure_ascii JSON — matches a2a-python's json.dumps. */
export function canonicalJsonAscii(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return asciiJsonString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJsonAscii).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => asciiJsonString(k) + ":" + canonicalJsonAscii(obj[k])).join(",") + "}";
}

/** Canonicalize a payload for Agent Card signing (a2a-sdk compatible). */
export function canonicalizeForSigning(value: unknown): string {
  return canonicalJsonAscii(cleanEmpty(value) ?? {});
}

/** Verify a KeyObject is the right type/curve for the alg (ES256 ⇒ P-256). */
function keyMatchesAlg(alg: JwsAlg, key: KeyObject): boolean {
  if (alg === "ES256") {
    return key.asymmetricKeyType === "ec" && (key.asymmetricKeyDetails as any)?.namedCurve === "prime256v1";
  }
  return key.asymmetricKeyType === "ed25519";
}

function signingInput(protectedB64: string, payload: string): Buffer {
  return Buffer.from(`${protectedB64}.${b64urlEncode(Buffer.from(payload, "utf-8"))}`, "utf-8");
}

function rawSign(alg: JwsAlg, input: Buffer, key: KeyObject): Buffer {
  if (!keyMatchesAlg(alg, key)) {
    throw new Error(`jws: key type/curve does not match alg "${alg}" (ES256 requires EC P-256, EdDSA requires Ed25519)`);
  }
  return alg === "ES256"
    ? cryptoSign("sha256", input, { key, dsaEncoding: "ieee-p1363" })
    : cryptoSign(null, input, key); // EdDSA
}

function rawVerify(alg: JwsAlg, input: Buffer, key: KeyObject, sig: Buffer): boolean {
  if (!keyMatchesAlg(alg, key)) return false; // wrong curve/type for the alg
  try {
    return alg === "ES256"
      ? cryptoVerify("sha256", input, { key, dsaEncoding: "ieee-p1363" }, sig)
      : cryptoVerify(null, input, key, sig);
  } catch {
    return false;
  }
}

export interface JwsSignOptions {
  alg: JwsAlg;
  kid?: string;
  /** Embed the public key (JWK) in the protected header for integrity checks. */
  jwk?: unknown;
  /** JWKS URL (RFC 7515 `jku`) where the verifying key is published, so a
   *  client can discover the key by kid instead of pinning it out-of-band. */
  jku?: string;
}

/** Produce a detached JWS over the JCS payload string. */
export function jwsSignDetached(
  payload: string,
  privateKey: KeyObject,
  opts: JwsSignOptions,
): JwsDetachedSignature {
  if (!ALLOWED_ALGS.includes(opts.alg)) {
    throw new Error(`jws: unsupported alg "${opts.alg}"`);
  }
  const header: Record<string, unknown> = {
    alg: opts.alg,
    ...(opts.kid ? { kid: opts.kid } : {}),
    ...(opts.jku ? { jku: opts.jku } : {}),
    ...(opts.jwk ? { jwk: opts.jwk } : {}),
  };
  const protectedB64 = b64urlEncode(Buffer.from(JSON.stringify(header), "utf-8"));
  const signature = rawSign(opts.alg, signingInput(protectedB64, payload), privateKey);
  return { protected: protectedB64, signature: b64urlEncode(signature) };
}

/** Parse a protected header; returns null if malformed or the alg is not allowlisted. */
export function parseProtectedHeader(
  protectedB64: string,
): { alg: JwsAlg; kid?: string; jku?: string; jwk?: unknown } | null {
  let header: any;
  try {
    header = JSON.parse(b64urlDecodeToString(protectedB64));
  } catch {
    return null;
  }
  if (!header || !ALLOWED_ALGS.includes(header.alg)) return null; // rejects "none" and unknown algs
  return header;
}

/** Verify a detached JWS over the JCS payload string against a public key. */
export function jwsVerifyDetached(
  payload: string,
  sig: JwsDetachedSignature,
  publicKey: KeyObject,
): boolean {
  const header = parseProtectedHeader(sig.protected);
  if (!header) return false;
  const input = signingInput(sig.protected, payload);
  return rawVerify(header.alg, input, publicKey, Buffer.from(sig.signature, "base64url"));
}

/** Reconstruct a public KeyObject from a JWK (e.g. one embedded in a header). */
export function publicKeyFromJwk(jwk: unknown): KeyObject | null {
  try {
    return createPublicKey({ key: jwk as any, format: "jwk" });
  } catch {
    return null;
  }
}

/** Compare two public keys by their canonical JWK (for trust-anchor matching). */
export function publicKeysEqual(a: KeyObject, b: KeyObject): boolean {
  try {
    return (
      jcsCanonicalize(a.export({ format: "jwk" })) === jcsCanonicalize(b.export({ format: "jwk" }))
    );
  } catch {
    return false;
  }
}

/**
 * Parse a JWKS document (`{ keys: [JWK, …] }`) into public KeyObjects. When
 * `kid` is given, only keys whose JWK `kid` OR RFC 7638 thumbprint matches are
 * returned (a verifier picks the key the signature's `kid` points at). Invalid
 * or non-allowlisted-curve JWKs are skipped, never thrown — a hostile JWKS must
 * not crash the verifier. `maxKeys` bounds work against an oversized document.
 */
export function keysFromJwks(jwksText: string, kid?: string, maxKeys = 32): KeyObject[] {
  let doc: any;
  try {
    doc = JSON.parse(jwksText);
  } catch {
    return [];
  }
  const jwks = Array.isArray(doc?.keys) ? doc.keys : [];
  const out: KeyObject[] = [];
  for (const jwk of jwks.slice(0, maxKeys)) {
    if (kid !== undefined) {
      // Match by explicit JWK kid first, else by computed thumbprint (AOS's
      // default kid). A non-matching key is skipped.
      let matches = jwk?.kid === kid;
      if (!matches) {
        try {
          matches = jwkThumbprint(jwk) === kid;
        } catch {
          matches = false;
        }
      }
      if (!matches) continue;
    }
    const key = publicKeyFromJwk(jwk);
    if (key) out.push(key);
  }
  return out;
}

/** Build a JWKS document from public keys, tagging each with its RFC 7638
 *  thumbprint as `kid` (the default AOS signs with) so a client can match it. */
export function buildJwks(keys: KeyObject[]): { keys: Array<Record<string, unknown>> } {
  const out: Array<Record<string, unknown>> = [];
  for (const key of keys) {
    try {
      // Fail-safe: a JWKS is PUBLIC. If a caller passes a private KeyObject,
      // derive its public half before export so the private scalar `d` can never
      // reach the wire — the invariant must not depend on every caller wrapping
      // in createPublicKey(). `delete jwk.d` is belt-and-suspenders.
      // createPublicKey accepts a KeyObject at runtime (deriving the public key
      // from a private one); some @types/node versions omit that overload, so
      // widen the arg to the accepted input type to keep the build portable.
      const pub =
        key.type === "private"
          ? createPublicKey(key as unknown as Parameters<typeof createPublicKey>[0])
          : key;
      const jwk = pub.export({ format: "jwk" }) as Record<string, unknown>;
      delete jwk.d;
      out.push({ ...jwk, kid: jwkThumbprint(jwk) });
    } catch {
      /* skip un-exportable keys */
    }
  }
  return { keys: out };
}

/** RFC 7638 JWK thumbprint (base64url SHA-256 over the required members). */
export function jwkThumbprint(jwk: any): string {
  let required: Record<string, unknown>;
  if (jwk?.kty === "EC") required = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  else if (jwk?.kty === "OKP") required = { crv: jwk.crv, kty: jwk.kty, x: jwk.x };
  else if (jwk?.kty === "RSA") required = { e: jwk.e, kty: jwk.kty, n: jwk.n };
  else required = jwk;
  return b64urlEncode(createHash("sha256").update(canonicalJsonAscii(required), "utf-8").digest());
}
