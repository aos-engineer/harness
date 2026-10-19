import { expect, test } from "bun:test";
import { join } from "node:path";
import { classifyTier } from "../../src/pack/classify.ts";
import { loadPack } from "../../src/pack/load.ts";
import type { ResolvedPack, Tier } from "../../src/types.ts";

const pack = loadPack(join(import.meta.dirname, "../../../packs/feature-delivery"));

const briefs: [string, Tier][] = [
  ["Add a database migration for user roles", "architectural"],
  ["Rework the OAuth callback", "architectural"],
  ["Is it possible to stream logs over SSE?", "spike"],
  ["Spike: try Bun's new SQLite driver", "spike"],
  ["Fix the typo in the README", "bounded"],
  ["Spike a new service for billing", "architectural"],     // architectural rule is listed first
  ["Add OAuth2 login", "architectural"],
  ["Add an auth0 integration", "architectural"],
  ["Change the db schema for orders", "architectural"],
  ["Add SSO for the admin console", "architectural"],
  // A false architectural match stops a run that cannot start, while a miss still runs bounded with a
  // design approval, tests, and review, so only strong signals count.
  ["Fix a typo in the schema docs", "bounded"],
  ["Add a test for the auth helper", "bounded"],
  ["Update auth error message copy", "bounded"],
  ["Update the author list", "bounded"],
];
test.each(briefs)("%s -> %s", (brief, tier) => expect(classifyTier(pack, brief).tier).toBe(tier));

test("reason names the matched pattern", () => expect(classifyTier(pack, "add a migration").reason).toMatch(/^matched \/.+\/ \(architectural rule\)$/));

test("the reason quotes the pattern source exactly", () =>
  expect(classifyTier(pack, "add a migration")).toEqual({ tier: "architectural", reason: "matched /\\bmigrations?\\b/ (architectural rule)" }));

test("with no match, the reason names the pack default", () =>
  expect(classifyTier(pack, "Fix the typo in the README")).toEqual({ tier: "bounded", reason: "no tier rule matched; pack default is bounded" }));

test("matching ignores case", () => expect(classifyTier(pack, "THROWAWAY test of the cache").tier).toBe("spike"));

// A hand-built pack isolates ordering from the reference pack's keywords.
const ordered = (rules: ResolvedPack["classify"]["rules"]): ResolvedPack => ({ ...pack, classify: { rules, default: "bounded" } });

test("the first rule in pack order wins, even when a later rule also matches", () =>
  expect(classifyTier(ordered([{ tier: "spike", any: ["cache"] }, { tier: "architectural", any: ["cache"] }]), "cache layer").tier).toBe("spike"));

test("within a rule, the reason names the first source that matches", () =>
  expect(classifyTier(ordered([{ tier: "spike", any: ["zzz", "layer", "cache"] }]), "cache layer").reason).toBe("matched /layer/ (spike rule)"));

test("a pack with no rules always proposes its default", () =>
  expect(classifyTier(ordered([]), "anything at all")).toEqual({ tier: "bounded", reason: "no tier rule matched; pack default is bounded" }));
