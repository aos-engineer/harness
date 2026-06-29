import { test, expect, describe } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  jcsCanonicalize,
  jwsSignDetached,
  jwsVerifyDetached,
  parseProtectedHeader,
  publicKeyFromJwk,
  b64urlEncode,
  cleanEmpty,
  canonicalizeForSigning,
  buildJwks,
  keysFromJwks,
  jwkThumbprint,
} from "../src/jws";

function es256() {
  return generateKeyPairSync("ec", { namedCurve: "P-256" });
}
function ed() {
  return generateKeyPairSync("ed25519");
}

describe("JCS canonicalize", () => {
  test("sorts object keys, stable regardless of insertion order", () => {
    expect(jcsCanonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(jcsCanonicalize({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });
  test("recurses into nested objects/arrays and drops undefined", () => {
    expect(jcsCanonicalize({ z: [{ y: 1, x: 2 }], a: undefined, b: "s" })).toBe('{"b":"s","z":[{"x":2,"y":1}]}');
  });
});

describe("JWS detached sign/verify", () => {
  const cases = [
    ["ES256", es256, "ES256"] as const,
    ["EdDSA", ed, "EdDSA"] as const,
  ];
  for (const [name, gen, alg] of cases) {
    test(`${name}: round-trip verifies`, () => {
      const { privateKey, publicKey } = gen();
      const payload = jcsCanonicalize({ hello: "world", n: [1, 2, 3] });
      const sig = jwsSignDetached(payload, privateKey, { alg });
      expect(jwsVerifyDetached(payload, sig, publicKey)).toBe(true);
    });
    test(`${name}: tampered payload fails`, () => {
      const { privateKey, publicKey } = gen();
      const sig = jwsSignDetached(jcsCanonicalize({ a: 1 }), privateKey, { alg });
      expect(jwsVerifyDetached(jcsCanonicalize({ a: 2 }), sig, publicKey)).toBe(false);
    });
    test(`${name}: a different key fails`, () => {
      const { privateKey } = gen();
      const other = gen();
      const payload = jcsCanonicalize({ a: 1 });
      const sig = jwsSignDetached(payload, privateKey, { alg });
      expect(jwsVerifyDetached(payload, sig, other.publicKey)).toBe(false);
    });
  }

  test("rejects alg 'none' and unknown algs (no alg-confusion)", () => {
    const hdr = (h: unknown) => b64urlEncode(Buffer.from(JSON.stringify(h)));
    expect(parseProtectedHeader(hdr({ alg: "none" }))).toBeNull();
    expect(parseProtectedHeader(hdr({ alg: "HS256" }))).toBeNull();
    expect(parseProtectedHeader(hdr({}))).toBeNull();
    expect(parseProtectedHeader(hdr({ alg: "ES256" }))).not.toBeNull();
  });

  test("jwsSignDetached refuses an unsupported alg", () => {
    const { privateKey } = es256();
    expect(() => jwsSignDetached("x", privateKey, { alg: "HS256" as any })).toThrow();
  });

  test("publicKeyFromJwk reconstructs an embedded key that verifies", () => {
    const { privateKey, publicKey } = es256();
    const reconstructed = publicKeyFromJwk(publicKey.export({ format: "jwk" }));
    const payload = jcsCanonicalize({ a: 1 });
    const sig = jwsSignDetached(payload, privateKey, { alg: "ES256" });
    expect(jwsVerifyDetached(payload, sig, reconstructed!)).toBe(true);
  });
});

describe("a2a-sdk compatible canonicalization (clean_empty + ascii)", () => {
  test("cleanEmpty drops empty strings/arrays/objects, keeps false/0", () => {
    expect(cleanEmpty({ a: "", b: [], c: {}, d: false, e: 0, f: "x" })).toEqual({ d: false, e: 0, f: "x" });
    expect(cleanEmpty({ s: { id: "s", name: "S", description: "", tags: [] } })).toEqual({ s: { id: "s", name: "S" } });
  });

  test("matches the expected a2a-python bytes (empty fields dropped, sorted, compact)", () => {
    const card = {
      name: "aos",
      description: "",
      url: "https://x/a2a",
      version: "0.9.1",
      capabilities: { streaming: false, pushNotifications: false },
      skills: [],
      preferredTransport: "JSONRPC",
    };
    expect(canonicalizeForSigning(card)).toBe(
      '{"capabilities":{"pushNotifications":false,"streaming":false},"name":"aos","preferredTransport":"JSONRPC","url":"https://x/a2a","version":"0.9.1"}',
    );
  });

  test("ensure_ascii escapes non-ASCII (matches json.dumps default)", () => {
    expect(canonicalizeForSigning({ name: "café" })).toBe('{"name":"caf\\u00e9"}');
  });
});

describe("JWKS (jku key discovery)", () => {
  test("buildJwks → keysFromJwks round-trips and the verify key matches by thumbprint", () => {
    const { privateKey, publicKey } = es256();
    const jwks = buildJwks([publicKey]);
    expect(jwks.keys).toHaveLength(1);
    const kid = jwks.keys[0]!.kid as string;
    expect(kid).toBe(jwkThumbprint(publicKey.export({ format: "jwk" })));

    // A signature carrying that kid resolves to exactly the publishing key.
    const sig = jwsSignDetached("payload", privateKey, { alg: "ES256", kid });
    const resolved = keysFromJwks(JSON.stringify(jwks), kid);
    expect(resolved).toHaveLength(1);
    expect(jwsVerifyDetached("payload", sig, resolved[0]!)).toBe(true);
  });

  test("buildJwks NEVER publishes private key material, even when handed a private KeyObject", () => {
    // DATA-002: buildible JWKS is PUBLIC. Passing a private key (the footgun a
    // future caller could hit) must still yield public-only JWKs — no `d`.
    for (const { privateKey } of [es256(), ed()]) {
      const jwks = buildJwks([privateKey]); // private KeyObject on purpose
      expect(jwks.keys).toHaveLength(1);
      const jwk = jwks.keys[0]!;
      expect(jwk.d).toBeUndefined(); // the private scalar must not leak
      expect(JSON.stringify(jwks)).not.toContain('"d"');
      // and it is still a usable public key (kid + public members present).
      expect(typeof jwk.kid).toBe("string");
      expect(jwk.x).toBeDefined();
    }
  });

  test("keysFromJwks filters by kid (a non-matching key is skipped)", () => {
    const a = buildJwks([es256().publicKey]);
    const b = buildJwks([es256().publicKey]);
    const merged = JSON.stringify({ keys: [...a.keys, ...b.keys] });
    const wantKid = a.keys[0]!.kid as string;
    const got = keysFromJwks(merged, wantKid);
    expect(got).toHaveLength(1); // only the matching key
  });

  test("keysFromJwks tolerates a hostile/garbage document (never throws)", () => {
    expect(keysFromJwks("not json")).toEqual([]);
    expect(keysFromJwks(JSON.stringify({ keys: "nope" }))).toEqual([]);
    expect(keysFromJwks(JSON.stringify({ keys: [{ kty: "EC", x: "bad" }] }))).toEqual([]);
  });

  test("keysFromJwks bounds work to maxKeys", () => {
    const many = { keys: Array.from({ length: 100 }, () => buildJwks([es256().publicKey]).keys[0]) };
    // No kid filter → returns at most maxKeys (default 32) valid keys.
    expect(keysFromJwks(JSON.stringify(many)).length).toBeLessThanOrEqual(32);
  });
});

describe("alg/key binding", () => {
  test("a P-384 key cannot sign under ES256 (would be non-conformant)", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    expect(() => jwsSignDetached("p", privateKey, { alg: "ES256" })).toThrow(/P-256|curve|EdDSA/i);
  });
  test("an Ed25519 key cannot sign under ES256", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    expect(() => jwsSignDetached("p", privateKey, { alg: "ES256" })).toThrow();
  });
});
