import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Document, YAMLMap, parseDocument } from "yaml";
import { buildAdapterDefaults, getEnabledAdaptersFromConfig, isAosConfigV2, readAosConfig, type AosConfigV2 } from "./aos-config";
import type { AdapterName } from "./utils";

export function backfillAdapterDefaults(root: string): { changed: boolean; path?: string } {
  const path = join(root, ".aos", "config.yaml");
  if (!existsSync(path)) return { changed: false };

  const config = readAosConfig(root);
  if (!config || !isAosConfigV2(config)) return { changed: false };

  const enabledAdapters = getEnabledAdaptersFromConfig(config);
  if (enabledAdapters.length === 0) return { changed: false };

  const existingDefaults = (config as AosConfigV2).adapter_defaults ?? {};
  const missingAdapters = enabledAdapters.filter((adapter) => existingDefaults[adapter as AdapterName] == null);
  if (missingAdapters.length === 0) return { changed: false };

  const raw = readFileSync(path, "utf-8");
  const doc = raw ? parseDocument(raw) : new Document({});
  if (doc.errors.length > 0) return { changed: false };

  if (!(doc.contents instanceof YAMLMap)) {
    doc.contents = new YAMLMap();
  }

  const mergedDefaults = {
    ...existingDefaults,
    ...buildAdapterDefaults(missingAdapters, { legacyPiModels: config.models }),
  };

  doc.set("adapter_defaults", mergedDefaults);
  writeFileSync(path, doc.toString(), "utf-8");
  return { changed: true, path };
}
