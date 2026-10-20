// ajv is loaded on first use. Importing it costs tens of milliseconds, and a hook process imports the kernel
// on every tool call without ever validating anything, so the cost waits until a pack or tool call needs it.
// A bundled build cannot follow this runtime require, so a bundle's entry point imports ajv itself and hands
// it over with provideAjv before anything validates.
import { createRequire } from "node:module";

type AjvModule = typeof import("ajv");

const requireFromHere = createRequire(import.meta.url);
let provided: AjvModule | null = null;

/** Supply the ajv module up front (bundled builds), or pass null to go back to requiring it. */
export function provideAjv(mod: AjvModule | null): void {
  provided = mod;
}

export function loadAjv(): AjvModule {
  return provided ?? (requireFromHere("ajv") as AjvModule);
}
