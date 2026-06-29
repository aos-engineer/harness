// ── Agent Card signing / verification (Phase 4) ──────────────────
//
// Sign an Agent Card so clients can verify identity before connecting (counters
// card spoofing), and verify an inbound card. The signature is a detached JWS
// over the JCS canonicalization of the card WITHOUT its `signatures` field.
//
// Two verification modes:
//   • trusted  (trustedKeys provided): the signature MUST verify against a
//     trust-anchor key — proves identity (anti-spoofing). The card's own
//     embedded JWK is ignored for key selection.
//   • integrity (no trustedKeys): verify against the JWK embedded in the
//     protected header — tamper detection only, NOT identity.

import { createPublicKey, type KeyObject } from "node:crypto";
import {
  canonicalizeForSigning,
  jwsSignDetached,
  jwsVerifyDetached,
  parseProtectedHeader,
  publicKeyFromJwk,
  jwkThumbprint,
  type JwsAlg,
  type JwsDetachedSignature,
} from "./jws";
import type { AgentCard } from "./a2a-client";

export type AgentCardSignature = JwsDetachedSignature;

export interface SignAgentCardOptions {
  privateKey: KeyObject;
  /** Default ES256. */
  alg?: JwsAlg;
  kid?: string;
  /** Embed the public key (JWK) for integrity verification. Default true. */
  embedPublicKey?: boolean;
  /** Publish a JWKS URL (`jku`) in the header so clients can discover the key
   *  by kid (key rotation without re-pinning). */
  jku?: string;
}

export function signAgentCard(card: AgentCard, opts: SignAgentCardOptions): AgentCard {
  const alg = opts.alg ?? "ES256";
  const { signatures: _drop, ...unsigned } = card as any; // never sign over existing sigs
  const payload = canonicalizeForSigning(unsigned); // a2a-sdk compatible (clean_empty + ascii)
  const jwk =
    opts.embedPublicKey === false ? undefined : createPublicKey(opts.privateKey).export({ format: "jwk" });
  const kid = opts.kid ?? (jwk ? jwkThumbprint(jwk) : undefined); // RFC 7638 thumbprint hint
  const sig = jwsSignDetached(payload, opts.privateKey, { alg, kid, jwk, jku: opts.jku });
  return { ...unsigned, signatures: [sig] };
}

export interface VerifyAgentCardOptions {
  /** Trust anchors. When set → trusted mode; when omitted → integrity mode. */
  trustedKeys?: KeyObject[];
  /**
   * Force trusted (identity) mode even if trustedKeys is empty — so a verifier
   * that EXPECTED keys (e.g. from a jku that failed to resolve) fails closed
   * instead of silently downgrading to integrity mode (which a spoofer passes
   * by embedding their own JWK).
   */
  requireTrusted?: boolean;
}

export interface VerifyAgentCardResult {
  signed: boolean;
  valid: boolean;
  mode?: "trusted" | "integrity";
  reason?: string;
}

export function verifyAgentCard(
  card: AgentCard,
  opts: VerifyAgentCardOptions = {},
): VerifyAgentCardResult {
  // A hostile card may set `signatures` to a non-array (object/number/…) →
  // treat anything but a non-empty array as unsigned (no uncaught TypeError).
  const signatures = Array.isArray((card as any).signatures)
    ? ((card as any).signatures as AgentCardSignature[])
    : undefined;
  if (!signatures || signatures.length === 0) {
    return { signed: false, valid: false, reason: "card is unsigned" };
  }
  const { signatures: _drop, ...unsigned } = card as any;
  const payload = canonicalizeForSigning(unsigned);
  const trustMode = !!opts.requireTrusted || !!opts.trustedKeys?.length;
  const trustedKeys = opts.trustedKeys ?? [];
  const MAX_SIGS = 8; // cap crypto work against a hostile multi-signature card

  for (const sig of signatures.slice(0, MAX_SIGS)) {
    const header = parseProtectedHeader(sig.protected);
    if (!header) continue; // malformed or non-allowlisted alg (incl. "none")

    if (trustMode) {
      for (const key of trustedKeys) {
        if (jwsVerifyDetached(payload, sig, key)) {
          return { signed: true, valid: true, mode: "trusted" };
        }
      }
    } else {
      const key = header.jwk ? publicKeyFromJwk(header.jwk) : null;
      if (key && jwsVerifyDetached(payload, sig, key)) {
        return { signed: true, valid: true, mode: "integrity" };
      }
    }
  }
  return {
    signed: true,
    valid: false,
    reason: trustMode ? "no signature from a trusted key" : "signature verification failed",
  };
}
