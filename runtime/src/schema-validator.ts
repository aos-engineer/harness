// ── Schema Validator (Phase 0 — carrying capacity) ───────────────
//
// config-loader historically validated only the `schema:` const + a hardcoded
// required-field list + the id regex; the JSON Schemas in core/schema/ were
// authoring/reference artifacts that nothing enforced (so a typo'd block was
// silently dropped). This wires ajv to run the ACTUAL schema files:
//   • NEW kinds (e.g. aos/mcp/v1) → strict (loader throws on violation)
//   • legacy kinds                → warn-only (surface drift without breaking
//     the 30+ existing configs that predate strict validation)
//
// It degrades to a no-op (never throws) when the schema files cannot be located
// — e.g. a published runtime shipped without core/schema/. In that case the
// loaders' manual structural checks remain the floor. Schemas are read from disk
// (not imported) to avoid tsc rootDir coupling between runtime/ and core/.

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR: string | null = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
})();

function hasSchemaFiles(dir: string): boolean {
  return existsSync(join(dir, "agent.schema.json")) || existsSync(join(dir, "mcp.schema.json"));
}

function searchUpward(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "core", "schema");
    if (hasSchemaFiles(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cachedDir: string | null | undefined;

/** Locate core/schema/, searching up from `startDir` then from the module dir. */
export function findSchemaDir(startDir?: string): string | null {
  if (startDir) {
    const found = searchUpward(startDir);
    if (found) return found;
  }
  if (cachedDir !== undefined) return cachedDir;
  cachedDir =
    searchUpward(process.cwd()) ?? (MODULE_DIR ? searchUpward(MODULE_DIR) : null);
  return cachedDir;
}

/** "aos/agent/v1" → "agent.schema.json" (the kind is the second path segment). */
function schemaFileFor(schemaId: string): string | null {
  const parts = schemaId.split("/");
  if (parts.length < 2 || parts[0] !== "aos") return null;
  return `${parts[1]}.schema.json`;
}

const validatorCache = new Map<string, ValidateFunction | null>();

function getValidator(schemaId: string, schemaDir: string | null): ValidateFunction | null {
  const cacheKey = `${schemaDir ?? ""}::${schemaId}`;
  if (validatorCache.has(cacheKey)) return validatorCache.get(cacheKey)!;
  let fn: ValidateFunction | null = null;
  const file = schemaFileFor(schemaId);
  if (file && schemaDir) {
    const path = join(schemaDir, file);
    if (existsSync(path)) {
      try {
        const schema = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
        const ajv = new Ajv2020({ allErrors: true, strict: false });
        fn = ajv.compile(schema);
      } catch {
        fn = null; // unreadable / uncompilable schema → treat as unavailable
      }
    }
  }
  validatorCache.set(cacheKey, fn);
  return fn;
}

export interface SchemaValidationResult {
  /** Whether a schema was actually found and run. */
  checked: boolean;
  ok: boolean;
  errors: string[];
}

/** Validate `data` against the named AOS schema. Never throws. */
export function validateAgainstSchema(
  schemaId: string,
  data: unknown,
  startDir?: string,
): SchemaValidationResult {
  const dir = findSchemaDir(startDir);
  const fn = getValidator(schemaId, dir);
  if (!fn) return { checked: false, ok: true, errors: [] };
  const ok = fn(data) as boolean;
  const errors = ok
    ? []
    : (fn.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message ?? ""}`.trim());
  return { checked: true, ok, errors };
}

/** Test/CLI hook: clear the resolved-dir + compiled-validator caches. */
export function resetSchemaValidatorCache(): void {
  cachedDir = undefined;
  validatorCache.clear();
}
