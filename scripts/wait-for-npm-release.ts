#!/usr/bin/env bun
/**
 * Wait until every published AOS package is visible from the npm registry.
 *
 * This runs after the publish step in CI. npm metadata can lag for several
 * minutes, especially for newly published scoped packages. We check the
 * registry directly instead of relying on `npm install` retries because npm
 * may reuse cached "not found" metadata across attempts.
 */

const PACKAGES = [
  "aos-harness",
  "@aos-harness/runtime",
  "@aos-harness/adapter-shared",
  "@aos-harness/claude-code-adapter",
  "@aos-harness/codex-adapter",
  "@aos-harness/gemini-adapter",
  "@aos-harness/pi-adapter",
] as const;

const rawVersion = process.argv[2] ?? process.env.VERSION ?? "";
const version = rawVersion.replace(/^v/, "");

if (!version) {
  console.error("usage: wait-for-npm-release.ts <version> (or set VERSION)");
  process.exit(2);
}

const timeoutMs = Number(process.env.NPM_PROPAGATION_TIMEOUT_MS ?? 600_000);
const intervalMs = Number(process.env.NPM_PROPAGATION_POLL_MS ?? 15_000);
const deadline = Date.now() + timeoutMs;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function packageExists(pkg: string, ver: string): Promise<boolean> {
  const encoded = encodeURIComponent(pkg);
  const url = `https://registry.npmjs.org/${encoded}/${ver}?t=${Date.now()}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
    },
  });

  if (response.status === 404) return false;
  if (!response.ok) {
    const body = (await response.text()).slice(0, 400);
    throw new Error(`registry query failed for ${pkg}@${ver}: ${response.status} ${body}`);
  }
  return true;
}

let attempt = 0;
while (true) {
  attempt += 1;
  const missing: string[] = [];

  for (const pkg of PACKAGES) {
    const exists = await packageExists(pkg, version);
    if (!exists) missing.push(`${pkg}@${version}`);
  }

  if (missing.length === 0) {
    console.log(`npm propagation complete for ${version}`);
    process.exit(0);
  }

  if (Date.now() >= deadline) {
    console.error(
      `timed out waiting for npm propagation of ${version}; still missing: ${missing.join(", ")}`
    );
    process.exit(1);
  }

  console.log(
    `waiting for npm propagation of ${version} (attempt ${attempt}) — missing: ${missing.join(", ")}`
  );
  await sleep(intervalMs);
}
