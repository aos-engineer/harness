import { test, expect, describe } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { signAgentCard, verifyAgentCard } from "../src/agent-card-signer";
import { parseProtectedHeader } from "../src/jws";
import type { AgentCard } from "../src/a2a-client";

const baseCard: AgentCard = {
  name: "aos",
  url: "https://aos.example.com/a2a",
  version: "1.0",
  protocolVersion: "1.0",
  skills: [{ id: "s", name: "S", tags: ["t"] }],
};
function es256() {
  return generateKeyPairSync("ec", { namedCurve: "P-256" });
}

describe("Agent Card signing", () => {
  test("sign then verify (integrity mode via the embedded JWK)", () => {
    const { privateKey } = es256();
    const signed = signAgentCard(baseCard, { privateKey, kid: "k1" });
    expect(signed.signatures!.length).toBe(1);
    const v = verifyAgentCard(signed);
    expect(v.valid).toBe(true);
    expect(v.mode).toBe("integrity");
  });

  test("trusted mode verifies only against a trust anchor", () => {
    const { privateKey, publicKey } = es256();
    const signed = signAgentCard(baseCard, { privateKey });
    expect(verifyAgentCard(signed, { trustedKeys: [publicKey] })).toMatchObject({ valid: true, mode: "trusted" });
    // a different trusted key → rejected
    expect(verifyAgentCard(signed, { trustedKeys: [es256().publicKey] }).valid).toBe(false);
  });

  test("tampering the card body invalidates the signature (both modes)", () => {
    const { privateKey, publicKey } = es256();
    const signed = signAgentCard(baseCard, { privateKey });
    const tampered = { ...signed, url: "https://evil.example.com/a2a" };
    expect(verifyAgentCard(tampered, { trustedKeys: [publicKey] }).valid).toBe(false);
    expect(verifyAgentCard(tampered).valid).toBe(false);
  });

  test("spoofing: attacker re-signs with their own key — trusted mode rejects", () => {
    const real = es256();
    const attacker = es256();
    // attacker rewrites the endpoint and re-signs with their key (embedding their JWK)
    const spoof = signAgentCard({ ...baseCard, url: "https://evil/a2a" }, { privateKey: attacker.privateKey });
    // integrity mode is fooled (it only proves not-tampered-after-signing)...
    expect(verifyAgentCard(spoof).valid).toBe(true);
    // ...but pinning the REAL key (trusted mode) rejects the spoof.
    expect(verifyAgentCard(spoof, { trustedKeys: [real.publicKey] }).valid).toBe(false);
  });

  test("an unsigned card reports signed:false", () => {
    const v = verifyAgentCard(baseCard);
    expect(v.signed).toBe(false);
    expect(v.valid).toBe(false);
  });

  test("signature-stripping (empty signatures[]) is treated as unsigned", () => {
    expect(verifyAgentCard({ ...baseCard, signatures: [] }).signed).toBe(false);
  });

  test("a hostile non-array signatures field is treated as unsigned (no crash)", () => {
    expect(verifyAgentCard({ ...baseCard, signatures: { evil: true } as any }).signed).toBe(false);
    expect(verifyAgentCard({ ...baseCard, signatures: 5 as any }).signed).toBe(false);
    expect(verifyAgentCard({ ...baseCard, signatures: "x" as any }).signed).toBe(false);
  });

  test("jku is advertised in the signature header for key discovery", () => {
    const { privateKey } = es256();
    const signed = signAgentCard(baseCard, { privateKey, jku: "https://issuer.example.com/.well-known/jwks.json" });
    const header = parseProtectedHeader(signed.signatures![0]!.protected);
    expect(header?.jku).toBe("https://issuer.example.com/.well-known/jwks.json");
    // jku is informational — it does not change the verification result.
    expect(verifyAgentCard(signed).valid).toBe(true);
  });

  test("a card with empty fields still round-trips (clean_empty applied consistently)", () => {
    const { privateKey, publicKey } = es256();
    const cardWithEmpties: AgentCard = { ...baseCard, description: "", skills: [] };
    const signed = signAgentCard(cardWithEmpties, { privateKey });
    expect(verifyAgentCard(signed, { trustedKeys: [publicKey] }).valid).toBe(true);
  });
});
