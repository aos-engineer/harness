import { test, expect, describe, afterEach } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { A2aClient } from "../runtime/src/a2a-client";
import { MeshEgressPolicy } from "../runtime/src/egress-policy";
import { signAgentCard } from "../runtime/src/agent-card-signer";
import { buildJwks } from "../runtime/src/jws";
import type { AgentCard } from "../runtime/src/a2a-client";

const servers: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const s of servers) s.stop();
  servers.length = 0;
});

function serveCard(makeCard: (endpoint: string) => AgentCard): string {
  const server = Bun.serve({
    port: 0,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent-card.json") {
        return Response.json(makeCard(`http://localhost:${srv.port}/a2a`));
      }
      return new Response("nf", { status: 404 });
    },
  });
  servers.push({ stop: () => server.stop(true) });
  return `http://localhost:${server.port}`;
}

function client(opts: Partial<ConstructorParameters<typeof A2aClient>[0]> = {}): A2aClient {
  return new A2aClient({ egress: new MeshEgressPolicy({ allowPrivate: true }), ...opts });
}

const es = () => generateKeyPairSync("ec", { namedCurve: "P-256" });
const unsigned = (endpoint: string): AgentCard => ({ name: "peer", url: endpoint, protocolVersion: "1.0" });

describe("A2aClient Agent Card verification", () => {
  test("accepts a card signed by a trusted key", async () => {
    const { privateKey, publicKey } = es();
    const base = serveCard((e) => signAgentCard(unsigned(e), { privateKey }));
    const card = await client({ verifyCard: { trustedKeys: [publicKey] } }).fetchAgentCard(base);
    expect(card.name).toBe("peer");
  });

  test("rejects a card signed by an untrusted key (spoofing)", async () => {
    const real = es();
    const attacker = es();
    const base = serveCard((e) => signAgentCard(unsigned(e), { privateKey: attacker.privateKey }));
    await expect(
      client({ verifyCard: { trustedKeys: [real.publicKey] } }).fetchAgentCard(base),
    ).rejects.toThrow(/signature/i);
  });

  test("rejects an unsigned card when a signature is required", async () => {
    const base = serveCard(unsigned);
    const c = client({ verifyCard: { require: true, trustedKeys: [es().publicKey] } });
    await expect(c.fetchAgentCard(base)).rejects.toThrow(/unsigned/i);
  });

  test("require without trustedKeys is rejected at construction (no false confidence)", () => {
    expect(() => client({ verifyCard: { require: true } })).toThrow(/trustedKeys/i);
  });

  test("allows an unsigned card when verification is not configured", async () => {
    const base = serveCard(unsigned);
    const card = await client({}).fetchAgentCard(base);
    expect(card.name).toBe("peer");
  });
});

describe("A2aClient jku (JWKS) key discovery", () => {
  // Serves both the Agent Card AND a JWKS at /.well-known/jwks.json; the card's
  // signature header points its `jku` at that JWKS.
  function serveCardWithJwks(privateKey: any, jwks: unknown): { base: string; host: string } {
    const server = Bun.serve({
      port: 0,
      async fetch(req, srv) {
        const url = new URL(req.url);
        const endpoint = `http://localhost:${srv.port}/a2a`;
        const jku = `http://localhost:${srv.port}/.well-known/jwks.json`;
        if (url.pathname === "/.well-known/agent-card.json") {
          return Response.json(signAgentCard(unsigned(endpoint), { privateKey, jku, embedPublicKey: false }));
        }
        if (url.pathname === "/.well-known/jwks.json") return Response.json(jwks);
        return new Response("nf", { status: 404 });
      },
    });
    servers.push({ stop: () => server.stop(true) });
    return { base: `http://localhost:${server.port}`, host: "localhost" };
  }

  test("resolves the signing key from an allowlisted jku and verifies (identity)", async () => {
    const { privateKey, publicKey } = es();
    const jwks = buildJwks([publicKey]);
    const { base, host } = serveCardWithJwks(privateKey, jwks);
    // No trustedKeys pinned — trust is established via the allowlisted JWKS host.
    const card = await client({ verifyCard: { jku: { allowedHosts: [host] } } }).fetchAgentCard(base);
    expect(card.name).toBe("peer");
  });

  test("a jku host NOT in the allowlist is ignored → verification fails closed", async () => {
    const { privateKey, publicKey } = es();
    const jwks = buildJwks([publicKey]);
    const { base } = serveCardWithJwks(privateKey, jwks);
    await expect(
      client({ verifyCard: { jku: { allowedHosts: ["trusted.example.com"] } } }).fetchAgentCard(base),
    ).rejects.toThrow(/signature/i);
  });

  test("a JWKS that lacks the signing key → verification fails closed", async () => {
    const { privateKey } = es(); // card signed with this key…
    const jwks = buildJwks([es().publicKey]); // …but JWKS publishes a DIFFERENT key
    const { base, host } = serveCardWithJwks(privateKey, jwks);
    await expect(
      client({ verifyCard: { jku: { allowedHosts: [host] } } }).fetchAgentCard(base),
    ).rejects.toThrow(/signature/i);
  });

  test("jku configured + embedded JWK + non-allowed host → NO integrity downgrade", async () => {
    // The card embeds its own JWK (embedPublicKey default) and names a jku, but
    // the host isn't allowlisted. A naive verifier would integrity-pass on the
    // embedded JWK (spoofable); forcing trusted mode makes it fail closed.
    const { privateKey } = es();
    const base = serveCard((e) =>
      signAgentCard(unsigned(e), { privateKey, jku: "http://localhost:1/.well-known/jwks.json" }),
    );
    await expect(
      client({ verifyCard: { jku: { allowedHosts: ["trusted.example.com"] } } }).fetchAgentCard(base),
    ).rejects.toThrow(/signature/i);
  });
});
